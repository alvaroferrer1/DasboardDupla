# DOS ESPACIOS V3 | Publicarlo para Álvaro y Angie en dos ordenadores

**Estado de esta entrega:** aplicación y pruebas locales verificadas; no existe todavía una URL pública. Para alojarla se necesita una cuenta de Railway y autorizar el despliegue. Este manual utiliza el plan de Railway y **NO exige un dominio comprado ni mantener vuestro PC encendido**.

## Qué hará falta

- Una cuenta de Railway: https://railway.com/ (el alojamiento puede tener coste; consulta su tarifa antes de continuar).
- Un PC con **Node.js 22.13 o superior** (https://nodejs.org/). En Windows, usa PowerShell o Terminal.
- Los **dos correos electrónicos** y las **dos contraseñas** que elegiréis vosotros. Cada contraseña tendrá al menos 12 caracteres; nunca las envíes a un chat.
- **Una sola aplicación Railway y un solo volumen**. No crear dos servicios para Álvaro y Angie.

## PASO 1. Preparar el proyecto

Descarga el ZIP de despliegue y descomprímelo. Dentro encontrarás la carpeta `dos-espacios/`. Abre una terminal **dentro de esa carpeta** (en Windows: abre la carpeta, clic en la barra de ruta, escribe `powershell` y pulsa Intro).

Comprueba:

```powershell
node --version
npm --version
npm run check
npm test
```

La versión de Node debe ser 22.13+ y las pruebas deben finalizar sin fallos. **No ejecutes `npm run setup` localmente si quieres crear las cuentas directamente en la nube**: la base local sería diferente de la que compartiréis.

## PASO 2. Crear el alojamiento

Instala la herramienta oficial de Railway en el PC:

```powershell
npm install -g @railway/cli
railway login
```

Se abrirá el navegador para autorizar Railway. En el panel de Railway revisa el plan y su coste. Con la terminal todavía dentro de `dos-espacios/`, inicia un proyecto y despliega la aplicación:

```powershell
railway up --new --name dos-espacios
```

Autoriza la creación cuando Railway lo solicite. El primer despliegue puede ejecutarse sin usuarios: **todavía no introduzcas datos reales**. El software utiliza el `Dockerfile` que viene en el ZIP. El `compose.yaml` se reserva para un VPS propio y **no se usa en Railway**.

## PASO 3. Configurar el servicio y los datos permanentes (IMPRESCINDIBLE)

Entra en https://railway.com/dashboard y abre el proyecto `dos-espacios`, luego el servicio de la aplicación.

En **Variables**, establece estos valores:

| Variable | Valor |
|---|---|
| `HOST` | `0.0.0.0` |
| `PORT` | `3077` |
| `COOKIE_SECURE` | `true` |
| `RAILWAY_RUN_UID` | `0` |

La variable `RAILWAY_RUN_UID=0` es necesaria en esta configuración para que el contenedor pueda escribir en el volumen que Railway monta como root. Es una limitación operativa conocida de Railway: no implica que la web tenga acceso sin contraseña, pero la app se ejecutará con más privilegios de sistema de los deseables dentro del contenedor. Se debe mantener privado el entorno de administración del servicio. **No introduzcas contraseñas ni claves de terceros como texto en el frontend.**

En **Settings > Volumes**, crea/adjunta un volumen persistente al servicio, con exactamente la ruta:

```text
/app/data
```

Es crítico: ahí están `dos.sqlite` y los archivos que adjuntáis. **Sin ese volumen los datos podrían desaparecer tras un reinicio o una actualización.** Antes de crear usuarios, comprueba que el volumen aparece adjunto a ese servicio. Mantén **una sola réplica**: Railway no admite réplicas horizontales con volúmenes y SQLite no debería usarse como base compartida por varias instancias.

Aplica los cambios y espera a que la versión activa esté iniciada. En Settings > Deploy se puede fijar la comprobación de salud a `/api/health`.

## PASO 4. Crear la dirección HTTPS

En el servicio, ve a **Settings > Networking > Public Networking > Generate Domain**. Railway generará una dirección web del tipo:

`https://nombre-elegido.up.railway.app`

Si Railway te pide el puerto objetivo, indica `3077`. No es necesario comprar un dominio. Prueba en tu navegador que `https://TU-DOMINIO/api/health` muestra `{"status":"ok"}`.

**La URL no está restringida a dos dispositivos**: cualquier persona puede abrir la pantalla de inicio de sesión si conoce la dirección, pero solo Álvaro y Angie podrán iniciar sesión tras configurar sus cuentas. No hay registro público.

## PASO 5. Crear las dos cuentas directamente EN EL SERVIDOR

**Solo después de que el volumen esté montado y el despliegue esté en marcha**, vuelve a tu terminal, en la misma carpeta:

```powershell
railway ssh -- node scripts/setup.mjs
```

Railway puede pedirte registrar una clave SSH en tu primera conexión. Sigue las indicaciones oficiales que aparezcan en pantalla. El script te solicitará exactamente:

1. Correo de Álvaro.
2. Contraseña de Álvaro, de 12 o más caracteres.
3. Correo de Angie (diferente).
4. Contraseña de Angie, de 12 o más caracteres.

**Introduce los datos en tu propia terminal, nunca aquí en el chat.** El terminal puede mostrar los caracteres de la contraseña mientras escribes: utiliza un entorno privado. El script crea dos cuentas y se niega a crear cuentas adicionales posteriormente.

Si el script dice que ya hay cuentas creadas, **no borres la base de datos para repetirlo**. Comprueba primero si estás conectado al proyecto y entorno correctos.

## PASO 6. Comprobar que los dos lo podéis usar

Abre la URL HTTPS desde tu ordenador con la cuenta de Álvaro. Pide a Angie que la abra en otro ordenador, incluso desde otra red, con su propia cuenta. No uséis la misma sesión del navegador.

Prueba exactamente lo siguiente:

1. Álvaro crea un proyecto de `Trabajo`; Angie recarga y lo ve.
2. Angie crea una tarea dentro; Álvaro la ve.
3. Álvaro edita la tarea y la guarda; Angie puede ver el cambio.
4. Creáis otro proyecto dentro de `Planes en común` y confirmáis que ambos podéis editarlo.
5. Subid un archivo pequeño, cerrad sesión, volved a entrar y comprobad que sigue ahí.
6. Revisad que las notas, comentarios y presupuestos también persisten tras recargar.

La sincronización actual utiliza eventos SSE **tras guardar**. No tiene coedición letra a letra estilo Google Docs.

## PASO 7. Copias de seguridad

En Railway, abre las opciones de respaldo del volumen y habilita las copias programadas si tu plan y configuración lo permiten. Verifica el procedimiento de restauración. También puedes conectarte por SSH y ejecutar `node scripts/backup.mjs` (las copias generadas dentro del volumen **no sustituyen** las copias externas). No borres el volumen ni lo sustituyas en los siguientes despliegues. Guarda una copia fuera de Railway, de forma cifrada y privada.

## Actualizaciones

Para publicar cambios futuros desde la carpeta local y el proyecto vinculado:

```powershell
railway up
```

Antes de actualizar, comprueba que existe una copia de seguridad reciente. No crees un proyecto nuevo con `--new` durante las actualizaciones: se perdería la conexión con el volumen del servicio ya utilizado.

## Fallos habituales

- **502 / fallo de arranque:** revisa las Variables `HOST` y `PORT`, el volumen, `RAILWAY_RUN_UID` y los logs del servicio.
- **No guarda cambios / SQLITE_READONLY:** revisa que `/app/data` es un volumen real y que `RAILWAY_RUN_UID=0` está configurada.
- **Al iniciar sesión vuelve al login:** revisa `COOKIE_SECURE=true` y utiliza la dirección `https://`.
- **Las cuentas no aparecen:** probablemente se ejecutó `npm run setup` de forma local en lugar de `railway ssh -- node scripts/setup.mjs`. No copies bases sin seguir un procedimiento de migración.
- **Sin actualizaciones entre navegadores:** prueba refrescar; si persiste, revisa conectividad de eventos SSE y logs.
- **La URL dejó de responder:** mira facturación, límites del plan, despliegues y logs en Railway.

## Lo que NO está terminado

El proyecto V3 no incluye conectores bidireccionales con Figma/Canva, coedición letra a letra, push, PWA offline ni sorpresas privadas. `OPENAI_API_KEY` y `WORK_WEBHOOK_URL` son opcionales y no deben añadirse hasta necesitar esas funciones, siempre como variables privadas en el servicio.

## Documentación oficial consultada

- https://docs.railway.com/cli/up
- https://docs.railway.com/cli/ssh
- https://docs.railway.com/volumes
- https://docs.railway.com/networking/domains/working-with-domains
- https://docs.railway.com/pricing/plans
