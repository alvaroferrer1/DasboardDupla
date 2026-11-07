<div align="center">

<img src="edge/public/dupla-horizontal.svg" alt="DUPLA" width="320"/>

### Nuestro espacio, todos nuestros planes.

**El dashboard privado de Álvaro y Angie:** trabajo y vida en pareja en un mismo sitio,<br/>con un agente de IA que actúa, calendario de Google fusionado, viajes vivos y reuniones transcritas.

<br/>

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![Durable Objects](https://img.shields.io/badge/Durable_Objects-SQLite-F38020?logo=sqlite&logoColor=white)
![Workers AI](https://img.shields.io/badge/Workers_AI-gpt--oss_·_Whisper_·_bge--m3-6963cd)
![Google Calendar](https://img.shields.io/badge/Google_Calendar-OAuth_2.0-4285F4?logo=googlecalendar&logoColor=white)
![Web Push](https://img.shields.io/badge/Web_Push-cifrado_RFC_8291-263c66)
![Pruebas](https://img.shields.io/badge/pruebas-158_en_verde-3f7a5c)
![Privado](https://img.shields.io/badge/uso-privado-d0607a)

<br/>

<img src="docs/capturas/inicio.jpg" alt="Inicio de DUPLA" width="880"/>

</div>

---

## Índice

- [Qué es DUPLA](#qué-es-dupla)
- [Lo que hace](#lo-que-hace)
- [Dupla, el agente](#dupla-el-agente)

---

## Qué es DUPLA

DUPLA es una aplicación web **privada para dos personas**. Tiene dos espacios separados, **Trabajo** y **Nuestro espacio**, y alrededor de ellos todo lo que una pareja necesita para organizarse: proyectos, viajes con su día a día, calendario compartido, presupuestos, ideas, recuerdos, tareas, reuniones con transcripción y un agente de IA que propone y ejecuta cambios **siempre con vuestra confirmación**.

Corre entera en el borde de Cloudflare: un Worker y un Durable Object con SQLite, sin servidores que mantener. Funciona igual en el ordenador y en el iPhone, también instalada como app (PWA) con avisos push.

---

## Lo que hace

<table>
<tr>
<td width="50%" valign="top">

### 🏠 Inicio
Cabecera con la foto del próximo destino, el tiempo que hace allí y la cuenta atrás. Accesos rápidos, próximos planes con progreso (incluidos los eventos de Google), actividad reciente, idea rápida y la tarjeta de Dupla. El resumen de arriba se configura y es **compartido** entre los dos.

</td>
<td width="50%" valign="top">

### 📅 Calendario fusionado
Vistas de mes, semana y agenda. Junta en una sola vista los eventos de DUPLA, el calendario compartido **«DUPLA · Nuestro calendario»** y los **calendarios personales de cada uno** (cada persona en su color). Marca los **choques de horario** en rojo, crea eventos con **Google Meet** y vincula cada evento a un proyecto.

</td>
</tr>
<tr>
<td valign="top">

<img src="docs/capturas/calendario.jpg" alt="Calendario"/>

</td>
<td valign="top">

<img src="docs/capturas/viaje.jpg" alt="Viaje"/>

</td>
</tr>
<tr>
<td valign="top">

### ✈️ Viajes vivos
Cabecera con foto del destino (Wikimedia) y barra de progreso: *«vais por el día 2»*. Itinerario por días con casillas, actividades hechas, canceladas o reagendadas, reservas utilizadas y eventos del calendario dentro del viaje. Avisos **«Antes de reservar»**: festivos, puentes, fiestas y ferias que encarecen las fechas.

</td>
<td valign="top">

### 💶 Presupuestos con memoria
Historial por destino: cuánto costó cada viaje, alojamiento por noche, comidas y salidas por día (en rango), billetes y **con cuántos días de antelación reservasteis**. Calcula el próximo viaje con un rango estimado y avisos: festivos nacionales y regionales, Navidad, verano, eventos recurrentes según la IA y **vuestros propios avisos por destino y mes**.

</td>
</tr>
<tr>
<td valign="top">

<img src="docs/capturas/presupuestos.jpg" alt="Presupuestos"/>

</td>
<td valign="top">

<img src="docs/capturas/tareas.jpg" alt="Tablero de tareas"/>

</td>
</tr>
<tr>
<td valign="top">

### ✅ Tablero de tareas
Un tablero tipo Trello solo vuestro, aparte de los dos espacios: **Pendiente · En proceso · Parado · Terminado**. Se arrastran las tarjetas, el color marca la prioridad y cada tarea tiene responsable y fecha. Con **tarea padre**: la hija no se puede cerrar hasta que la padre esté terminada.

</td>
<td valign="top">

### 🎥 Reuniones transcritas
Videollamada propia (WebRTC directo, señalización por la API) o **Google Meet**. Cada persona graba **su propio micrófono** y Whisper lo transcribe por tramos: transcripción **fiel**, con quién dijo qué y cuándo, y cada frase con su grabación. Al terminar se generan solos el **resumen, las tareas y las decisiones**, siempre aparte de la transcripción.

</td>
</tr>
<tr>
<td valign="top">

<img src="docs/capturas/videollamada.jpg" alt="Videollamada"/>

</td>
<td valign="top">

<img src="docs/capturas/notificaciones.jpg" alt="Notificaciones"/>

</td>
</tr>
<tr>
<td valign="top">

En cada viaje o plan podéis marcar lo que queda como pagado, entero o en parte, y la deuda desaparece de Presupuestos y Finanzas. Si os equivocáis, se deshace. Finanzas enseña cada viaje por separado: pendiente, pagado en parte o pagado.

Cada destino muestra vuestro gasto medio, el mes en que más gastasteis y, si lo pedís, qué hacer, qué zonas elegir y cuándo sube el precio.

### 🔔 Avisos de verdad

Agrupados por día. En Inicio tenéis el repaso del mes y una guía de puesta a punto para empezar. Tareas tiene buscador, Finanzas descarga a Excel y hay plantillas de playa, ciudad y ruta en coche.
Notificaciones del sistema en el **PC y en el iPhone**, aunque DUPLA esté cerrada. Push cifrado de extremo a extremo (RFC 8291), filtros, avisos marcados como importantes y estado de entrega por dispositivo. **Resumen de cada mañana** a las 8:00, también como evento en Google Calendar para que el móvil avise siempre.

</td>
<td valign="top">

### 💡 Ideas, actividad y más
Captura rápida de ideas que no se pierden (borrador guardado en el dispositivo), estados, «para retomar» y conversión en proyecto, plan, viaje o deseo. Cronología de actividad por día con filtros. Buscador agrupado con **búsqueda semántica**. Director General con propuestas reales. PDFs de itinerario, dossier y presupuesto para clientes.

</td>
</tr>
</table>

### 💞 Nuestro espacio
Planes por tipo (viajes, citas, celebraciones, planes de finde), **recuerdos con fotos**, metas con progreso, deseos, regalos, organización de la casa, **presupuesto común** separado del de Trabajo y un planificador de pareja con propuestas guiadas.

<p align="center"><img src="docs/capturas/nuestro-espacio-movil.jpg" alt="Nuestro espacio en el móvil" width="260"/> &nbsp; <img src="docs/capturas/viaje-movil.jpg" alt="Viaje en el móvil" width="260"/></p>

---

## Dupla, el agente

<img src="docs/capturas/dupla-agente.jpg" alt="Dupla" align="right" width="430"/>

Dupla **no es un chatbot**: es un agente que consulta vuestros datos reales con herramientas y **propone cambios concretos** que solo se aplican cuando pulsáis «Hacer».

- Crea proyectos, viajes, tareas, planes, gastos e ideas, y **eventos en Google Calendar**, con Meet si hace falta.
- Revisa con el **Director General** qué va mal o se retrasa.
- Sus sugerencias cambian según lo que tenéis entre manos: el próximo viaje o las tareas retrasadas.
- Podéis **detener** una respuesta, **reintentar** lo que falle y **deshacer** lo confirmado, también una tarea marcada como hecha.
- Consulta los **avisos del destino** antes de planificar un viaje.
- Prepara **PDFs** (itinerario, dossier, presupuesto para clientes).
- **Deshace** lo último que confirmasteis.
- Habla **por voz**: graba, transcribe con Whisper y envía.
- Tiene **memoria editable**: alergias, gustos, presupuesto habitual…
- Respeta el **ámbito** que elijáis: Todo, Trabajo o Nuestro espacio.

Modelo: `@cf/openai/gpt-oss-120b` en Workers AI, gratuito y sin claves externas.

<br clear="right"/>

---


<div align="center">

**DUPLA** ✦ Álvaro &amp; Angie · *Lo nuestro, a nuestra manera.*

<sub>Proyecto privado de uso personal. No se aceptan contribuciones externas.</sub>

</div>

## Revisión y mejora con skills (noviembre de 2026)

- **Diseño:** rediseño «Dos tintas» con los dos espacios al frente y tipografía Bricolage Grotesque.
- **Accesibilidad:** contraste AA en modo claro y oscuro, foco visible con teclado y objetivos táctiles revisados en pantallas de 320 a 1920 píxeles.
- **Robustez:** textos muy largos sin romper tarjetas ni filtros.
- **SEO:** `noindex`, porque es una aplicación privada.

Cada publicación se hace con `npm run publicar`, que prueba, copia los datos, guarda en git, despliega y verifica. `npm run deshacer` vuelve a la versión anterior sin tocar los datos.
