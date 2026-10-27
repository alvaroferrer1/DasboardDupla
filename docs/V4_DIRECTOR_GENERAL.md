# DOS ESPACIOS V4 · Datos, conocimiento y Director General

## Entrega comprobada

Cambios reales sobre el ZIP de V3: migraciones SQLite aditivas, Biblioteca de Conocimiento compartida, analítica calculada desde tablas reales, auditoría mínima de eventos, módulo Director General de solo lectura, herramienta CLI de inspección, y CI Github Actions. El diseño previo permanece; se han añadido apartados en su navegación.

### Biblioteca

- Cada entrada guarda título, pregunta, respuesta, fuente/URL introducida por el usuario, etiquetas, espacio, proyecto relacionado opcional, autor, estado draft/reviewed/validated, revisión y fechas. Ambos usuarios tienen acceso igualitario.
- No se ingiere contenido externo automáticamente ni se manda información a un proveedor de IA.
- Las ediciones con revisiones obsoletas responden HTTP 409 para evitar sobrescrituras silenciosas.
- Se puede crear, editar, validar y eliminar contenido desde la interfaz.

### Datos e inteligencia

- Métricas persistentes y segmentadas de proyectos, tareas, ideas y conocimientos.
- Serie diaria de eventos de cambios registrados **desde V4**. No se inventa ni reconstruye el historial anterior.
- Sin rastreo de páginas, ubicación, teclas, chats externos o otros datos no autorizados.
- Actualmente no hay ETL externa, warehouse, embeddings ni RAG: serán una evolución aparte con fuentes validadas y acuerdos de tratamiento.

### Director General

- Inspección determinista del repositorio mediante `ops/guardian.mjs`, sin dependencias npm.
- Detecta ausencia de ciertos elementos de CI/documentación por heurísticas y algunos patrones de riesgo; no equivale a pentest ni auditoría legal.
- Ejecuta opcionalmente pruebas de proyecto y produce `report.json` y un dashboard HTML local.
- Para publicar resultados al panel **privado**: `npm run guardian:private` (se ejecuta en terminal, nunca por acción web).
- El navegador únicamente puede leer un resumen sin logs a través de `/api/guardian/report` después de autenticarse. No existen endpoints remotos para ejecutar shell ni modificar sistemas.
- El indicador de calidad técnica no implica autorización de despliegue a producción.
- El informe HTML local puede contener logs resumidos: no distribuir públicamente. La copia del JSON de producción debe permanecer en el directorio `data` fuera de Git.

### Ejecución

```
npm run check
npm test
npm run guardian:private
npm start
```

Node >=22.13. Configura las dos cuentas con `npm run setup` en un directorio privado nuevo. La base de datos anterior se conserva mediante migraciones al arrancar. Haz **backup** antes de instalar sobre datos en uso.

## Comprobaciones ejecutadas en esta sesión

- `npm run check`: PASS.
- `npm test`: 17 casos Node TAP PASS, incluidos dos nuevos tests de `guardian-core` y uno de conocimiento/analítica con dos usuarios.
- Smoke tests del nuevo frontend en Chromium con CSS/JS originales pero API simulada construida a partir de respuestas HTTP reales: Biblioteca, Datos e Inteligencia, Director General, escritorio y móvil sin errores JavaScript. Esta prueba **no** verifica el navegador de extremo a extremo contra localhost (bloqueo administrativo del entorno).
- Backend probado por API real usando un servidor local con SQLite temporal y dos cuentas de prueba.
- No se ha realizado auditoría de seguridad integral, revisión jurídica independiente ni despliegue externo.

## Limitaciones reales

- Dots no están integrados; son una función separada de ChatGPT sujeta a plan/región.
- No hay agente IA autónomo continuo, auto-corrección, ni IA multimodal nativa en el Supervisor: es una fundación con código explícito y pruebas.
- El control de acceso es actualmente de dos cuentas con igual permiso; no añadir terceros sin redefinir la política.
- SQLite requiere persistencia y copias verificadas al publicar; conviene evaluar PostgreSQL para escalar.
- V4 no añade coedición carácter a carácter, integración OAuth con proveedores, push, conectividad offline ni auditoría legal completa. Todas estas funcionalidades continúan pendientes.
- Los resultados de controles heurísticos pueden tener falsos positivos o negativos; no equivalen a un estado de seguridad garantizado.

## Rutas

- `GET /api/knowledge`, `POST /api/knowledge`, `PATCH /api/knowledge/:id`, `DELETE /api/knowledge/:id`
- `GET /api/analytics` con filtro opcional `space=work|couple`
- `GET /api/guardian/report` (solo lectura, protegido por autenticación)

**No usar en producción sin revisión de infraestructura, backups, SSL, seguridad, política de privacidad y pruebas completas en entorno final.**
