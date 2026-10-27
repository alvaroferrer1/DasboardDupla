# Informe de pruebas V3

Fecha: 14 de octubre de 2026.

## Ejecutado y superado

- `npm run check`: sin errores de sintaxis en backend, DB, scripts y frontend.
- `npm test`: 14 pruebas Node TAP superadas, incluida prueba agrupadora y 13 comprobaciones de integración.
- Pruebas con dos sesiones API independientes: login, acceso compartido, ideas, conversión en proyecto, tareas, checklist, conflictos (HTTP 409), versiones/restauración de notas, votos con bloqueo al cierre, SSE, archivos autenticados, presupuestos, hitos, fechas, búsqueda, notificaciones, archivado, papelera reversible, calendario/exportación y separación de IA profesional.
- `npm run backup`: se generó y comprobó una instantánea SQLite junto al manifest sin errores.
- Comprobación del frontend **con estado/API simulados**, ejecutando el `app.js` y el `style.css` de V3 en Chromium, visitando Inicio, Buzón de ideas, Buscador, Notificaciones, Decisiones, Historial de notas, y vista móvil. No se detectaron errores JavaScript en estas rutas. La vista móvil comprobada tiene 390 px sin scroll horizontal.

## Importante: qué no se verificó

El entorno de navegador Chromium bloqueó conexiones a localhost mediante `ERR_BLOCKED_BY_ADMINISTRATOR`. Por eso, **NO** se completó una prueba end-to-end del navegador real conectado al servidor real. El backend se probó por HTTP y la interfaz por separado con respuestas simuladas. Es necesario completar esa prueba integrada al ejecutar en tu ordenador o en un VPS. Tampoco se hizo test real con OpenAI/n8n ni integración OAuth externa, porque no hay credenciales ni terceros configurados.

No se realizó pentest, auditoría independiente, pruebas de miles de usuarios (la app es para dos) ni publicación real con dominio y HTTPS. No llamar 'verificada en producción' hasta tener resultados de prueba en el entorno final.

## Cómo repetir

```
npm run check
npm test
npm start
```

Después, con las dos cuentas reales y dos navegadores/dispositivos distintos que compartan el mismo servidor, comprueba crear y editar ideas, cambios SSE, tareas, votaciones, restauración, subida de archivo y notas simultáneas. Revisa la consola del navegador. Para copia: `npm run backup`.

Las imágenes `preview/` llevan **datos sintéticos**, exclusivamente para mostrar el diseño real de la interfaz, y no son capturas de una instancia publicada.
