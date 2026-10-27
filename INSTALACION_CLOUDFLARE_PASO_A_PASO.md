# DOS ESPACIOS 4.4.1 · Publicar para Álvaro y Angie sin pagar ni introducir tarjeta

**Destino exclusivo:** Cloudflare Workers + Durable Objects SQLite. No tienes que crear proyectos Supabase. Una sola URL HTTPS, una única base de datos cloud, exactamente dos cuentas, acceso desde cualquier PC o móvil y sin necesidad de mantener ningún equipo encendido.

> **Revisión de instalador V4.4.1:** compatible con Windows PowerShell 5.1 y verifica Node.js >=22.13; Cloudflare ejecuta el Worker antes de servir los recursos estáticos para aplicar las cabeceras de seguridad. Estas mejoras todavía deben validarse contra la URL real tras publicar.

## 0. Avisos importantes antes de publicar

- **No es una URL ya publicada:** para recibirla debes autorizar Cloudflare una vez desde tu cuenta. Nadie puede generar una URL real de tu cuenta sin esa autorización.
- **Gratis con límites, no ilimitado:** dentro de Workers Free/Durable Objects Free. Un plan gratuito puede alcanzar cuotas, fallar temporalmente o sufrir una incidencia. No hay SLA del 100 %.
- El backend no usa tu PC. Cloudflare ejecuta código cuando llegan peticiones; puede hibernar el Durable Object entre peticiones sin borrar la base de datos. HTTPS y WSS gestionados por Cloudflare.
- **No compartas nunca** contraseñas de usuario, la clave de alta `SETUP_TOKEN`, cookies ni tokens por WhatsApp, ChatGPT o repositorios. A Angie le darás solo la URL y **su propia contraseña por un canal seguro**. Lo ideal es que Angie cambie después su contraseña desde Ajustes.
- No subas contenidos privados reales hasta verificar las cuentas, almacenamiento, dos navegadores, archivos y exportaciones.

## 1. Crea tu cuenta Cloudflare desde Windows

1. Abre https://dash.cloudflare.com/sign-up en Chrome, Firefox o Edge.
2. Introduce correo y contraseña. Verifica el correo cuando Cloudflare lo pida.
3. Inicia sesión en https://dash.cloudflare.com/ . Si solicita un plan, **elige Free**. **No añadas tarjeta ni actives planes de pago**.
4. Ve a **Workers & Pages** (en algunas versiones se llama **Workers & Pages / Compute**). Si te pide establecer el subdominio `workers.dev`, elige uno disponible. Esto no compra un dominio.
5. No hace falta crear manualmente el Worker desde la web: lo instalará el script del proyecto.

## 2. Descarga y prepara el proyecto (una sola vez)

1. Descarga el ZIP `DOS_ESPACIOS_V4_4_1_LISTO_CLOUDFLARE.zip`.
2. En Windows: botón derecho → **Extraer todo...**. No ejecutes los comandos desde dentro de la ventana del ZIP; entra en la carpeta **`dos-espacios`** extraída.
3. Comprueba que tienes **Node.js 22.13 o posterior**. Para instalarlo: https://nodejs.org/ . Descarga la versión LTS de Windows, ejecuta instalador con valores predeterminados y vuelve a abrir la terminal.
4. Opcional: en la carpeta `dos-espacios`, clic sobre la barra de ruta del explorador, escribe `powershell` y pulsa Intro. Ejecuta `node --version`. Debe mostrar `v22.13.0` o superior.

## 3. Publica sin usar terminales complejas

1. En la carpeta `dos-espacios`, ejecuta **`PUBLICAR_CLOUDFLARE_GRATIS_WINDOWS.cmd`** (doble clic).
2. El script primero comprueba la sintaxis del backend cloud y ejecuta el conjunto de pruebas; si alguna falla, se detiene. **No borres ni modifiques archivos para eludir una prueba**.
3. Después ejecuta `wrangler login`. Se abrirá tu navegador con una autorización de Cloudflare. Inicia sesión con **tu cuenta Free** y pulsa **Allow / Autorizar** para dar acceso al despliegue.
4. Vuelve a la ventana del script. Se ejecutará `wrangler deploy` y publicará el Worker llamado `dos-espacios-compartido` en tu cuenta.
5. Si todo va bien, verás una dirección parecida a `https://dos-espacios-compartido.TU-SUBDOMINIO.workers.dev`. **Copia la dirección exacta que aparezca en tu terminal**. `TU-SUBDOMINIO` no es un texto fijo; Cloudflare asigna el tuyo.
6. El instalador ejecuta un paso adicional que genera una **clave aleatoria de alta** para dos usuarios. Anótala temporalmente en un gestor de contraseñas seguro. **No es tu contraseña de Cloudflare**. No la envíes a nadie. El script la introduce como secreto cifrado del Worker y te avisa si falla.
7. Espera la confirmación del script. No cierres la ventana antes de llegar al último mensaje.

### Si Windows te bloquea el CMD

Puedes pulsar `Win + R` → `cmd` y navegar al directorio, o abrir PowerShell desde el explorador como se indica arriba y ejecutar estos comandos **uno por uno**:

```powershell
npm run check:cloud
npm test
npx --yes wrangler@4 login
npx --yes wrangler@4 deploy
npx --yes wrangler@4 secret put SETUP_TOKEN
```

Si usas el último comando manual, introduce una clave privada y aleatoria de al menos 32 caracteres, no un ejemplo escrito en la guía. Puedes pedir a un gestor de contraseñas que genere un secreto largo. **La versión CMD lo genera automáticamente**.

En PowerShell también puedes ejecutar `npm run check:live -- https://TU-URL-REAL.workers.dev/` para comprobar la web una vez publicada. No cambies el nombre `dos-espacios-compartido` en `wrangler.jsonc` después de haber creado datos, o estarás creando otro Worker con otra base.

## 4. Primera visita: activa tus dos cuentas

1. Abre la URL **HTTPS** real de Cloudflare en tu navegador.
2. Deberías ver la pantalla de activación privada de DOS ESPACIOS.
3. Introduce la **clave privada de alta** generada en el paso 3.
4. Escribe **tu correo real** en Correo de Álvaro y una contraseña única de 12 caracteres o más.
5. Escribe **el correo de Angie** en Correo de Angie y otra contraseña única, distinta de la anterior.
6. Pulsa **Crear nuestras dos cuentas**. Solo se crean esas dos. El registro se cerrará definitivamente para visitantes posteriores.
7. Ve a la pantalla de inicio de sesión e inicia sesión con tus credenciales.
8. Angie entra **a la misma URL** desde otro ordenador o móvil, con **su correo y contraseña**. Puede iniciar sesión cuando tú estés conectado o desconectado.

Si la pantalla dice «Alta web deshabilitada», revisa en Cloudflare el Worker → **Settings → Variables and Secrets**: tiene que existir `SETUP_TOKEN` (no hace falta mostrar ni copiar su valor). El script `PUBLICAR_CLOUDFLARE_PASO_2.ps1` también permite configurarlo. No pegues secretos aquí en un chat.

## 5. Prueba real de los dos desde redes distintas

Hazlo antes de guardar información importante:

- **Prueba A, privacidad:** desde una ventana incógnita entra en la URL. Debes ver el login. Abre `/api/dashboard` sin iniciar sesión: debe aparecer un error 401, no vuestros proyectos.
- **Prueba B, múltiples proyectos:** Álvaro crea dos proyectos diferentes en `Trabajo`; Angie comprueba que aparecen los dos.
- **Prueba C, segundo espacio:** Angie crea un proyecto en `Planes en común`; Álvaro debe verlo sin crear otro usuario ni espacio.
- **Prueba D, sincronización:** Álvaro abre un proyecto mientras Angie lo edita. Después de guardar, el otro navegador debe actualizarlo o avisar de que hay cambios nuevos. **No es coedición letra a letra**.
- **Prueba E, integridad:** ambos editan la misma tarea a la vez. La revisión obsoleta tiene que devolver 409 en lugar de borrar silenciosamente el cambio del otro.
- **Prueba F, archivos:** Álvaro sube un PDF o archivo pequeño; Angie lo descarga; al cerrar ambos sesión y regresar, sigue existiendo.
- **Prueba G, seguridad:** cierra sesión y comprueba que los enlaces privados de descarga ya no funcionan.
- **Prueba H, apagado del PC:** apaga tu ordenador; Angie vuelve a abrir la URL desde su móvil o PC y debe poder entrar y ver los mismos proyectos.
- **Prueba I, exportación:** desde Ajustes descarga una copia completa y comprueba que se guardó en un lugar privado. **La exportación NO dispone aún de importación/restauración automática segura**.
- **Prueba J, monitor automático HTTPS:** abre una terminal en la carpeta y ejecuta:

```powershell
npm run check:live -- https://LA-URL-REAL.workers.dev/
```

Tiene que comprobar HTTPS, privacidad de API, cabeceras de protección, carga de JS/CSS y rechazo de origen cruzado. Es un smoke test limitado, no un pentest. **No ejecutarlo contra sitios ajenos**.

## 6. Seguridad, copia de datos y mantenimiento

- Las claves API opcionales de servicios externos se configuran solo como **secretos**, nunca en HTML ni `wrangler.jsonc`.
- **Backup manual:** en Ajustes → `Copia completa + archivos`. Contiene datos personales. Guárdala cifrada y fuera de Cloudflare, en sitio seguro. Todavía no hay restauración automática desde este JSON.
- Cloudflare Durable Objects SQLite tiene recuperación de punto temporal (PITR), con límites/retención documentados. Se debe probar el procedimiento real antes de depender de él. No sustituye una copia externa.
- Las cuotas gratuitas (peticiones, operaciones de almacenamiento, tamaño por objeto) se consultan en Cloudflare → Workers & Pages → tu Worker → Metrics/Analytics. Al alcanzar el límite gratuito puede dejar de aceptar operaciones hasta que se restablezca la cuota.
- **Actualizar la web:** haz backup antes de cambios, usa el mismo nombre/configuración del Worker y ejecuta `npx --yes wrangler@4 deploy` desde la misma carpeta actualizada. No borres Durable Objects ni «reinicies» la base.
- Si el proyecto pasa a usos comerciales o recoge datos de terceros, revisa las obligaciones de RGPD, condiciones y política de privacidad según el tratamiento real. El uso privado entre dos personas requiere una revisión proporcional, no textos legales ficticios.

## 7. Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `node` no se reconoce | Instala Node LTS, cierra y reabre la terminal |
| Error al descargar Wrangler | Comprueba Internet/firewall; npm debe tener acceso al registro de paquetes |
| Wrangler pide iniciar sesión | Termina la autorización en el navegador y vuelve al instalador |
| Cloudflare solicita tarjeta/upgrade | Detente. No aceptes un plan de pago. Verifica que estás usando Workers Free |
| Falla `wrangler deploy` | Copia **solo el mensaje de error**, eliminando tokens, correos o datos personales |
| Error 403 en alta | Comprueba la clave inicial; tras muchos intentos, espera antes de reintentar |
| Dos cuentas ya creadas | No restablezcas la base. Inicia sesión; si olvidaste contraseña, necesitamos recuperación autorizada |
| No se sincroniza | Comprueba que ambos usan la misma URL y no hay errores WebSocket en el navegador |
| No hay URL | El despliegue no se terminó; no se puede inventar ni deducir el subdominio |

## 8. Lo que NO está garantizado

No podemos garantizar 100 % uptime, que nunca se agoten las cuotas gratuitas, que el servidor nunca sufra errores de plataforma, auditoría de seguridad independiente, edición simultánea carácter a carácter, ni recuperación automática total de la base en un solo clic. **La URL de Cloudflare debe probarse antes de compartir datos reales**.

Documentación oficial actualizada en octubre 2026:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
