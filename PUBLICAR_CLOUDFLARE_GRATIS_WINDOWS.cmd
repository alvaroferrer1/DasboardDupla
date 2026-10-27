@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===========================================
echo DOS ESPACIOS - CLOUD SIN TARJETA
 echo ===========================================
where node >nul 2>nul
if errorlevel 1 (
 echo FALTA Node.js. Instala Node 22 o superior desde https://nodejs.org/
 pause
 exit /b 1
)
node --version
node scripts\check-node-version.mjs
if errorlevel 1 goto :failure
echo.
echo Primero se comprobará el proyecto; después autorizarás Cloudflare en el navegador.
call npm run check:cloud
if errorlevel 1 goto :failure
call npm test
if errorlevel 1 goto :failure
call npx --yes wrangler@4 login
if errorlevel 1 goto :failure
call npx --yes wrangler@4 deploy
if errorlevel 1 goto :failure
echo.
echo A CONTINUACION: configuracion segura de la clave de alta inicial.
echo Guarda la clave que veras en tu gestor de contrasenas. NO LA COMPARTAS.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUBLICAR_CLOUDFLARE_PASO_2.ps1"
if errorlevel 1 goto :failure
echo.
echo.
echo VERIFICACION OPCIONAL DEL DOMINIO PUBLICO: se comprueban cabeceras, cookies y privacidad antes del alta.
set /p "DOS_URL=Introduce la URL completa https://...workers.dev/ que te ha dado Cloudflare (o ENTER para omitir): "
if not "%DOS_URL%"=="" (
    call npm run check:live -- "%DOS_URL%"
    if errorlevel 1 echo ATENCION: La comprobacion de la URL ha fallado. Consulta la guia y NO guardes aun datos reales.
)
echo.
echo Al acabar, abre la URL mostrada por Cloudflare y registra las dos cuentas.
echo Este PC se puede APAGAR despues de publicar: la web estara en Cloudflare.
pause
exit /b 0
:failure
echo.
echo Ha fallado algun paso. No compartas secretos ni claves privadas.
pause
exit /b 1
