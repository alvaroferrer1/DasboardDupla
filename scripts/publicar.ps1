# DUPLA: publicacion en un paso, sin ZIPs ni contrasenas a mano.
# Orden: identidad -> pruebas -> copia autenticada de datos -> commit+etiqueta git -> deploy -> verificacion real.
# Uso: npm run publicar            (publica)
#      npm run publicar:ensayo     (hace todo MENOS desplegar)
param([switch]$Ensayo, [string]$Mensaje = 'publicacion')
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Url = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
$CredFile = Join-Path $env:USERPROFILE '.dupla\credencial.xml'
$BackupDir = Join-Path (Split-Path $Root -Parent) 'RESPALDOS_PRIVADOS_NO_COMPARTIR'
Set-Location $Root

function Paso([string]$t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Check-Exit([string]$Label) { if ($LASTEXITCODE -ne 0) { throw "$Label ha fallado (codigo $LASTEXITCODE). NO se publica." } }

Paso 'Identidad del Worker y Durable Object'
$Config = Get-Content 'wrangler.jsonc' -Raw
$Worker = Get-Content 'edge\worker.mjs' -Raw
if (-not $Config.Contains('"name": "dos-espacios-compartido"') -or -not $Config.Contains('"class_name": "DosRoom"') -or -not $Worker.Contains("idFromName('shared-home')")) {
    throw 'El nombre del Worker / Durable Object no coincide con el publicado. Se cancela para proteger los datos.'
}
if (-not (Test-Path $CredFile)) { throw 'Falta la credencial cifrada. Ejecuta una vez: npm run credencial' }

Paso 'Sintaxis y pruebas'
& npm.cmd run --silent check:cloud; Check-Exit 'check:cloud'
& npm.cmd test --silent; Check-Exit 'npm test'

Paso 'Estado actual de la web'
$before = Invoke-RestMethod -Uri "$Url/api/me" -TimeoutSec 20
if ($before.configured -ne $true) { throw 'La web publicada no reconoce las dos cuentas. NO se publica.' }

Paso 'Copia autenticada de los datos actuales'
$cred = Import-Clixml -LiteralPath $CredFile
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$body = @{ email = $cred.UserName; password = $cred.GetNetworkCredential().Password } | ConvertTo-Json -Compress
try {
    $login = Invoke-RestMethod -Uri "$Url/api/login" -Method POST -ContentType 'application/json' -Headers @{Origin=$Url} -Body $body -WebSession $session -TimeoutSec 25
    if (-not $login.user.id) { throw 'Inicio de sesion sin usuario.' }
} finally { $body = $null }
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
$file = Join-Path $BackupDir ('DUPLA_ANTES_DESPLIEGUE_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
Invoke-WebRequest -Uri "$Url/api/snapshot" -WebSession $session -Headers @{Origin=$Url} -TimeoutSec 180 -OutFile $file -UseBasicParsing | Out-Null
$snap = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
if ($snap.format -ne 'dos-espacios-edge-v1' -or $snap.users.Count -ne 2 -or $null -eq $snap.data.projects -or $null -eq $snap.files) {
    Remove-Item -LiteralPath $file -Force
    throw 'La copia no tiene los dos usuarios y el formato esperado. NO se publica.'
}
Set-Content -LiteralPath ($file + '.sha256') -Value (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
Write-Host ("Copia: $file | proyectos: " + $snap.data.projects.Count + ' | adjuntos: ' + $snap.files.Count) -ForegroundColor Green
# Conserva las 15 copias mas recientes.
Get-ChildItem $BackupDir -Filter 'DUPLA_ANTES_DESPLIEGUE_*.json' | Sort-Object Name -Descending | Select-Object -Skip 15 |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName, ($_.FullName + '.sha256') -Force -ErrorAction SilentlyContinue }

if ($Ensayo) { Write-Host "`nENSAYO OK: pruebas, cuentas y copia correctas. No se ha desplegado nada." -ForegroundColor Green; exit 0 }

Paso 'Guardar version en git'
& git add -A; & git commit -q -m "$Mensaje" 2>$null
$tag = 'publicado-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
& git tag $tag; Check-Exit 'git tag'

Paso 'Despliegue en Cloudflare'
& npx.cmd wrangler deploy --message "$tag $Mensaje"; Check-Exit 'wrangler deploy'

Paso 'Verificacion real de la web publicada'
$health = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 25
if ($health.status -ne 'ok') { throw '/api/health no responde status=ok tras el despliegue.' }
$after = Invoke-RestMethod -Uri "$Url/api/me" -TimeoutSec 25
if ($after.configured -ne $true) { throw 'ALERTA: la nueva version no reconoce las cuentas. Ejecuta: npm run deshacer' }
# El app.js servido debe ser exactamente el local (prueba de que el codigo nuevo esta en vivo).
$ok = $false
foreach ($i in 1..6) {
    # Bytes crudos: PowerShell 5.1 decodifica .Content sin charset y estropea los acentos.
    $remoteBytes = (Invoke-WebRequest -Uri "$Url/app.js?v=$tag" -UseBasicParsing -TimeoutSec 25).RawContentStream.ToArray()
    $localBytes = [IO.File]::ReadAllBytes((Join-Path $Root 'edge\public\app.js'))
    if ([Convert]::ToBase64String($remoteBytes) -eq [Convert]::ToBase64String($localBytes)) { $ok = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $ok) { throw 'El app.js publicado no coincide con el local. Revisa el despliegue (o npm run deshacer).' }

Write-Host "`nPUBLICADO Y VERIFICADO: $tag ($Url)" -ForegroundColor Green
Write-Host 'Comprobado: salud OK, cuentas reconocidas, codigo en vivo = codigo local, copia de datos guardada.'
