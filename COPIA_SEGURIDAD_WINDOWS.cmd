@echo off
cd /d "%~dp0"
if not exist ".local-private\backups" mkdir ".local-private\backups"
set "DOS_BACKUP_DIR=%CD%\.local-private\backups"
node scripts/backup.mjs
if errorlevel 1 echo ERROR: no se pudo crear la copia de seguridad.
pause
