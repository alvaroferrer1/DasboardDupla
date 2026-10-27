# DOS ESPACIOS 4.2 · Una sola web privada, dos personas, sin cuota de alojamiento

**Proyecto:** SOLO DOS ESPACIOS. Sin relación con ALDARA.

**Qué podéis hacer desde el primer día:** dos sesiones (Álvaro y Angie) con credenciales privadas distintas y los mismos permisos; los dos pueden crear, editar y consultar **muchos proyectos independientes** dentro de **Trabajo** y **Planes en común**. Ej.: Trabajo > Web tienda + Campaña anuncios + Proyecto IA; Planes > Viaje + Cenas + Objetivos. Los cambios se notifican por SSE después de pulsar Guardar. No existe edición simultánea de las mismas letras (como Google Docs): en las notas y otras fichas se detectan conflictos para evitar perder versiones.

## Elección real sin pagar

| Ruta | Coste de alojamiento | ¿URL HTTPS? | ¿Disponible con el PC apagado? | Condición importante |
|---|---|---|---|---|
| **A. Tailscale Funnel desde Windows** | 0 € con plan Personal elegible (uso no comercial) | Sí, URL estable `*.ts.net` | **NO** | El PC anfitrión y Tailscale deben quedar encendidos y conectados; el enlace es público pero el contenido exige login |
| **B. Oracle Cloud Always Free** | 0 € dentro de cuotas Always Free | Sí, Caddy + dominio gratuito `IP.sslip.io` | **SÍ, mientras el VPS siga activo** | Registro con tarjeta de verificación; capacidad no garantizada, posible recuperación de máquinas inactivas |
| **NO usar Render Free con SQLite local** | 0 € | Sí | No fiable para datos | Su almacenamiento local desaparece en reinicios/suspensiones; no vale tal cual |
| **NO usar Railway Hobby como permanente gratuito** | Cuota de pago después de la prueba | Sí | Sí, con plan activo | No cumple tu condición de 0 € |

Tailscale Personal Free es para **uso personal, no comercial**. Si vas a utilizar DOS ESPACIOS como infraestructura comercial, no cuentes con ese plan como alojamiento comercial gratuito. Oracle Always Free es la opción que contempla un servidor propio para uso a largo plazo sin cuota, con las limitaciones del proveedor.

**Ninguna de estas alternativas crea una URL automáticamente desde este archivo ZIP:** hay que activar un servicio externo en tu propia cuenta. No se ha publicado ninguna instancia en este chat y no existe aún una URL verificable para enviar a Angie.

## A. Para que podáis usarlo desde diferentes ordenadores SIN pagar y sin tarjeta, con tu PC encendido

1. En tu ordenador Windows instala [Node.js 22.13+](https://nodejs.org/) y [Tailscale](https://tailscale.com/download/windows).
2. Entra en Tailscale con tu cuenta (elige **Personal Free**, sujeto a las condiciones de uso). En el [panel Tailscale](https://login.tailscale.com/admin/dns) activa MagicDNS, HTTPS y **Funnel**, siguiendo el asistente oficial. Acepta los permisos de Funnel si aparecen.
3. Descomprime este ZIP en una carpeta permanente, por ejemplo `C:\DOS-ESPACIOS` (no en Descargas temporalmente). **No cambies la carpeta después de empezar a guardar datos.**
4. Dentro haz doble clic en **`COMPARTIR_GRATIS_WINDOWS.cmd`**. El lanzador configura el servidor Node en `127.0.0.1:3077`, cookies `Secure`, origen HTTPS explícito y un token de alta local. Comprueba el healthcheck y activa `tailscale funnel`.
5. Se abrirá una URL `https://tu-equipo.tu-tailnet.ts.net`. La primera vez crea **exactamente dos cuentas**: un correo y contraseña para Álvaro y otros distintos para Angie. El código secreto se guarda en `.local-private/setup-token.txt` SOLO en tu PC. **No lo mandes a Angie ni a ChatGPT.**
6. Copia a Angie **solo la URL HTTPS**. Ella puede entrar desde otro PC o móvil con su usuario, contraseña y navegador, sin instalar Node ni Tailscale.
7. Prueba: Álvaro entra y crea un proyecto de Trabajo, Angie lo ve. Angie añade una tarea, Álvaro la ve. Después cread un segundo proyecto en Trabajo y varios en Planes en común; comprobáis que ninguno sustituye a otro.
8. Mantén **ese ordenador encendido y conectado a Internet**, con Tailscale operativo. Aunque cierres la ventana después de ejecutar el `.cmd`, el servidor y Funnel siguen en segundo plano; si reinicias el PC tendrás que volver a ejecutar el lanzador (o configurar un servicio Windows más adelante).
9. Para detener el acceso remoto, ejecuta `PARAR_COMPARTIR_WINDOWS.cmd` (advertencia: resetea todas las exposiciones Funnel de ese equipo).
10. Para guardar una copia manual, ejecuta `COPIA_SEGURIDAD_WINDOWS.cmd`. Copia después el respaldo a una ubicación externa cifrada. No dependas exclusivamente del PC anfitrión.

**Seguridad:** La URL es visible en Internet; solo Álvaro y Angie tienen credenciales para entrar. Las cookies usan `HttpOnly`, `SameSite=Strict`, `Secure`, el servidor escucha solo en localhost y el tráfico remoto sale por HTTPS de Tailscale. La configuración no sustituye un pentest ni garantiza resistencia a todo ataque. No guardes datos personales sensibles de clientes hasta realizar una auditoría legal y de seguridad adecuada.

**Límite real:** no sirve para que la aplicación esté en línea cuando el PC anfitrión esté apagado. Para eso utiliza B.

## B. Para que ambos podáis entrar en cualquier momento, sin dejar tu PC encendido: Oracle Always Free

1. Crea una cuenta en https://www.oracle.com/es/cloud/free/ y verifica identidad/tarjeta según la plataforma; Oracle indica que no cobra si mantienes tu cuenta sin actualizar y usas solo recursos `Always Free`.
2. En Oracle > Compute crea **una única VM marcada como Always Free**, preferentemente Ubuntu ARM Ampere A1 si hay capacidad; mantén los recursos de CPU y RAM **dentro de los límites Always Free**. Selecciona la región de la cuenta. Descarga la clave privada SSH, no la subas aquí.
3. Asigna una IP IPv4 pública y configura la lista de seguridad / NSG de Oracle: entrada TCP 22 **solo desde tu IP**, entradas 80 y 443 desde Internet, resto cerrado. No abras 3077. Activa el firewall del SO si procede.
4. Desde tu PC, transfiere el ZIP mediante SCP y abre una terminal SSH en la VM. En Ubuntu:

```bash
sudo apt-get update && sudo apt-get install -y unzip
unzip DOS_ESPACIOS_V4_2_PUBLICACION_GRATIS.zip
cd dos-espacios
sudo bash ops/INSTALAR_ORACLE_ALWAYS_FREE.sh TU_IP_PUBLICA
```

Si usas claves SSH específicas o un usuario de Ubuntu diferente, ajusta los comandos de `scp` y `ssh` de acuerdo con Oracle. El script instala Docker y Docker Compose (si no existen), crea `.env` con un secreto local, levanta Node y Caddy con volúmenes persistentes y genera un hostname `IP.sslip.io` gratis con HTTPS automático de Caddy.

5. Tras abrir 80/443 en Oracle, visita `https://TU-IP-CON-GUIONES.sslip.io/api/health` y comprueba `{"status":"ok"}`; después abre la raíz y activa las dos cuentas utilizando la clave en el archivo `.env` del VPS. **Nunca envíes esa clave al chat.**
6. Tras crear las cuentas, quita el `SETUP_TOKEN` del `.env` y reinicia el servicio. Los proyectos deben mantenerse tras reiniciar porque SQLite y los archivos están dentro de un volumen Docker `dos_data`.
7. Haz las mismas pruebas cruzadas de dos cuentas y diferentes proyectos en los dos espacios. Copia de seguridad externa imprescindible.

**Advertencias:** Este entorno no dispone de una VM Oracle ni de Docker para verificar el despliegue real. Oracle puede no ofrecer capacidad Always Free disponible y puede recuperar recursos inactivos conforme a su política. Caddy depende de que DNS, IP pública y puertos 80/443 funcionen. La VM necesita actualizaciones de seguridad y supervisión. Una VM de 1 GB de RAM puede tener recursos limitados: ajusta al perfil Always Free realmente disponible.

## Pruebas técnicas incluidas

- `npm run check` valida sintaxis de servidor, BD y frontend.
- `npm test` comprueba dos cuentas, proyectos múltiples en ambos espacios, permisos, sincronización SSE, versiones, ideas, decisiones, archivos, datos e inicialización, más configuración de proxy HTTPS.
- `npm run guardian` realiza análisis estático y pruebas del Director General; no equivale a una auditoría externa.
- El ZIP no contiene cuentas, contraseñas, secretos ni la base de datos de prueba. **El alta inicial queda cerrada después de crear las dos cuentas.**

## Funcionamiento de usuarios y proyectos

La app tiene dos cuentas privadas, con dos roles visuales (autor/responsable) pero los **mismos permisos**. Ambos consultan una sola BD. Todo lo creado en Trabajo pertenece a ese espacio; todo lo creado en Planes en común al otro. Dentro de cada espacio puede haber un número abierto de proyectos; cada uno contiene sus tareas, notas, presupuestos, archivos y demás. No existe registro público para más usuarios.

Los servicios opcionales de IA, Figma, Google, n8n, Make o GitHub **no son necesarios** para trabajar ambos. Se añadirán más adelante solo si se desea y sin bloquear lo básico.

## Soporte y fuentes oficiales

- Tailscale Funnel: https://tailscale.com/docs/features/tailscale-funnel y https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet
- Tailscale Personal Free: https://tailscale.com/pricing
- Oracle Always Free: https://www.oracle.com/es/cloud/free/ y https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Render Free (disco efímero): https://render.com/docs/free
