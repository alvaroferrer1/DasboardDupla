# DOS ESPACIOS V4.1 · Publicar para Álvaro y Angie

**Solo DOS ESPACIOS. Ningún cambio ni integración con ALDARA.**

Esta entrega incluye la aplicación V4 original más un **asistente protegido de primera configuración** para crear exactamente dos cuentas directamente desde la web. No incluye datos reales ni claves.

## Qué está verificado y qué no

- Ejecutados `npm run check` y `npm test`: **23 pruebas superadas**, incluidas la creación inicial de usuarios, el acceso desde dos sesiones independientes y que ambos ven los mismos datos.
- Página de alta comprobada con la interfaz real de la app y API simulada en Chromium a 1440 y 390 px: sin errores JS ni desbordamiento horizontal.
- La sincronización SSE se prueba a nivel HTTP en la suite anterior. Se actualiza **al guardar**, no permite edición simultánea carácter a carácter como Google Docs.
- El archivo `Dockerfile` ha sido actualizado para inicializar el volumen como root y después iniciar Node como usuario sin privilegios. **No se pudo construir ni ejecutar esta imagen Docker en este entorno porque Docker no está instalado**. Se exige verificar logs en Railway.
- **NO existe URL pública hasta que se despliegue en una cuenta de alojamiento.** No se ha probado en producción ni se ha realizado una auditoría independiente.

## Configuración recomendada: Railway

Railway puede generar una URL `.up.railway.app` con HTTPS automático. Una única instancia aloja frontend, backend y archivos; la base de datos SQLite vive en un volumen persistente. Esto requiere una cuenta Railway, servicio activo y plan/cuota adecuados. No hace falta comprar dominio ni que un PC personal esté encendido.

### Paso A · Despliegue de código

1. Descarga y extrae el ZIP `DOS_ESPACIOS_V4_1_PARA_PUBLICAR.zip` y abre la carpeta `dos-espacios`.
2. Instala Node.js 22.13+ y, dentro de la carpeta, abre PowerShell o Terminal.
3. Ejecuta:

```powershell
npm run check
npm test
npm install -g @railway/cli
railway up --new --name dos-espacios
```

`railway up` es el comando oficial: abre el navegador para crear/iniciar sesión en Railway y sube los archivos al servicio. **No ejecutes `railway up --new` otra vez cuando ya exista el proyecto**, pues abriría una instalación distinta.

### Paso B · Persistencia, privacidad y arranque

En el panel del servicio Railway, configura:

| Variable del servicio | Valor |
|---|---|
| `HOST` | `0.0.0.0` |
| `PORT` | `3077` |
| `COOKIE_SECURE` | `true` |
| `RAILWAY_RUN_UID` | `0` |
| `SETUP_TOKEN` | secreto aleatorio de 64 caracteres hexadecimales |

Para generar un secreto aleatorio **en tu propio ordenador**:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**No envíes ese secreto ni las contraseñas en ChatGPT.** Guárdalos en un gestor de contraseñas o directamente como variable privada de Railway. No introduzcas claves API de IA todavía.

**Monta un único volumen persistente en el mismo servicio en la ruta exacta `/app/data`.** No crees una base de datos distinta para cada persona. La app se despliega con una sola instancia de SQLite y SSE. Antes de introducir datos reales comprueba que el volumen está montado y que el servidor no registra errores `SQLITE_READONLY`. La variable `RAILWAY_RUN_UID=0` permite al entrypoint ajustar permisos del volumen; a continuación ejecuta Node como `node` sin privilegios mediante `gosu`.

Configura el **Healthcheck** del servicio a `/api/health` y reinicia o redepliega si has cambiado variables o volumen.

### Paso C · Conseguir la URL HTTPS

En el panel del servicio Railway abre **Settings → Networking → Public Networking → Generate Domain**. La URL tendrá un aspecto parecido a `https://dos-espacios-...up.railway.app`; el subdominio concreto lo asigna Railway.

La dirección pública de prueba `https://TU_DOMINIO/api/health` debe devolver `{"status":"ok"}`. El proxy Railway gestiona HTTPS/TLS. No uses la dirección HTTP local para que Angie entre desde otra red.

### Paso D · Crear los dos usuarios desde el navegador

1. Abre el dominio HTTPS que Railway haya generado.
2. Si el volumen está nuevo y `SETUP_TOKEN` es válido, aparecerá la **pantalla de activación**.
3. Introduce el secreto desde el panel de variables de Railway, correo y contraseña de Álvaro, y correo y contraseña de Angie. Deben ser cuentas distintas con contraseñas diferentes de 12 caracteres o más.
4. Pulsa **Crear nuestras dos cuentas**. El alta queda cerrada automáticamente. Después cada persona entra con su propio correo y contraseña.
5. En Railway **elimina `SETUP_TOKEN` de las variables** y reinicia el servicio una vez que las cuentas ya estén creadas. Verifica que los datos se conservan tras el reinicio.

**Los dos usuarios tienen los mismos permisos y comparten exactamente los mismos proyectos, documentos, datos, ideas y tareas.** Los comentarios y la actividad identifican quién hizo el cambio. No es necesario instalar un programa en el PC de Angie.

### Paso E · Prueba definitiva con dos dispositivos

Desde el ordenador A, Álvaro entra. Desde el ordenador B, Angie entra a la misma URL HTTPS. 

- A crea un proyecto `Trabajo` llamado `Prueba conjunta`.
- B lo ve sin cerrar sesión (se actualiza automáticamente después de guardar; en caso de desconexión puede forzarse actualización).
- B crea una tarea y añade un comentario; A comprueba ambos.
- A crea una nota; B la edita y la guarda, A recupera la última versión o recibe aviso.
- Cada uno entra en `Planes en común`; las tareas y viajes allí son igualmente compartidos.
- Subid un archivo de prueba, cerrad sesión, reiniciad servicio, volved a entrar. Comprobad que sigue disponible.
- Ejecuta desde tu ordenador: `node scripts/check-public.mjs https://TU_DOMINIO`.

**Limitación intencional:** una misma nota no se edita letra a letra simultáneamente. Si los dos guardan versiones del mismo texto, hay control de conflictos en vez de fusionar palabras automáticamente. El resto de funciones se pueden utilizar en paralelo.

## Imprescindible para no perder los datos

- Activa **copias de seguridad del volumen** en Railway o programa respaldos externos cifrados según el plan. No confíes solo en `npm run backup` dentro del mismo volumen.
- Prueba restaurar una copia en un **entorno separado** antes de introducir información importante.
- Mantén una sola instancia mientras utilices SQLite. Los cambios de despliegue con volumen pueden causar pausas breves.
- No permitas que el servicio exponga el puerto interno directamente sin el proxy HTTPS, y revisa alertas/logs y coste del servicio.
- En producción la URL de login puede ser pública pero solo las dos credenciales permiten ver los datos. HTTPS no garantiza protección contra todo ataque; el proyecto no cuenta con una auditoría de seguridad independiente.

## Opciones adicionales que no bloquean el uso básico

IA profesional, webhooks n8n, apps externas, push, coedición carácter a carácter, PWA offline, CRM, etc. **No son necesarios** para que ambos accedáis, creéis proyectos y veáis cambios compartidos a través del navegador. Se pueden añadir sin mover ni dividir los datos que ya guardéis.

## Si conectas Railway en ChatGPT

Puedes autorizar la aplicación Railway desde el directorio de aplicaciones y continuar la publicación desde un chat que disponga de la conexión. La acción de conexión requiere tu autorización. Nunca compartas las credenciales o `SETUP_TOKEN` en el mensaje.

Documentación oficial: https://docs.railway.com/cli/up · https://docs.railway.com/volumes · https://docs.railway.com/networking/public-networking
