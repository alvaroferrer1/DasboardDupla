# DUPLA: vuelve el Worker a la version publicada anterior. Solo codigo: los datos (Durable Object) no se tocan.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$Url = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
& npx.cmd wrangler rollback --message 'deshacer ultima publicacion' --yes
if ($LASTEXITCODE -ne 0) { throw 'wrangler rollback ha fallado.' }
$health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 25
$me = Invoke-RestMethod -Uri "$Url/api/me" -TimeoutSec 25
if ($health.status -ne 'ok' -or $me.configured -ne $true) { throw 'Tras deshacer, la web no responde correctamente.' }
Write-Host 'DESHECHO Y VERIFICADO: version anterior en vivo, salud OK, cuentas reconocidas.' -ForegroundColor Green
