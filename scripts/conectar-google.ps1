# DUPLA: conecta el calendario conjunto con Google en equipo.
# Abre Google en tu navegador (eliges alvarosferris@gmail.com y aceptas), espera, vincula «DUPLA · Nuestro calendario»
# y comprueba de verdad: leer, crear, editar y borrar un evento de prueba. No guarda nada en el proyecto.
$ErrorActionPreference = 'Stop'
$Url = 'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev'
$c = Import-Clixml (Join-Path $env:USERPROFILE '.dupla\credencial.xml')
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$H = @{ Origin = $Url }
function Api($m, $p, $b) { if ($b) { Invoke-RestMethod "$Url$p" -Method $m -ContentType 'application/json; charset=utf-8' -Headers $H -Body ([Text.Encoding]::UTF8.GetBytes(($b | ConvertTo-Json -Compress))) -WebSession $s } else { Invoke-RestMethod "$Url$p" -Method $m -Headers $H -WebSession $s } }
$null = Api POST '/api/login' @{ email = $c.UserName; password = $c.GetNetworkCredential().Password }
$st = Api GET '/api/google/shared/status'
if (-not $st.connected) {
  $start = Api POST '/api/google/start' @{}
  Write-Host 'Abriendo Google en tu navegador: elige alvarosferris@gmail.com y acepta los permisos.' -ForegroundColor Cyan
  Start-Process $start.url
  $t0 = Get-Date
  while (-not $st.connected) { Start-Sleep 3; $st = Api GET '/api/google/shared/status'; if (((Get-Date) - $t0).TotalMinutes -gt 9) { throw 'Tiempo agotado esperando a Google.' } }
  Write-Host 'OK Google conectado.' -ForegroundColor Green
}
if (-not $st.created) { $null = Api POST '/api/google/shared/attach' @{}; $st = Api GET '/api/google/shared/status'; Write-Host "OK vinculado: $($st.title)" -ForegroundColor Green }
$from = (Get-Date).AddDays(-30).ToString('yyyy-MM-dd'); $to = (Get-Date).AddDays(365).ToString('yyyy-MM-dd')
$list = Api GET "/api/google/shared/events?from=$from&to=$to"
Write-Host "LEER: $($list.items.Count) eventos en el calendario conjunto (proximo mes a un ano)." -ForegroundColor Green
$day = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')
$new = Api POST '/api/google/shared/events' @{ title = 'DUPLA prueba de conexion (se borra sola)'; date = $day; time = '12:00'; location = ''; notes = 'Evento temporal de comprobacion'; request_id = [guid]::NewGuid().ToString() }
Write-Host "CREAR: evento creado en Google ($($new.id))." -ForegroundColor Green
$ev = (Api GET "/api/google/shared/events?from=$day&to=$day").items | Where-Object id -eq $new.id
if (-not $ev) { throw 'El evento creado no aparece al leer.' }
$null = Api PUT "/api/google/shared/events/$($new.id)" @{ title = 'DUPLA prueba editada (se borra sola)'; date = $day; time = '13:30'; location = ''; notes = ''; etag = $ev.etag }
$ev2 = (Api GET "/api/google/shared/events?from=$day&to=$day").items | Where-Object id -eq $new.id
if ($ev2.title -ne 'DUPLA prueba editada (se borra sola)' -or $ev2.time -ne '13:30') { throw 'La edicion no se refleja.' }
Write-Host 'EDITAR: cambio guardado en Google y leido de vuelta.' -ForegroundColor Green
$null = Api DELETE "/api/google/shared/events/$($new.id)"
$gone = (Api GET "/api/google/shared/events?from=$day&to=$day").items | Where-Object id -eq $new.id
if ($gone) { throw 'El evento de prueba no se borro.' }
Write-Host 'BORRAR: evento de prueba eliminado. Tu calendario queda como estaba.' -ForegroundColor Green
Write-Host 'LISTO: Google Calendar conectado y verificado (leer, crear, editar, borrar).' -ForegroundColor Green
