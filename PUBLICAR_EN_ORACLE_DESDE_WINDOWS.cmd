@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUBLICAR_EN_ORACLE_DESDE_WINDOWS.ps1"
echo.
pause
