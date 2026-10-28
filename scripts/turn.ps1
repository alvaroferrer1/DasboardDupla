# DUPLA: guarda en Cloudflare la clave TURN (videollamadas en redes cerradas). La ejecuta el usuario: npm run turn
# El token se escribe oculto y va directo a Cloudflare: no se guarda en el proyecto ni se muestra.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$id = (Read-Host 'Pega el «Turn Token ID» de Cloudflare').Trim()
if ($id -notmatch '^[A-Za-z0-9]{16,64}$') { throw 'Eso no parece un Turn Token ID.' }
$sec = Read-Host 'Pega el «API Token» de esa clave TURN (no se verá)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($plain.Length -lt 20) { throw 'El token parece incompleto.' }
foreach ($pair in @(@('TURN_KEY_ID', $id), @('TURN_KEY_API_TOKEN', $plain))) {
  $tmp = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($tmp, $pair[1], (New-Object Text.UTF8Encoding($false)))
  cmd /c "npx.cmd wrangler secret put $($pair[0]) < `"$tmp`"" | Out-Null; $code = $LASTEXITCODE; Remove-Item $tmp -Force
  if ($code -ne 0) { throw "No se pudo guardar $($pair[0])" }
}
$plain = $null
Write-Host 'Listo: clave TURN guardada en Cloudflare. Las videollamadas ya pueden pasar por el servidor de Cloudflare cuando haga falta.' -ForegroundColor Green
