# DOS ESPACIOS V4.2 | Oracle Cloud Always Free (sin PC encendido)

**Este procedimiento sirve SOLO para DOS ESPACIOS**, no modifica ALDARA. Una única VM Linux, un único servidor web, una sola base SQLite persistente y **exactamente dos usuarios** con permisos iguales. Dentro de Trabajo y Planes en común podéis crear tantos proyectos independientes como necesitéis. Ambos pueden entrar simultáneamente desde distintas redes y PCs o móviles.

## Qué es gratuito y qué no está garantizado

Oracle Cloud Always Free tiene VM gratuitas (AMD E2.1 Micro o Arm A1 con límites de uso), almacenamiento Block Volume dentro de cuota y red. También pide tarjeta para verificar identidad. **No cambies tu cuenta a Pay As You Go y NO selecciones recursos sin distintivo Always Free** si quieres evitar gastos. La capacidad de las VM gratuitas puede estar agotada. Oracle puede recuperar instancias gratuitas por inactividad y no garantiza uptime ni soporte mediante SLA. Por eso incluye backups, pero **debes exportarlos fuera de Oracle**.

Documentación oficial: https://www.oracle.com/es/cloud/free/ y https://docs.oracle.com/es-ww/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm.

## PASO 1: crear VM gratuita en Oracle (necesariamente tú)

1. Ve a https://www.oracle.com/es/cloud/free/ e inscríbete; confirma tu identidad en la página oficial, no en ChatGPT.
2. Consola OCI > Compute > Instances > **Create instance**. Selecciona Ubuntu 24.04, una máquina **Always Free eligible**. Recomendamos Arm Ampere A1 con 2 OCPU / 12 GB cuando haya capacidad; Oracle también ofrece AMD Micro (1 GB RAM, mucho más limitado). La combinación debe respetar 1500 OCPU-horas y 9000 GB-horas mensuales de Always Free de A1.
3. Arranca en una subred pública con **IPv4 pública**, 50 GB de disco de arranque o tamaño que se mantenga dentro de Always Free. Descarga la clave SSH privada en tu PC y mantenla segura. No la envíes a nadie ni a ChatGPT.
4. En Networking > VCN > Security Lists o Network Security Groups de tu instancia crea reglas de entrada TCP: **80 desde 0.0.0.0/0**, **443 desde 0.0.0.0/0**, y **22 SOLO desde la IP pública de tu propia red** (`IP/32`). No abras 3077 a Internet ni permitas acceso público a SSH indiscriminadamente. Verifica también firewall del sistema operativo si está activo.
5. Copia la dirección IPv4 pública de la VM.

## PASO 2: publicarla automáticamente desde Windows

1. Descarga y descomprime la carpeta `dos-espacios` en tu PC.
2. Entra en esa carpeta y haz doble clic en **`PUBLICAR_EN_ORACLE_DESDE_WINDOWS.cmd`**.
3. El asistente te pregunta tres datos: **IP pública Oracle**, usuario SSH (normalmente `ubuntu`) y ruta de tu clave privada SSH descargada.
4. El script prepara una copia SIN contraseñas ni datos privados, la transfiere por SCP, instala Docker + Compose, prepara Caddy con HTTPS automático y un dominio gratuito `IP-con-guiones.sslip.io`, inicia el backend Node en red privada de contenedores, añade un volumen `dos_data` persistente y programa copias locales diarias.
5. Si no funciona la SSH, revisa dirección IP, clave, el usuario e ingreso TCP 22 desde tu IP. El script no puede solucionar una cuenta OCI sin VM disponible.

## PASO 3: URL y las dos cuentas

1. Abre `https://IP-CON-GUIONES.sslip.io/api/health`; debe responder `{"status":"ok"}`. Si falla el HTTPS, revisa `docker compose logs caddy`, reglas TCP 80/443, IPv4, DNS y firewall.
2. Abre el dominio sin `/api/health`. Si todavía no hay usuarios, aparece el **formulario de creación inicial**. Solicita cuatro datos privados y un secreto de activación.
3. El secreto `SETUP_TOKEN` se generó automáticamente y está almacenado en el archivo `.env` DEL VPS. Entra en SSH y utiliza el comando `cd dos-espacios && sudo grep '^SETUP_TOKEN=' .env` para verlo. **No lo compartas por chat ni con Angie**. La persona que activa la aplicación introduce el secreto en el formulario y define los correos/contraseñas de ambos.
4. Tras crear las dos cuentas, el alta queda cerrada. Para quitar el token residual: `cd dos-espacios && sudo sed -i '/^SETUP_TOKEN=/d' .env && sudo docker compose up -d --force-recreate app`.
5. Comparte con Angie únicamente la URL HTTPS y **sus propias credenciales** por un canal seguro. Ella no tiene que instalar ninguna aplicación ni tener cuenta Oracle. Tú no tienes que mantener tu ordenador encendido.
6. Cread un proyecto en Trabajo, varios más en el mismo espacio, y varios en Planes en común. Comprobad creación, cambios cruzados, notas, tareas y que los datos siguen ahí tras actualizar la página y reiniciar el VPS.

## Qué queda configurado

- Un Node.js backend privado tras Caddy y una sola URL HTTPS de entrada.
- SQLite con archivos adjuntos guardados en el volumen Docker persistente `dos_data` (que sigue siendo disco de la VM, no almacenamiento independiente).
- Cookies de sesión `HttpOnly`, `SameSite=Strict`, `Secure`, comprobaciones de origen y contraseñas cifradas con hash; no registro público más allá de las dos cuentas.
- Las funciones de proyectos, tareas, biblioteca de conocimiento, datos, decisiones y Director General V4 que ya hay en el ZIP funcionan SIN conectar proveedores externos.
- Un temporizador de `systemd` para ejecutar a diario `ops/backup-oracle.sh`; guarda backups **en el disco del propio VPS** en `/var/backups/dos-espacios` y conserva aproximadamente 14 días. Si Oracle elimina el VPS, se perderían también: exporta periódicamente backups cifrados a tu PC/u otro almacenamiento ajeno a OCI.
- Caddy y aplicación se reinician automáticamente tras reinicios de la VM (`restart: unless-stopped`).

## Lo que NO se puede verificar aquí

La ejecución de `npm run check` y `npm test`, incluida la colaboración entre usuarios, es local; los scripts Shell pueden comprobarse sintácticamente. **No se ha instalado el contenedor en una VM Oracle real, ni se ha obtenido un certificado TLS real ni una URL pública accesible**, porque necesitamos que crees/autorices la cuenta OCI y dispongas de VM. Una URL `sslip.io` depende de una IP pública y de un servicio DNS externo, y la dirección cambiará si cambia la IP. Las imágenes del ZIP son ejemplos, no pruebas de producción.

**Una aplicación publicada no es inmune a ataques**: mantén Ubuntu y Docker actualizados; limita SSH; usa claves y contraseñas fuertes; configura y verifica backups externos; revisa controles de seguridad y requisitos legales según los datos almacenados; no expongas el directorio `data/`, `.env` ni 3077.
