> **ATENCIÓN: GUÍA HISTÓRICA V4.3.** Para la versión revisada V4.4 usa [INSTALACION_CLOUDFLARE_PASO_A_PASO.md](INSTALACION_CLOUDFLARE_PASO_A_PASO.md).

# DOS ESPACIOS 4.3 · Nube sin tarjeta, sin PC encendido

**Este ZIP contiene una adaptación del backend V4.2 a Cloudflare Workers + Durable Objects SQLite.** No altera otros proyectos ni cuentas de Supabase. La web y el backend están diseñados para ejecutarse bajo una URL HTTPS de Cloudflare y guardar todos los datos de DOS ESPACIOS en una base SQLite duradera dentro de Cloudflare.

## Resultado previsto

- Un único enlace `https://dos-espacios-compartido.<subdominio>.workers.dev` (el subdominio se asigna al publicar, no es una URL conocida de antemano).
- Dos usuarios únicos: Álvaro y Angie, ambos pueden ver y editar los mismos proyectos de Trabajo y Planes en común.
- Varios proyectos dentro de cada espacio, con tareas, notas, hitos, votaciones, presupuestos, calendarios, ideas, conocimiento, datos y archivos adjuntos.
- Colaboración mediante WebSockets de Cloudflare Durable Objects con almacenamiento persistente.
- No necesita que un ordenador doméstico ni un proceso Node estén encendidos. El servicio despierta con cada petición, **sin el periodo de suspensión de Render Free**.
- Sin conexión a Supabase, GitHub, OpenAI, n8n o cualquier otro proveedor para la funcionalidad básica. Estos conectores son opcionales de cara a mejoras futuras.

## Qué necesitas hacer una sola vez (Windows)

1. Crea cuenta gratuita Cloudflare: https://dash.cloudflare.com/sign-up . Elige **Workers Free**. No actives ningún servicio o plan de pago.
2. Descomprime el ZIP en una carpeta, sin mover archivos individuales.
3. Instala Node.js 22+ si aún no lo tienes (https://nodejs.org/).
4. Haz doble clic en `PUBLICAR_CLOUDFLARE_GRATIS_WINDOWS.cmd` dentro de `dos-espacios`.
5. Autoriza Cloudflare en el navegador. El instalador ejecuta comprobaciones y `wrangler deploy`.
6. Copia la URL HTTPS `workers.dev` que devuelve Wrangler. No la inventes: **solo aparece cuando la cuenta autoriza el despliegue**.
7. El instalador genera una clave aleatoria de alta inicial y la guarda como secreto de Cloudflare. Guárdala en tu gestor de contraseñas. **No la envíes en el chat ni en ningún repositorio.**
8. Abre tu URL HTTPS y, en la pantalla de alta inicial, indica los dos correos y crea contraseñas diferentes de mínimo 12 caracteres. La clave de instalación solo funciona para ese primer alta y no se permite crear una tercera cuenta.
9. Entra con tu cuenta y crea un proyecto. Angie abre la misma URL HTTPS en otro dispositivo y entra con su cuenta. Ambos pueden modificarlo. El PC inicial puede apagarse.

## Forma alternativa de publicarlo, sin CMD

Desde una terminal abierta dentro de la carpeta `dos-espacios`:

```powershell
npm run check:cloud
npm test
npx --yes wrangler@4 login
npx --yes wrangler@4 deploy
npx --yes wrangler@4 secret put SETUP_TOKEN
```

En el último comando introduce una clave criptográfica de 32 bytes o más generada con un gestor seguro de contraseñas. **No guardes el secreto en `.env`, GitHub ni el frontend.**

## Arquitectura

```text
Ordenadores/móviles de Álvaro y Angie
           | HTTPS + WSS
           v
Cloudflare Worker: frontend estático + cabeceras de seguridad
           | rutas /api/**
           v
Cloudflare Durable Object único: API privada y WebSockets hibernables
           | SQL transaccional
           v
SQLite persistente en Durable Objects: usuarios, sesiones, proyectos,
notas, archivos por fragmentos, decisiones, actividad, conocimiento y analítica
```

La nueva aplicación es una adaptación del backend SQL original, no un dashboard reconstruido de cero. Los archivos estáticos de `edge/public/` conservan la interfaz V4.2, con el canal en vivo migrado de SSE a WebSockets.

## Seguridad

- Cookies de sesión `HttpOnly`, `Secure`, `SameSite=Strict`.
- No hay registro abierto al público. La primera creación requiere un secreto que se introduce una única vez.
- Verificación de sesión y derechos en cada ruta API, controles de origen en operaciones de escritura.
- Límite de intentos de login/alta persistido en la base de datos.
- Protección de cabeceras y CSP en el Worker, contraseña derivada por PBKDF2 con salt individual.
- Los datos y archivos no se exponen directamente mediante URLs públicas. Las descargas requieren estar autenticado.
- La IA externa solo en Trabajo y desactivada hasta configurar un secreto voluntariamente.

**Una prueba de código local NO garantiza ausencia de vulnerabilidades.** Antes de considerarlo plenamente auditado hay que probar el despliegue en Cloudflare real, las sesiones bajo HTTPS, límites de Cloudflare y recuperación de datos.

## Copia y recuperación

- Desde **Ajustes**, utiliza "Copia completa + archivos". Descarga un JSON privado con proyectos, tareas, notas, conocimiento, actividad, archivos adjuntos y usuarios **sin contraseñas ni tokens**. No tiene todavía un importador de restauración de un clic; consérvalo cifrado y nunca lo publiques.
- La infraestructura Durable Objects SQLite de Cloudflare dispone de recuperación por puntos en el tiempo (PITR) a través de sus APIs, sujeta a las condiciones del servicio. No consideres esta copia equivalente a una copia independiente: exporta periódicamente fuera del proveedor.
- Los datos locales del ZIP V4.2 **no se transfieren automáticamente** a la nube. Esta V4.3 inicia una base nueva y vacía; el proyecto anterior no tenía una web pública en funcionamiento. Si ya tienes datos reales guardados localmente, **no los borres**: se necesita una migración específica antes de eliminar esa base.

## Precio y límites (comprobados octubre de 2026)

- Cloudflare Workers Free: $0, sin tarjeta para empezar, hasta 100.000 peticiones/día.
- Durable Objects SQLite respaldados en Workers Free: sí, con cuotas de uso/almacenamiento. El almacenamiento por objeto puede estar limitado a 1 GB en el plan gratis; comprueba el panel.
- Si superas las cuotas gratuitas, las operaciones pueden fallar. Un plan gratuito no garantiza SLA, 100 % de disponibilidad ni copias externas automáticas.
- Cloudflare **puede hibernar el proceso en memoria** para ahorrar recursos, pero la base de datos no desaparece y las peticiones posteriores lo activan. Esto es distinto de dejar inaccesible la app esperando un despertar del servicio de Render.

Documentación oficial:
https://developers.cloudflare.com/durable-objects/
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

## Estado de pruebas y límites importantes

- Las 35 pruebas anteriores de DOS ESPACIOS local continúan disponibles.
- Hay una prueba ampliada nueva del backend adaptado que ejercita dos sesiones, dos espacios, varios proyectos, permisos, notas, tareas, conflictos, búsqueda, notificaciones, análisis, exportaciones, archivos y snapshots.
- **No se ha publicado en ninguna cuenta**. Las pruebas locales con una API compatible con el almacenamiento SQL de Durable Objects no equivalen a una prueba E2E del runtime real Cloudflare.
- En este entorno el gestor npm no tiene salida al registro público y no se ha podido descargar Wrangler para iniciar el emulador oficial. La prueba obligatoria tras conectar Cloudflare sigue pendiente.
- No están implantadas integraciones de IA o n8n en una cuenta real; quedan desactivadas, tal como se solicitó.
