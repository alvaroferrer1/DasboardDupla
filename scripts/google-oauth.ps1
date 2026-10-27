# DUPLA: sube a Cloudflare el cliente OAuth de Google (lo ejecuta el usuario: npm run google).
# El secreto se escribe oculto y va directo a Cloudflare: no se guarda en el proyecto ni se muestra.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
Write-Host 'Pega el ID de cliente de Google (termina en .apps.googleusercontent.com):'
$id = (Read-Host).Trim()
if ($id -notmatch '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$') { throw 'Eso no parece un ID de cliente de Google.' }
$sec = Read-Host 'Pega el secreto del cliente (no se verá)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($plain.Length -lt 20) { throw 'El secreto parece incompleto.' }
$id | & npx.cmd wrangler secret put GOOGLE_CLIENT_ID | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir GOOGLE_CLIENT_ID' }
$plain | & npx.cmd wrangler secret put GOOGLE_CLIENT_SECRET | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir GOOGLE_CLIENT_SECRET' }
$plain = $null
Write-Host 'Listo: GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET guardados en Cloudflare.' -ForegroundColor Green
