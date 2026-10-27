$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $MyInvocation.MyCommand.Path
$TS=Get-Command tailscale -ErrorAction SilentlyContinue
if($TS){$TSExe=$TS.Source}elseif(Test-Path "$env:ProgramFiles\Tailscale\tailscale.exe"){$TSExe="$env:ProgramFiles\Tailscale\tailscale.exe"}else{$TSExe=$null}
if($TSExe){
 Write-Host 'Se desactivarán todas las exposiciones Funnel de este equipo.' -ForegroundColor Yellow
 & $TSExe funnel reset
}
$PidFile=Join-Path $Root '.local-private/server.pid'
if(Test-Path $PidFile){$AppPid=[int](Get-Content -Raw $PidFile); Stop-Process -Id $AppPid -Force -ErrorAction SilentlyContinue;Remove-Item $PidFile -Force}
Write-Host 'DOS ESPACIOS dejó de compartirse desde este equipo.'
