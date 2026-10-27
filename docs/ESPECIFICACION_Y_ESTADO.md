# DOS ESPACIOS · Especificación y estado de implementación (V3)

## Propósito y decisiones fijadas

Se utiliza exclusivamente por dos personas, Álvaro y Angie. No existen espacios privados por usuario, clientes registrados ni terceros. Hay dos categorías organizativas, **Trabajo** y **Planes en común**, visibles y editables por ambos. Una persona puede ser responsable de una tarea, pero nunca pierde la otra la visibilidad o el permiso de modificación. Una idea de una persona es compartida con la otra desde el primer momento.

**Trabajo**: propuestas conjuntas de desarrollo web, marketing, campañas, servicios, productos digitales y aplicaciones; IA profesional opcional. **Planes en común**: viajes, cenas, actividades, reservas, proyectos personales de los dos; IA profesional bloqueada. Sorpresas temporales ocultas no implementadas, de modo que por ahora todo es visible.

## Pantallas y módulos construidos

| Módulo | Estado | Observaciones |
|---|---|---|
| Autenticación exclusiva para dos cuentas | Implementado | Alta privada CLI, sin registro público, cookies HTTP-only |
| Dashboard de inicio y dos categorías | Implementado | Vista compartida, indicadores, tarjetas, diseño adaptable |
| Plantillas de proyectos | Implementado | Web, campaña, app, viaje, cena, proyectos comunes |
| Kanban, tareas, subtareas, prioridades, fechas | Implementado | SSE al guardar, responsable informativo |
| Hitos y hoja de ruta | Implementado | Fechas, descripción y estados |
| Presupuestos previstos y reales | Implementado | Categorías, totales |
| Fechas y exportación ICS | Implementado | Importación manual del archivo .ics en calendario externo |
| Notas y documentación | Implementado | Markdown simplificado, control de revisiones |
| Historial restaurable de notas | Implementado V3 | Guardado de versiones anteriores |
| Comentarios y actividad | Implementado | Registro de autor y cambios |
| Adjuntos y enlaces | Implementado | Hasta 6 MB/archivo y MIME seleccionados |
| Buzón compartido de ideas | Implementado V3 | Captura, edición, conversión en proyecto |
| Búsqueda universal | Implementado V3 | Contenido en proyectos, ideas, tareas, notas, hitos y fechas |
| Notificaciones internas | Implementado V3 | Inbox persistente; no push del dispositivo |
| Votaciones / decisiones compartidas | Implementado V3 | Un voto por usuario; opciones y cierre |
| Papelera y archivados | Implementado V3 | Recuperación de proyectos; borrado definitivo opcional |
| Exportación JSON y reporte imprimible/PDF | Implementado | PDF mediante imprimir/guardar como PDF del navegador |
| Copias de seguridad consistentes | Implementado V3 | Comando con SQLite backup + uploads |
| Integración OpenAI | Condicional | Funciona solo con API válida, no comprobada en vivo en esta sesión |
| Webhook n8n/Make | Condicional | Configuración opcional externa HTTPS; receptor no desplegado |
| Figma, Canva, GitHub, Drive | Enlaces solamente | Sin OAuth ni sincronización bidireccional |
| Edición colaborativa carácter a carácter | Pendiente | Actualmente SSE tras guardar; conflictos detectados |
| Notificaciones push | Pendiente | Existe centro de avisos interno |
| Offline + app PWA instalada | Pendiente | Necesita diseño de caché y estrategia de resolución de conflictos |
| Sorpresas privadas hasta fecha de revelación | Pendiente | Implica excepción explícita al acceso idéntico |
| Panel CRM avanzado / facturación real | Pendiente | No se han implementado emisión legal de facturas ni conexiones contables |
| Publicación web en VPS | Pendiente de infraestructura | Docker+Caddy incluidos, VPS/DNS no proporcionados |

## Arquitectura

Frontend en JavaScript, CSS y HTML, sin framework de componentes ni dependencias externas. API HTTP Node 22, SQLite `node:sqlite`, scrypt para contraseñas y tokens de sesión aleatorios con hash SHA-256 almacenado. Actualizaciones SSE (no coedición CRDT). Persistencia SQLite WAL. Los datos y archivos privados viven en `data/`, o en volumen Docker. Solo se guardan las notificaciones y versiones cuando ambos tienen cuentas creadas.

## Modelo de colaboración

Ambos usuarios pueden leer y modificar todos los proyectos. Las modificaciones guardadas por uno emiten SSE hacia el otro, que recarga automáticamente si no hay formulario abierto, o espera y avisa de cambios para no borrar un borrador abierto.

Ediciones de notas, ideas, proyectos, tareas, hitos y gastos incorporan versiones de concurrencia que rechazan copias antiguas con HTTP 409. Ciertos elementos como eventos y checklist utilizan aún última escritura válida, por lo que conviene evitar editar simultáneamente la misma ficha hasta incorporar revisiones también en esas entidades. No equivale a edición simultánea carácter a carácter.

## Seguridad, costes y dependencias

Solo dos usuarios, usuarios creados por CLI, cookies de sesión seguras en producción HTTPS, `SameSite=Strict`, validación de origen y datos. No se realizó auditoría profesional independiente, análisis de penetración ni revisión RGPD contractual. Requiere HTTPS y servidor protegido antes de usarlo desde Internet. Los archivos contienen datos privados, así que las copias y exportaciones requieren protección.

El sistema local no necesita pagar suscripción ni dependencias NPM. Infraestructura VPS/dominio y consumo de APIs pueden tener coste. La IA profesional está limitada a Trabajo y los resultados requieren revisión de usuario; no se guardan automáticamente.

## Criterios de aceptación cubiertos por pruebas

Un usuario crea un proyecto e idea y el otro los ve; ambos crean/modifican tareas y votan; las ediciones obsoletas de notas, tareas y gastos son rechazadas; notas se restauran; proyectos pasan a papelera y vuelven; avisos se crean y marcan como leídos; búsquedas incluyen contenidos de proyecto; IA bloqueada para Planes en común; adjuntos autenticados; una sesión de la otra cuenta recibe SSE. Consulta el script de pruebas.
