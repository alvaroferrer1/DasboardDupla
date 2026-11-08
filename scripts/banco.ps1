# DUPLA: guarda las claves de Enable Banking como secretos del Worker (no se escriben en ningun archivo del proyecto).
# Uso: npm run banco   (lo ejecuta el usuario; pide el ID de la aplicacion y la ruta de la clave privada .pem)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host "Banco conectado para DUPLA (Enable Banking)" -ForegroundColor Cyan
Write-Host "Direccion de vuelta que debe tener vuestra aplicacion en Enable Banking:"
Write-Host "  https://dos-espacios-compartido.dos-espacios-ferris.workers.dev/api/bank/callback" -ForegroundColor Yellow
$id = Read-Host 'ID de la aplicacion (Application ID)'
if (-not $id.Trim()) { throw 'Falta el ID de la aplicacion.' }
$pem = Read-Host 'Ruta del archivo .pem con la clave privada'
$pem = $pem.Trim('"', ' ')
if (-not (Test-Path -LiteralPath $pem)) { throw "No encuentro el archivo: $pem" }
$key = Get-Content -LiteralPath $pem -Raw
if ($key -notmatch 'BEGIN (RSA )?PRIVATE KEY') { throw 'Ese archivo no parece una clave privada PEM.' }
$id.Trim() | npx.cmd wrangler secret put ENABLE_BANKING_APP_ID
if ($LASTEXITCODE -ne 0) { throw 'No se pudo guardar el ID.' }
$key | npx.cmd wrangler secret put ENABLE_BANKING_KEY
if ($LASTEXITCODE -ne 0) { throw 'No se pudo guardar la clave.' }
$key = $null
Write-Host "Listo. Abrid DUPLA > Conexiones > Banco conectado > Elegir mi banco." -ForegroundColor Green
