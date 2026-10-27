# DUPLA: guarda UNA VEZ el correo y la contrasena de una de las dos cuentas para la copia previa al despliegue.
# Se cifra con DPAPI de Windows: solo este usuario en este PC puede leerla. Nunca entra en git ni en ZIPs.
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:USERPROFILE '.dupla'
$File = Join-Path $Dir 'credencial.xml'
New-Item -ItemType Directory -Path $Dir -Force | Out-Null

$email = Read-Host 'Correo de una de las dos cuentas de DUPLA'
$secure = Read-Host 'Contrasena (se oculta mientras escribes)' -AsSecureString
[pscredential]::new($email, $secure) | Export-Clixml -LiteralPath $File

# Comprobacion real: inicia sesion contra la web publicada sin cambiar nada.
$Url = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
$cred = Import-Clixml -LiteralPath $File
$body = @{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json -Compress
try {
    $login = Invoke-RestMethod -Uri "$Url/api/login" -Method POST -ContentType 'application/json' -Headers @{Origin=$Url} -Body $body -TimeoutSec 25
    if (-not $login.user.id) { throw 'respuesta sin usuario' }
    Write-Host ('OK: credencial guardada y comprobada (' + $File + ')') -ForegroundColor Green
} catch {
    Remove-Item -LiteralPath $File -Force
    Write-Host ('ERROR: el inicio de sesion ha fallado, no se guarda nada. ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally { $body = $null }
