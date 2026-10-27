# DUPLA: diagnóstico SOLO LECTURA del acceso de las dos cuentas en la web real (busca el origen de HTTP 401).
# Cuenta A: %USERPROFILE%\.dupla\credencial.xml (npm run credencial). Cuenta B: credencial-b.xml o se pide oculta y,
# si quieres, se guarda cifrada (DPAPI) para próximas comprobaciones. No crea, edita ni borra nada.
param([switch]$GuardarB)
$ErrorActionPreference = 'Stop'
$Url = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
$Dir = Join-Path $env:USERPROFILE '.dupla'
function Status($block) { try { $r = & $block; return [int]$r.StatusCode } catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return "ERROR: $($_.Exception.Message)" } }
function Check([pscredential]$cred, [string]$label) {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $body = @{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json -Compress
    $login = Status { Invoke-WebRequest "$Url/api/login" -Method POST -ContentType 'application/json' -Headers @{Origin=$Url} -Body $body -WebSession $s -UseBasicParsing -TimeoutSec 25 }
    $body = $null
    $cookie = ($s.Cookies.GetCookies($Url) | Where-Object Name -eq 'dos_session')
    $me = try { (Invoke-RestMethod "$Url/api/me" -WebSession $s -TimeoutSec 20).user.email } catch { 'sin usuario' }
    $dash = Status { Invoke-WebRequest "$Url/api/dashboard" -WebSession $s -UseBasicParsing -TimeoutSec 25 }
    $projects = try { (Invoke-RestMethod "$Url/api/dashboard" -WebSession $s -TimeoutSec 25).projects.Count } catch { '?' }
    $notices = Status { Invoke-WebRequest "$Url/api/notifications" -WebSession $s -UseBasicParsing -TimeoutSec 25 }
    Write-Host ("[{0}] login={1} cookie={2} me={3} dashboard={4} proyectos={5} notificaciones={6}" -f $label,$login,($(if($cookie){'sí (Secure,HttpOnly)'}else{'NO'})),$me,$dash,$projects,$notices)
    return ($login -eq 200 -and $dash -eq 200 -and $notices -eq 200)
}
$sinSesion = Status { Invoke-WebRequest "$Url/api/dashboard" -UseBasicParsing -TimeoutSec 20 }
Write-Host "Sin sesión /api/dashboard = $sinSesion (esperado 401: es protección correcta, no un fallo)"
$a = Import-Clixml (Join-Path $Dir 'credencial.xml')
$okA = Check $a 'Cuenta A'
$fileB = Join-Path $Dir 'credencial-b.xml'
if (Test-Path $fileB) { $b = Import-Clixml $fileB } else {
    $email = Read-Host 'Correo de la OTRA cuenta (la que no es la guardada)'
    $b = [pscredential]::new($email, (Read-Host 'Su contraseña (oculta)' -AsSecureString))
    if ($GuardarB) { $b | Export-Clixml $fileB; Write-Host "Guardada cifrada en $fileB" }
}
if ($b.UserName -eq $a.UserName) { throw 'La cuenta B debe ser distinta de la A.' }
$okB = Check $b 'Cuenta B'
if ($okA -and $okB) { Write-Host 'RESULTADO: las dos cuentas acceden de forma independiente. Sin 401 con sesión.' -ForegroundColor Green }
else { Write-Host 'RESULTADO: hay un fallo de acceso (ver líneas anteriores).' -ForegroundColor Red; exit 1 }
