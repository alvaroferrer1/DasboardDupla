# DUPLA dual: qué falta para poder salir de Cloudflare

Objetivo: que DUPLA pueda funcionar **igual** en Cloudflare o en otro servidor (VPS, Docker, Railway, Oracle…), para no depender de un solo proveedor y tener un servidor de reserva si Cloudflare falla.

Para pedirlo: «haz MIGRACION_DUAL.md» (entero) o «haz el paso N de MIGRACION_DUAL.md».

Estado a 2026-10-28 (v6.8.0): **no empezado**. Este documento es el inventario de lo que hay que hacer.

---

## 1. Lo que ya está garantizado

- **GitHub = web publicada.** `npm run publicar` despliega, comprueba que el código en vivo es el local y hace `git push origin main <etiqueta>`. Cada publicación queda con una etiqueta `publicado-AAAAMMDD-HHMMSS`.
- **Datos copiados fuera de Cloudflare:**
  - En cada publicación se guarda una copia JSON completa en `RESPALDOS_PRIVADOS_NO_COMPARTIR/` (las 15 últimas), en el PC de Álvaro.
  - Cada semana se guarda una copia cifrada en Google Drive (`dupla-copia-AAAA-MM-DD.dupla`, las 8 últimas), una vez conectado Drive en Ajustes › Datos.
- **Restaurar:** `POST /api/snapshot/restore` carga una copia JSON. Pide la contraseña y una confirmación.
- **Las pruebas ya ejecutan toda la API fuera de Cloudflare.** `tests/cloud-edge.test.mjs` simula la base de datos con `node:sqlite` (`DatabaseSync`). Esa es la prueba de que el código es portable con un adaptador.

## 2. Lo que se lleva tal cual (≈ 90 % del código)

- La interfaz completa: `edge/public/` (app.js, style.css, `m/*.js`, push-sw.js, manifest, iconos).
- La lógica y la API: `edge/api.mjs`, `edge/v6.mjs`, `edge/db.mjs`, `edge/schema.mjs`, `edge/passkeys.mjs`, `edge/web-push.mjs`, `edge/google-calendar.mjs`, `edge/integrations.mjs`. Usan Web estándar: `fetch`, `Request`/`Response`, WebCrypto.
- Google Calendar, Google Drive, push, passkeys y el correo con Resend funcionan contra servicios externos y no dependen de Cloudflare. Hay que cambiar la URL pública (ver el paso 7).

## 3. Lo que depende de Cloudflare y su sustituto

| Pieza en Cloudflare | Dónde se usa | Sustituto en otro servidor |
|---|---|---|
| **Worker** (`edge/worker.mjs`, entrada `fetch`) | Recibe todas las peticiones | Servidor Node 22+ (`node:http`) que convierta la petición a `Request` y llame al mismo código |
| **Durable Object `DosRoom`** (`shared-home`) | Una sola «sala» con todos los datos y el tiempo real | Un único proceso Node que guarde la misma instancia de la API en memoria |
| **SQLite del Durable Object** (`ctx.storage.sql`, `transactionSync`) | `edge/db.mjs` (≈ 70 tablas) | `node:sqlite` en un archivo `data/dupla.sqlite` con un adaptador `{sql.exec, transactionSync}`. Ya existe en las pruebas: `tests/cloud-edge.test.mjs` |
| **KV del Durable Object** (`storage.get` / `storage.put`) | Marcas de la copia diaria y otros datos pequeños | Tabla `kv(key, value)` en el mismo SQLite, dentro del adaptador |
| **Alarma cada hora** (`setAlarm` en `worker.mjs`) | Trabajos: reminders, guardian, resumen, repaso, avisos-dupla, backup, drive, email, push (y automations/webhooks si están activados) | `setInterval` de 1 hora en el proceso Node que ejecute la misma lista de trabajos con `alertFailure` |
| **WebSockets con hibernación** (`acceptWebSocket`, `getWebSockets`, `serializeAttachment`) | Tiempo real entre los dos (cambios en vivo, reuniones) | Paquete `ws` y una lista de conexiones en memoria con el mismo «attachment» |
| **ASSETS** (archivos de `edge/public`) | Servir la interfaz | Servir `edge/public` como archivos estáticos desde Node o Caddy, con las mismas cabeceras de caché |
| **Workers AI** (`env.AI`) | Agente `@cf/openai/gpt-oss-120b`; tickets y reservas con imagen `@cf/meta/llama-4-scout-17b-16e-instruct`; búsqueda semántica `@cf/baai/bge-m3`; dictado `@cf/openai/whisper-large-v3-turbo`; reservas en PDF `env.AI.toMarkdown` | Un objeto `env.AI` falso con la misma forma (`run(model, input)` y `toMarkdown`) que redirija a otro proveedor. Opciones: OpenAI (ya hay `OPENAI_API_KEY` en el código), Ollama local, o la API REST de Workers AI con token, que funciona fuera de Cloudflare. Para PDF: `pdfjs` o `pdf-parse` |
| **R2 `BACKUP_BUCKET`** (opcional, no configurado) | Copia diaria externa | Carpeta local, S3 compatible, o solo Drive |
| **TURN de Cloudflare** (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`) | Videollamadas cuando una red bloquea el P2P | coturn propio o cualquier TURN con usuario y clave (cambio en `edge/v6.mjs`, ruta de ICE) |
| **Secretos** (`wrangler secret`) | Ver la sección 4 | `.env` en el servidor, fuera de git (`.env` ya está en `.gitignore`) |
| **Despliegue** (`npm run publicar` con wrangler) | Publicar | Dockerfile o servicio systemd y un script `publicar:dual` que despliegue en los dos sitios |

> La versión antigua para Node (`server.mjs`, `db.mjs` y `public/` en la raíz, Dockerfile y compose.yaml) es la v4/v5 y **no sirve**. No tiene la mayoría de funciones de la v6. Lo correcto es reutilizar `edge/` con adaptadores, no recuperar esa versión.

## 4. Secretos y variables que hay que tener en el otro servidor

Solo se apuntan los nombres; los valores nunca van en git.

- `PUBLIC_ORIGIN`: la URL pública nueva.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`: el cliente OAuth de Google Cloud.
- `INTEGRATION_ENCRYPTION_KEY`: **imprescindible.** Cifra los tokens de Google y **la copia de Drive**; sin ella la copia de Drive no se puede abrir. Hay copia cifrada en `%USERPROFILE%\.dupla\secretos.xml`.
- `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_JWK`, `PUSH_VAPID_SUBJECT`: hay que usar las mismas claves, o cada dispositivo tendrá que volver a activar los avisos. Copia en `secretos.xml`.
- `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL`: correo.
- `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`: TURN, o los datos del TURN sustituto.
- Opcionales: `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_MODEL`, `WORK_WEBHOOK_URL`, `DUPLA_AUTOMATIONS_ENABLED`, `SETUP_TOKEN`, `DEV_MODE` (nunca `true` en producción).

## 5. Qué se pierde o cambia al mover datos

- **Sesiones:** no van en la copia. Cada uno vuelve a entrar con su contraseña.
- **Conexiones de Google** (calendario conjunto, personales, Drive): no van en la copia por seguridad. Hay que reconectarlas en Ajustes, con la nueva URL autorizada en Google Cloud.
- **Claves de Siri** (`api_tokens`): no van en la copia. Hay que crear una clave nueva y actualizar los atajos del iPhone.
- **Passkeys (Face ID o huella):** van ligadas al dominio. Con un dominio distinto hay que activarlas otra vez. Con un dominio propio común (paso 9) se conservan.
- **Avisos push:** se conservan si se usan las mismas claves VAPID y el mismo dominio.

## 6. Lista de tareas para dejar DUPLA 100 % dual

1. **Adaptador de base de datos:** `edge/node-storage.mjs` con `node:sqlite` en un archivo, que dé `sql.exec`, `transactionSync`, `get`, `put`, `delete`, `list`, `setAlarm` y `getAlarm`. Partir del de `tests/cloud-edge.test.mjs`.
2. **Servidor Node:** `node-server.mjs`, que sirva `edge/public` y pase `/api/*` y WebSocket a la misma API (`createApi(storage, env, ctx)`). Sin tocar `edge/worker.mjs`, para que Cloudflare siga igual.
3. **WebSockets** con `ws`, imitando `acceptWebSocket`, `getWebSockets` y `serialize`/`deserializeAttachment`.
4. **Alarma cada hora** con la misma lista de trabajos que `DosRoom.alarm()`. Sacar esa lista a una función común para que no se duplique.
5. **IA intercambiable:** `edge/ai-provider.mjs` con la misma forma que `env.AI`, sea Workers AI por REST, OpenAI u Ollama, más la lectura de PDF sin `toMarkdown`.
6. **TURN** configurable: proveedor y credenciales por variables.
7. **URLs:** Google OAuth ya usa `PUBLIC_ORIGIN` y las passkeys usan el dominio de la petición. Solo queda la URL fija del `User-Agent` en `edge/v6.mjs` (línea 4): sacarla de `PUBLIC_ORIGIN`. Además, añadir la nueva URL de redirección en Google Cloud.
8. **Contenedor:** Dockerfile y compose nuevos para v6, con un volumen `data/` para el SQLite, más instrucciones para VPS (Caddy con HTTPS).
9. **Dominio propio** (recomendado, unos 10 €/año): así se cambia de servidor moviendo el DNS sin que cambien las URLs, y se conservan passkeys, push y Google OAuth.
10. **Sincronizar datos de reserva:** tarea que copie la base de Cloudflare al servidor de reserva (por ejemplo cada hora con `/api/snapshot` y restaurar). Si cae Cloudflare se cambia el DNS y se pierde como mucho 1 hora.
11. **Pruebas:** ejecutar `npm run verificar` también contra el servidor Node, con `scripts/captura.mjs` apuntando a él y una prueba de humo para WebSocket, alarma y restaurar.
12. **`npm run publicar:dual`:** publicar en Cloudflare y en el servidor de reserva con la misma etiqueta, y comprobar que los dos sirven el mismo app.js.
13. **Guía de emergencia** «Cloudflare ha caído» en 5 pasos: arrancar la reserva, restaurar la última copia, cambiar el DNS, reconectar Google y avisar.

## 7. Cómo se comprueba que está hecho

- `npm run verificar` en verde con los dos destinos.
- Las mismas capturas (390 y 1440 px) de las dos URLs, sin errores de consola.
- Restaurar una copia real de `RESPALDOS_PRIVADOS_NO_COMPARTIR` en el servidor de reserva y ver los mismos proyectos, gastos y calendario.
- El tiempo real entre dos navegadores funciona en el servidor de reserva.
- La alarma ejecuta el resumen diario y la copia en el servidor de reserva.
