# DUPLA: genera y sube a Cloudflare los secretos que faltan (VAPID push + cifrado de integraciones).
# No muestra ningun valor. Guarda copia cifrada (DPAPI) en %USERPROFILE%\.dupla\secretos.xml.
# Solo crea los que no existan ya en Cloudflare: volver a generar VAPID obligaria a reactivar push en cada movil.
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$Store = Join-Path $env:USERPROFILE '.dupla\secretos.xml'
New-Item -ItemType Directory -Path (Split-Path $Store) -Force | Out-Null
$saved = @{}
if (Test-Path $Store) { (Import-Clixml $Store).GetEnumerator() | ForEach-Object { $saved[$_.Key] = $_.Value } }
$existing = (& npx.cmd wrangler secret list --format json | ConvertFrom-Json).name

$js = @'
const {generateKeyPairSync,randomBytes}=require('node:crypto');
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const p=publicKey.export({format:'jwk'});
process.stdout.write(JSON.stringify({PUSH_VAPID_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),PUSH_VAPID_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(p.x,'base64url'),Buffer.from(p.y,'base64url')]).toString('base64url'),INTEGRATION_ENCRYPTION_KEY:randomBytes(48).toString('base64url')}));
'@
$gen = (& node.exe -e $js) | ConvertFrom-Json
$values = [ordered]@{
    PUSH_VAPID_PRIVATE_JWK = $gen.PUSH_VAPID_PRIVATE_JWK
    PUSH_VAPID_PUBLIC_KEY = $gen.PUSH_VAPID_PUBLIC_KEY
    PUSH_VAPID_SUBJECT = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
    INTEGRATION_ENCRYPTION_KEY = $gen.INTEGRATION_ENCRYPTION_KEY
}
# El par VAPID va junto: si falta una de las dos mitades, se regeneran ambas.
$vapidOk = ($existing -contains 'PUSH_VAPID_PRIVATE_JWK') -and ($existing -contains 'PUSH_VAPID_PUBLIC_KEY')
foreach ($name in $values.Keys) {
    if ($name -like 'PUSH_VAPID_*KEY' -or $name -eq 'PUSH_VAPID_PRIVATE_JWK') { if ($vapidOk) { Write-Host "$name ya existe, se conserva."; continue } }
    elseif ($existing -contains $name) { Write-Host "$name ya existe, se conserva."; continue }
    # Por archivo temporal (UTF-8 sin BOM): la tuberia de PowerShell 5.1 alteraba el valor y Cloudflare lo guardaba mal.
    $tmp = [IO.Path]::GetTempFileName(); [IO.File]::WriteAllText($tmp, $values[$name], (New-Object Text.UTF8Encoding($false)))
    cmd /c "npx.cmd wrangler secret put $name < `"$tmp`"" | Out-Null; Remove-Item $tmp -Force
    if ($LASTEXITCODE -ne 0) { throw "No se pudo subir $name" }
    $saved[$name] = ConvertTo-SecureString $values[$name] -AsPlainText -Force
    Export-Clixml -InputObject $saved -LiteralPath $Store
    Write-Host "$name subido." -ForegroundColor Green
}
Write-Host ('Secretos en Cloudflare: ' + ((& npx.cmd wrangler secret list --format json | ConvertFrom-Json).name -join ', '))
