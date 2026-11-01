# Publica (o actualiza) la entrada alternativa de DUPLA en Google/Firebase. Uso: npm run firebase:publicar
# La primera vez: crea el proyecto en console.firebase.google.com (plan Blaze) y ejecuta «npx firebase-tools login».
$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) 'firebase'
$rc = Join-Path $dir '.firebaserc'
if (-not (Test-Path $rc)) {
    $id = Read-Host 'ID del proyecto de Firebase (lo ves en Configuración del proyecto, p. ej. dupla-12345)'
    if ($id -notmatch '^[a-z0-9-]{6,30}$') { throw 'ID de proyecto no válido.' }
    Set-Content -LiteralPath $rc -Encoding utf8 -Value ('{ "projects": { "default": "' + $id + '" } }')
}
Push-Location (Join-Path $dir 'functions')
try { & npm.cmd install --silent --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm install falló' } } finally { Pop-Location }
Push-Location $dir
try {
    & npx.cmd --yes firebase-tools@14 deploy --only functions:dupla --force
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo publicar en Firebase. ¿Has hecho «npx firebase-tools login» y activado el plan Blaze?' }
} finally { Pop-Location }
Write-Host ''
Write-Host 'Entrada de Google publicada. Su dirección es la URL que acaba en .run.app que aparece arriba (Function URL).' -ForegroundColor Green
Write-Host 'Ábrela en el móvil y guárdala en la pantalla de inicio como «DUPLA (Google)».'
