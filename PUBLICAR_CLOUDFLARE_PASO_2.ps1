$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
# Compatible with Windows PowerShell 5.1 and PowerShell 7+ (.NET Framework or .NET).
# Avoid RandomNumberGenerator.GetBytes(int) and Convert.ToHexString, which require newer .NET.
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
Write-Host ""
Write-Host "GUARDA ESTA CLAVE DE ALTA ANTES DE SEGUIR:" -ForegroundColor Yellow
Write-Host $token -ForegroundColor Cyan
Write-Host "Esta clave no es una contrasena de usuario: sirve una sola vez para crear las dos cuentas." -ForegroundColor Yellow
Write-Host ""
Read-Host "Pulsa ENTER cuando hayas guardado la clave de alta en tu gestor de contrasenas"
$token | & npx --yes wrangler@4 secret put SETUP_TOKEN
if($LASTEXITCODE -ne 0){throw 'No se pudo guardar SETUP_TOKEN en Cloudflare'}
Write-Host "Se ha configurado SETUP_TOKEN. Abre la URL de Cloudflare y completa el alta." -ForegroundColor Green
