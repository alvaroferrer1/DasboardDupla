# DOS ESPACIOS 2.0 · Álvaro + Angie

**Aplicación web privada creada para dos personas con dos espacios de proyectos, pero una sola colaboración.** No es Trello, Notion ni una plantilla de terceros: incluye su propio frontend, servidor Node.js, base de datos SQLite, API y sincronización de cambios.

> **IMPORTANTE:** La aplicación está construida y probada localmente, pero **no está alojada en Internet**. Para que Álvaro y Angie entren desde sus propias casas, desde móviles y ordenadores diferentes, hay que instalarla en un servidor accesible por ambos con HTTPS. El ZIP no crea por sí solo una URL pública.

## Lo esencial: ambos veis exactamente lo mismo

- Hay únicamente **dos cuentas privadas**. Se crean una sola vez: una para Álvaro y otra para Angie. No se permiten altas públicas ni un tercer usuario.
- Los dos accedéis al **mismo conjunto de proyectos, tareas, documentos, archivos, importes y comentarios**. No hay listas distintas por usuario ni privacidad separada por proyecto.
- Podéis crear, modificar y eliminar cualquier elemento de ambos espacios, aunque lo haya creado la otra persona.
- Asignar una tarea a Álvaro o Angie sirve **solo para saber quién se encarga**. No limita quién puede verla ni editarla.
- Al guardar un cambio se emite un evento de actualización por **SSE** (Server-Sent Events). La otra sesión conectada refresca su contenido. Cuando el otro está rellenando un formulario, se avisa de que hay cambios y se permite actualizar después, para no perder lo que escribía.
- Si ambos editáis una misma nota simultáneamente, el servidor utiliza **versiones** y rechaza guardar una copia obsoleta. No existe coedición letra a letra estilo Google Docs.

## Los dos espacios

### 1. Trabajo

Proyectos profesionales **conjuntos de marketing + desarrollo**, por ejemplo una web para un cliente donde Álvaro diseña/programa y Angie prepara comunicación y campañas. Ambos ven todo el proyecto.

- Ideas, proyectos, estado, descripciones y colores.
- Kanban: tareas, prioridades, responsables, fechas, mover con arrastrar y soltar, checklist de pasos.
- Hitos y fases de proyecto con hoja de ruta visual.
- Documentación por secciones: briefing, alcance, UX/UI, copywriting, estrategia, decisiones, notas, versiones.
- Presupuesto previsto y gasto real, clasificado por categorías.
- Fechas, agenda, comentarios, historial con autor y enlaces.
- Subir imágenes, PDFs o documentos hasta 6 MB por archivo.
- Plantillas opcionales al crear un proyecto: **Web + lanzamiento**, **Campaña de marketing**, **App o producto digital**.
- Laboratorio de IA para ideas, planificación, tareas, respuestas a medida y generación de **mockups web HTML/CSS**, con previsualización y descarga. **Requiere clave API propia y puede generar costes por consumo.**
- Importación manual de ideas copiadas de Claude, ChatGPT u otras herramientas directamente a las notas del proyecto.
- Webhooks HTTPS opcionales hacia n8n/Make cuando cambia algo en Trabajo. Incluyen metadatos, no el contenido completo de documentos.
- Enlaces a Figma, Canva, repositorios y diseños. **No existe todavía una integración automática de OAuth o archivos editables nativos de Figma/Canva.**

### 2. Planes en común

También es **100% compartido entre Álvaro y Angie**, no es una agenda individual de cada persona. Una idea de viaje que proponga Angie es un plan de ambos; una cena que proponga Álvaro también.

Tiene las mismas herramientas de proyectos, tareas y checklist, notas, hitos, presupuestos, fechas, archivos, enlaces, comentarios e historial. Además, incluye plantillas para **viajes**, **cenas** y **proyectos en común**.

El laboratorio IA y webhooks profesionales no están habilitados para este espacio. **Las sorpresas no son secretas:** ambos veréis los planes y sus modificaciones. Si queréis planificar un regalo oculto para la otra persona, esa funcionalidad habría que diseñarla aparte y definir cómo ocultar su actividad.

## Qué se ha probado

Se realizaron **34 comprobaciones automáticas de la API** con dos cuentas diferentes, incluyendo acceso a los mismos proyectos, creación y edición de tareas, subtareas, presupuestos, hitos, notas con conflicto de edición, archivos, calendarios, exportación, SSE, borrado y bloqueo de IA en Planes en común. Todas pasaron.

Se revisaron visualmente, mediante capturas reales del frontend con datos de demostración simulados, las vistas de inicio, Trabajo, proyecto, hoja de ruta, presupuesto, tareas y móvil. No se detectaron errores JavaScript en esas rutas. **Estas comprobaciones no equivalen a una auditoría de seguridad ni a pruebas exhaustivas en todos los navegadores.**

## Arrancar en tu ordenador (sin servicios externos)

**Necesitas:** Node.js 22.13 o superior y un navegador actual. No hace falta instalar ninguna dependencia npm; se usa el módulo SQLite de Node.

1. Descomprime el ZIP y abre una terminal en la carpeta `dos-espacios`.
2. Ejecuta `npm run setup` **una sola vez**. Te pedirá email y contraseña para Álvaro y luego para Angie. Usa contraseñas distintas de al menos 12 caracteres. No compartas las contraseñas en chats públicos.
3. Ejecuta `npm start`.
4. Abre `http://127.0.0.1:3077` en ese mismo ordenador.
5. Inicia sesión con cualquiera de las dos cuentas. Cada una tendrá las mismas capacidades.

Opcionalmente puedes arrancar con `INICIO_MAC.command` en Mac o `INICIO_WINDOWS.bat` en Windows tras instalar Node.js.

**Nota:** esto permite probarlo localmente, pero no habilita el acceso a distancia. La sincronización entre los dos necesita que ambas sesiones puedan llegar al **mismo servidor**.

## Publicación privada en Internet para los dos

El proyecto ya incluye `Dockerfile`, `compose.yaml` y `Caddyfile` con proxy y HTTPS automático. Para utilizarlo en Internet necesitáis un **dominio/subdominio** y un **VPS** al que ambos podáis llegar.

1. Configura un registro DNS A del dominio hacia la IP pública del servidor.
2. Instala Docker y el complemento Docker Compose en el VPS.
3. Copia la carpeta `dos-espacios` al VPS.
4. Copia `.env.example` a `.env`, define `DOMAIN=tusubdominio.tudominio.es` y, si procede, tus claves API. No publiques `.env`.
5. Ejecuta `docker compose build`.
6. **Solo en la primera instalación** ejecuta `docker compose run --rm app npm run setup` para crear las dos cuentas en el volumen persistente.
7. Arranca `docker compose up -d`.
8. Ambos abrís `https://tusubdominio.tudominio.es` desde vuestro navegador con las credenciales respectivas.

**Seguridad:** publica únicamente los puertos web 80/443, nunca el 3077 directamente. Protege las claves API, actualiza el VPS y haz copias de seguridad. Caddy renovará TLS automáticamente si el DNS apunta al servidor y 80/443 están accesibles. No guardes información crítica hasta revisar esta instalación y su política de backups.

## Configurar IA solo para Trabajo

- Copia `.env.example` a `.env`.
- Introduce tu `OPENAI_API_KEY` en el **servidor**, jamás en el navegador.
- Selecciona `OPENAI_MODEL` compatible con tu cuenta de API.
- Reinicia el servidor.
- Entra a un proyecto de Trabajo, pestaña **Laboratorio IA**.

Esta funcionalidad llama a un proveedor externo con título, descripción, tareas y algunos fragmentos de notas del proyecto. Usa una cuenta API independiente de la suscripción ChatGPT y puede tener coste por tokens. Los resultados de texto o mockups se guardan en una nota solo cuando el usuario lo decide. Los mockups son HTML/CSS, **no son un componente nativo de Figma ni un vídeo renderizado**.

Si quieres n8n/Make, utiliza `WORK_WEBHOOK_URL=https://...` y crea el flujo receptor por separado. Sin webhook configurado no hay comunicación externa.

## Backup, privacidad y límites

- Toda la información se guarda en el directorio `data/` (SQLite `dos.sqlite` y carpeta `uploads/`) o en el volumen Docker `dos_data`.
- `Ajustes → Exportar todo` genera un **JSON** con proyectos, listas, hitos, gastos, notas, eventos y metadatos, pero **no los bytes de los archivos adjuntos**.
- Para la copia integral, respalda el directorio/volumen `data/` completo. Con servidor activo, usa un mecanismo de copia consistente de SQLite; copiar un archivo abierto sin más no garantiza integridad.
- Las contraseñas se procesan con `scrypt`; cookies de sesión HTTP-only; bloqueo temporal tras demasiados intentos; límites de fichero y comprobaciones de origen. **No implica que el software esté auditado para producción abierta al público.**
- Pendiente: notificaciones push, integración bidireccional con Google Calendar, OAuth con Figma/Canva, edición letra a letra simultánea, restauración de datos desde JSON, sincronización offline y planificación secreta de sorpresas.

## Archivos principales

- `server.mjs`: API, autenticación, SSE, seguridad, upload, IA y webhook.
- `db.mjs`: SQLite, tablas y persistencia.
- `scripts/setup.mjs`: creación privada de las dos cuentas.
- `public/index.html`, `public/style.css`, `public/app.js`: interfaz web responsive.
- `Dockerfile`, `compose.yaml`, `Caddyfile`: despliegue.
- `.env.example`: variables de configuración.

**DOS ESPACIOS 2.0** | Un solo equipo. Dos categorías. Todo compartido.
