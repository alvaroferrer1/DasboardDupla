# DOS ESPACIOS · URL HTTPS gratuita con Tailscale Funnel.
# Requiere un ordenador Windows ENCENDIDO con Node.js 22+ y Tailscale conectado.
# No hace port forwarding. El puerto 3077 solo escucha en 127.0.0.1.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
function Fail($Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) { Fail 'Instala Node.js 22.13+ en https://nodejs.org/' }
$Major = [int]((& $Node.Source --version) -replace '^v(\d+).*','$1')
if ($Major -lt 22) { Fail 'Se requiere Node.js 22.13 o superior.' }
$TS = Get-Command tailscale -ErrorAction SilentlyContinue
if ($TS) { $TSExe = $TS.Source }
elseif (Test-Path "$env:ProgramFiles\Tailscale\tailscale.exe") { $TSExe = "$env:ProgramFiles\Tailscale\tailscale.exe" }
else { Fail 'Instala Tailscale en https://tailscale.com/download/windows e inicia sesión.' }
try {
  $Status = (& $TSExe status --json | ConvertFrom-Json)
  if (-not $Status.Self.DNSName) { Fail 'Abre Tailscale e inicia sesión antes de compartir.' }
  $DnsName = $Status.Self.DNSName.TrimEnd('.')
} catch { Fail 'No he podido leer la URL HTTPS de Tailscale. Comprueba que has iniciado sesión.' }
$Public = "https://$DnsName"
$Private = Join-Path $Root '.local-private'
New-Item -ItemType Directory -Force -Path $Private | Out-Null
$SetupFile = Join-Path $Private 'setup-token.txt'
if (-not (Test-Path $SetupFile)) { & $Node.Source scripts/make-private-setup.mjs | Out-Null }
$Setup = (Get-Content -Raw $SetupFile).Trim()
if ($Setup -notmatch '^[0-9a-f]{64}$') { Fail 'La clave de instalación no es válida.' }
$env:SETUP_TOKEN = $Setup
$env:HOST = '127.0.0.1'
$env:PORT = '3077'
$env:COOKIE_SECURE = 'true'
$env:PUBLIC_ORIGIN = $Public
Write-Host 'Comprobando la aplicación...' -ForegroundColor Cyan
& $Node.Source --check server.mjs
if ($LASTEXITCODE -ne 0) { Fail 'El servidor tiene errores de sintaxis.' }
$AlreadyRunning=$false
try { $Resp=Invoke-RestMethod 'http://127.0.0.1:3077/api/health' -TimeoutSec 2; if($Resp.status -eq 'ok'){$AlreadyRunning=$true} }catch{}
if ($AlreadyRunning) {
  Fail 'Ya hay un servidor escuchando en 3077. Detén esa instancia antes de usar este lanzador seguro.'
}
$Stdout = Join-Path $Private 'server-out.log'
$Stderr = Join-Path $Private 'server-err.log'
$Proc = Start-Process -FilePath $Node.Source -ArgumentList 'server.mjs' -WorkingDirectory $Root -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru -WindowStyle Hidden
Set-Content -NoNewline (Join-Path $Private 'server.pid') -Value $Proc.Id
$Started=$false
for($i=0;$i -lt 30;$i++) {
  Start-Sleep -Milliseconds 300
  if($Proc.HasExited) { Fail "Servidor detenido. Revisa $Stderr" }
  try { $R=Invoke-RestMethod 'http://127.0.0.1:3077/api/health' -TimeoutSec 1; if($R.status -eq 'ok'){$Started=$true;break} }catch{}
}
if(-not $Started){ Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue; Fail "El servidor no se ha iniciado. Revisa $Stderr" }
Write-Host 'Activando la URL HTTPS de Tailscale Funnel...' -ForegroundColor Cyan
& $TSExe funnel --bg --yes 3077
if($LASTEXITCODE -ne 0){ Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue; Fail 'No se ha podido activar Funnel. Actívalo en el panel DNS de Tailscale y vuelve a intentar.' }
Write-Host ''
Write-Host 'DOS ESPACIOS YA TIENE UNA URL PARA ESTE ORDENADOR' -ForegroundColor Green
Write-Host $Public -ForegroundColor Yellow
Write-Host ''
Write-Host '1. Abre el enlace HTTPS. Si es la primera vez, te pedirá la clave de activación.'
Write-Host "2. La clave está guardada PRIVADAMENTE en: $SetupFile"
Write-Host '3. Crea exactamente dos usuarios: Álvaro y Angie, cada uno con su correo y contraseña.'
Write-Host '4. Envía SOLO el enlace a Angie. Nunca envíes la clave de instalación ni contraseñas.'
Write-Host '5. Para detenerlo, usa PARAR_COMPARTIR_WINDOWS.ps1.'
Write-Host 'IMPORTANTE: tu PC debe seguir ENCENDIDO y conectado para que el enlace funcione.' -ForegroundColor Yellow
Write-Host 'AVISO: Funnel es público para visitar la pantalla de login, pero los datos exigen autenticación.'
Start-Process $Public
