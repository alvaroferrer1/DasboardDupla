# DOS ESPACIOS: deploy into YOUR Oracle Always Free Ubuntu VM.
# Does not create paid cloud resources. Never asks for app passwords or tokens.
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'DOS ESPACIOS - Publicar en tu VM gratuita Oracle' -ForegroundColor Cyan
Write-Host 'Requiere: VM Oracle Ubuntu 24.04 Always Free, IP publica, clave SSH privada y reglas OCI TCP 80/443.'
$vmIP = (Read-Host 'IPv4 publica de la maquina Oracle').Trim()
$ipObject = $null
if (-not [System.Net.IPAddress]::TryParse($vmIP, [ref]$ipObject) -or $ipObject.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $vmIP -notmatch '^\d+\.\d+\.\d+\.\d+$') {throw 'Debes introducir una IPv4 publica valida.'}
$sshUser = (Read-Host 'Usuario SSH de la VM (ubuntu por defecto)').Trim()
if (-not $sshUser) {$sshUser = 'ubuntu'}
if ($sshUser -notmatch '^[a-z_][a-z0-9_-]*$') {throw 'Usuario SSH no valido.'}
$keyFile = (Read-Host 'Ruta del archivo privado SSH (.key/.pem) de Oracle').Trim().Trim('"')
if (-not (Test-Path -LiteralPath $keyFile -PathType Leaf)) {throw 'No existe el archivo de clave privada indicado.'}
if (-not (Get-Command 'ssh.exe' -ErrorAction SilentlyContinue)) {throw 'Windows no tiene OpenSSH Client (ssh.exe). Instalalo desde Caracteristicas opcionales.'}
if (-not (Get-Command 'scp.exe' -ErrorAction SilentlyContinue)) {throw 'Windows no tiene scp.exe. Instala OpenSSH Client.'}
if (-not (Get-Command 'tar.exe' -ErrorAction SilentlyContinue)) {throw 'Windows no tiene tar.exe.'}
$projectDir = $PSScriptRoot
if (-not (Test-Path (Join-Path $projectDir 'server.mjs'))) {throw 'Ejecuta este script dentro de la carpeta dos-espacios.'}
$parent = Split-Path -Parent $projectDir
$folder = Split-Path -Leaf $projectDir
$archive = Join-Path $env:TEMP ('dos-cloud-' + [guid]::NewGuid().ToString('N') + '.tar.gz')
try {
  Write-Host 'Empaquetando proyecto sin secretos, bases de datos ni archivos privados...'
  & tar.exe --exclude="$folder/.env" --exclude="$folder/.local-private" --exclude="$folder/data" --exclude="$folder/private-backups" --exclude="$folder/backups" --exclude="$folder/node_modules" --exclude="$folder/guardian-output" -czf $archive -C $parent $folder
  if ($LASTEXITCODE -ne 0) {throw 'No se pudo preparar el archivo de despliegue.'}
  $target = "${sshUser}@${vmIP}"
  Write-Host 'Copiando archivos al servidor; confirma la huella SSH solo si coincide con Oracle.'
  & scp.exe -o IdentitiesOnly=yes -i $keyFile $archive "${target}:dos-espacios-despliegue.tar.gz"
  if ($LASTEXITCODE -ne 0) {throw 'Falló la copia por SSH.'}
  Write-Host 'Instalando Node + Caddy en Docker con almacenamiento persistente y copias locales...'
  $remote = "tar xzf dos-espacios-despliegue.tar.gz && cd '$folder' && sudo bash ops/INSTALAR_ORACLE_ALWAYS_FREE.sh '$vmIP'"
  & ssh.exe -o IdentitiesOnly=yes -i $keyFile $target $remote
  if ($LASTEXITCODE -ne 0) {throw 'Falló la instalación remota. Comprueba logs y configura los puertos en Oracle.'}
  $domain = $vmIP.Replace('.', '-') + '.sslip.io'
  Write-Host ''
  Write-Host "DIRECCION PROPUESTA: https://$domain" -ForegroundColor Green
  Write-Host 'Es una URL potencial. No la envies hasta que https://DOMINIO/api/health responda correctamente.'
  Write-Host 'El secreto de alta esta SOLO en .env del VPS. Cree las cuentas desde la web.'
} finally {
  if (Test-Path -LiteralPath $archive) {Remove-Item -LiteralPath $archive -Force}
}
