# DUPLA siempre disponible: entrada de Google (Firebase) y servidor de reserva

DUPLA vive en Cloudflare. Hay dos formas extra de entrar por si algo falla:

| Problema | Qué usar |
|---|---|
| Tu operador bloquea Cloudflare (pasa en España durante los partidos de LaLiga) | **Entrada de Google** (Firebase) |
| Cloudflare cae del todo (muy raro) | **Servidor de reserva** en el PC |

---

## 1. Entrada de Google (Firebase)

Es un puente: el móvil habla con Google y Google con Cloudflare, así que el bloqueo del operador no le afecta.
Los datos, las cuentas y la sesión son los mismos: no hay nada que copiar ni sincronizar.

- **Dirección:** la que termina en `.run.app` que sale al publicarla. Guardadla en la pantalla de inicio del móvil como «DUPLA (Google)».
- **Diferencias con la web normal:**
  - Los cambios del otro llegan en menos de un minuto, no al instante.
  - Conectar Google Calendar o Drive y activar Face ID hay que hacerlo desde la web normal.
- **Si Cloudflare cae del todo**, esta entrada tampoco funciona. Para eso está el servidor de reserva.

### Ponerla en marcha (una sola vez)

1. Entra en **console.firebase.google.com** y pulsa **Añadir proyecto**. Elige tu proyecto de Google Cloud **DUPLA**, el mismo del calendario.
2. Activa el **plan Blaze**. Pide tarjeta, pero con este uso queda dentro de la parte gratuita (0 €).
3. En la terminal de VS Code, dentro de `DUPLA_5_8/dupla`, ejecuta:
   - `npx firebase-tools login`: se abre el navegador; entra con tu cuenta de Google.
   - `npm run firebase:publicar`: la primera vez te pide el **ID del proyecto** (está en Configuración del proyecto).
4. Al terminar aparece la **Function URL** (`https://dupla-…run.app`). Esa es la entrada de Google.

Solo hay que volver a publicarla si cambia el propio puente. Las novedades de DUPLA se ven solas, porque reenvía a la web de siempre.

---

## 2. Servidor de reserva en el PC

Es una copia completa de DUPLA: el mismo código y vuestros datos, en `data/reserva/dupla.sqlite`. Ese archivo no se sube a GitHub.

- **Arrancar:** `npm run reserva` (deja la ventana abierta) y abre **http://localhost:8790**. Usa `localhost`, no `127.0.0.1`.
- **Copia de los datos:** se hace al arrancar y cada hora. Primero lo intenta desde Cloudflare y, si no responde, desde la entrada de Google si está configurada (`RESERVA_ORIGEN_FIREBASE=https://…run.app` en `.env.reserva`).
- **Cuentas:**
  - **Álvaro:** entra con su contraseña de siempre. Se toma de la credencial cifrada de `npm run credencial`.
  - **Angie:** las contraseñas no viajan en las copias, así que hay que ponerle una solo para la reserva con `npm run reserva:clave`.
- **Cambios hechos en la reserva:** la copia horaria se para sola y avisa, para no perderlos. Cuando Cloudflare vuelva, apunta esos cambios en la web normal y luego ejecuta `npm run reserva -- --forzar` para volver a copiar desde Cloudflare.
- **Qué no funciona en la reserva:** avisos al móvil, correo, Google Calendar o Drive, y la IA de Cloudflare. El resto (proyectos, tareas, calendario de DUPLA, finanzas, carpetas, notas, archivos…) funciona igual.

### Si Cloudflare cae

1. Prueba primero la **entrada de Google**.
2. Si tampoco carga, ejecuta `npm run reserva` en el PC y entra en http://localhost:8790. Ahí tienes los datos de la última hora.
3. Cuando Cloudflare vuelva, sigue usando la web normal. Si apuntaste algo en la reserva, pásalo a mano a la web normal.
