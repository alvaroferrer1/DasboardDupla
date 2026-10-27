# Investigación técnica · DOS ESPACIOS · 18/10/2026

**Alcance:** únicamente DOS ESPACIOS, exactamente dos usuarios, una sola base de datos compartida, dos espacios principales con proyectos múltiples, acceso desde distintos PC/móviles, sin servidor local, sin pago ni tarjeta. Las integraciones externas son opcionales y no deben bloquear la funcionalidad básica.

## Resumen de la decisión

En la documentación pública revisada, ninguna plataforma con un plan **gratis, sin tarjeta y sin límites** ofrece disponibilidad garantizada permanente de un VPS Linux. La petición «siempre accesible» se resuelve más razonablemente con **serverless**: la aplicación responde bajo demanda y se conserva el estado en una base de datos persistente sin un PC encendido. No equivale a SLA 100 % ni a recursos ilimitados.

### Comparación contrastada

| Opción | Facturación/identificación | Continuidad | Persistencia | Decisión |
|---|---|---|---|---|
| Cloudflare Workers + SQLite Durable Objects | Free, sin tarjeta, cuotas | Bajo demanda, hibernación WSS | Durable Objects SQLite | **Seleccionada**. Pocos cambios sobre la V4.3. |
| Deno Deploy Free | Gratis con restricciones adicionales sin verificar organización con tarjeta | Bajo demanda | Deno KV/externa, no SQLite DO compatible sin migración | Alternativa, más migración |
| Firebase Spark | No requiere método de pago | Servicios backend sin VPS | Firestore/Realtime Database | Alternativa viable si rediseñamos backend y regras de seguridad |
| Koyeb Free | Oferta gratuita | Se escala a cero por inactividad (aprox. 1 h) | Sin volumen persistente en Free | Descartada por requisitos |
| Render Free | Oferta gratuita | Suspensión tras inactividad | Disco efímero | Descartada |
| Vercel Hobby | Free, no-comercial | Funciones a demanda | BD externa | No elegida por restricciones y migración |
| Oracle Always Free | Cuenta requiere tarjeta de validación | VM en la nube | Volúmenes persistentes | Descartada sin tarjeta |
| Railway Hobby | Cuota fija y consumo | Hosting Node persistente | Volúmenes | Descartada por pago |
| GitHub Pages | Gratuito | Solo estático | Sin backend ni SQLite | Insuficiente |

**Fuentes oficiales, consultadas:**

1. Cloudflare Workers límites: https://developers.cloudflare.com/workers/platform/limits/
2. Cloudflare Durable Objects límites y SQL: https://developers.cloudflare.com/durable-objects/platform/limits/
3. Cloudflare DO precios y comportamiento al agotar cuotas: https://developers.cloudflare.com/durable-objects/platform/pricing/
4. Cloudflare hibernación de WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
5. Cloudflare almacenamiento y recuperación PITR: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
6. Cloudflare publicación `workers.dev`: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
7. Deno precios: https://deno.com/deploy/pricing
8. Deno limitación de cuenta sin tarjeta: https://docs.deno.com/deploy/changelog/
9. Firebase Spark no requiere método de pago: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
10. Koyeb free escala a cero y carece de volumen: https://www.koyeb.com/docs/reference/instances
11. Vercel Hobby uso no comercial: https://vercel.com/legal/terms
12. GitHub Pages solo estático: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages

Las tarifas, términos y cuotas pueden cambiar. Deben verificarse de nuevo en el panel del proveedor el día de la publicación.

## Arquitectura real de la V4.4

```text
Dos personas (navegador HTTPS)
        |
        | HTTPS y WebSocket seguro con cookie privada
        v
Cloudflare Worker: recursos estáticos HTML/CSS/JS + API
        |
        | Durable Object único por nombre fijo
        v
Durable Object DosRoom: lógica Node compatible, SQLite, sesiones,
notificaciones persistentes y conexiones hibernables
        |
        v
SQLite del Durable Object: proyectos/usuarios/sesiones/conocimiento,
fragmentos de archivos de descarga restringida
```

- Las conexiones públicas son TLS y WSS; los datos en SQLite sobreviven al cierre del navegador y a hibernar el DO.
- El almacenamiento del plan Free tiene un límite de **5 GB por cuenta** y un límite menor por objeto (consultar documentación actual); los adjuntos de la app están limitados a **6 MB por archivo**.
- **No hay promesa de uptime** ni restauración automática desde JSON. El exportador manual disponible sirve de copia externa, pero no basta para recuperación automática completa.
- El único `DosRoom` de la V4 está pensado para exactamente dos usuarios. Un único DO puede convertirse en cuello de botella si se pretende escalar más adelante a cientos de usuarios; no se debe improvisar horizontalización alterando las claves del objeto en producción.

## Auditoría incremental realizada en esta entrega

**Mejoras implementadas y probadas localmente:**
- WebSocket exige `Origin` idéntico al origen HTTPS, rechazando cross-origin y esquema distinto. Comprobación 401 sin sesión antes del upgrade.
- Sesión vinculada al WebSocket mediante hash de sesión almacenado como attachment. Al notificar, el servidor no envía eventos a sesiones expiradas o revocadas y cierra el socket obsoleto.
- Se rechaza subir imágenes/PDF falsificados cuando los bytes iniciales no corresponden al tipo MIME declarado. Sigue siendo una comprobación básica de firmas, no un antivirus ni un escáner de archivos completo.
- Protección CSRF exige HTTPS para origen directo (excepto el modo local de desarrollo configurado), con comparación explícita de hosts.
- Se incluye smoke test para la URL real que verifica HTTPS, ruta privada 401, cabeceras, recursos, estado de cuentas y rechazo de otro origen.
- El script mantiene bloqueo del despliegue en caso de fallo de las pruebas locales.

**No se ha probado en producción:** ejecución del bundle en el runtime oficial de Cloudflare, WebSockets reales desde dos redes, TLS de la URL final, recuperación PITR, cuotas bajo carga real y pruebas E2E browser+backend real en el servicio Cloudflare. La CLI `wrangler@4` no pudo descargarse en este contenedor de ejecución por la restricción de red: se ha probado código adaptado con una simulación de la API SQL y un navegador con API simulada.

**Revisiones pendientes de calidad:** corregir el desbordamiento horizontal observado en un ensayo de escritorio, mejorar gestión de copias/restauración, automatizar pruebas E2E contra un ambiente real y evaluar avisos externos/push, accesibilidad integral WCAG, escáner de malware, límites de datos y planes de recuperación de cuenta. No desplazar estas cuestiones bajo la etiqueta «100 % probado».

## Privacidad y legalidad

Uso privado para dos personas con sus propios correos. No habilitar registro público. No crear ni enviar datos personales de terceros a proveedores de IA sin justificación y autorización. En caso de tratar datos de clientes o desarrollar actividad comercial, revisar obligaciones de protección de datos con asesoramiento competente. Las claves se gestionan mediante Cloudflare Secrets, nunca en repositorios ni documentación de los proyectos. La IA externa y las automatizaciones profesionales son opcionales.

## Próximas pruebas que dependen de la URL publicada

- `npm run check:live -- https://URL-REAL.workers.dev/`.
- Inicio de sesión desde 2 dispositivos, actualización WSS tras guardar, aislamiento de sesión y archivo.
- Cerrar y abrir navegadores y comprobar persistencia, más ensayo de acceso con PC inicial apagado.
- Restauración desde recuperación PITR en entorno de prueba.
- Inspección de Cloudflare Metrics para consumo/almacenamiento y prueba de límites.
