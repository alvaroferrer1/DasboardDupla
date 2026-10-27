@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas instalar Node.js 22.13 o superior: https://nodejs.org
  pause
  exit /b 1
)
if not exist "data\dos.sqlite" (
  echo Primera instalacion: crea las dos cuentas privadas.
  call npm run setup
  if errorlevel 1 (pause & exit /b 1)
)
echo Abre http://127.0.0.1:3077 en tu navegador.
call npm start
pause
