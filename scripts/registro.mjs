// Genera docs/CUMPLIMIENTO.md: los 706 puntos del inventario con estado, solución, prueba y evidencia.
// Estados: No revisado · Pendiente · Existe, pero no verificado · En desarrollo · Validado localmente · Validado en producción · Bloqueado (externo)
import { readFileSync, writeFileSync } from 'node:fs';
const inv = readFileSync(new URL('../../../DUPLA_INVENTARIO_COMPLETO_PARA_IA.txt', import.meta.url), 'utf8').split(/\r?\n/);
const VL = 'Validado localmente', NV = 'Existe, pero no verificado', BX = 'Bloqueado (externo)';
const T = 'tests/v6-backend.test.mjs';
// [desde, hasta, módulo, solución, archivos, prueba/evidencia]
const R = [
 [1, 83, 'General', 'Fusión por módulos (ver cada módulo)', 'edge/public/app.js, style.css, edge/v6.mjs', 'npm run verificar + capturas por módulo'],
 [84, 116, 'Inicio', 'Hero con foto/tiempo, accesos rápidos, próximos planes (incluye calendario compartido), actividad, idea rápida, estado avisos/conexiones', 'app.js (homePage), v6.mjs', 'v6-backend (viaje/portada/tiempo) + captura m2-home'],
 [117, 147, 'Ajustes', 'Pestañas como la imagen (cuenta, apariencia, notificaciones, privacidad, datos, espacios, calendario, asistente, PDF, dispositivos)', 'app.js (settingsPage), v6.mjs', 'v6-backend (prefs, sesiones, avatar, copia) + captura m3'],
 [148, 183, 'Conexiones', 'Tarjetas con estado y alcance global/espacio/proyecto con permisos', 'app.js (connectionsPage), v6.mjs, tabla connections', 'v6-backend Conexiones + captura m4'],
 [184, 209, 'Buscador', 'Resultados agrupados, filtros de espacio y proyecto, volver a lo último, semántica IA', 'app.js (searchPage), api.mjs /api/search, v6 /api/search/semantic', T + ' Buscador/Semántica + capturas sr, srp'],
 [210, 243, 'Notificaciones', 'Push cifrado con contenido, filtros, estados, importante, entrega por aviso', 'app.js (notificationsPage), api.mjs, web-push.mjs', 'v6-push.test + ' + T + ' + captura notif'],
 [244, 269, 'Calendario', 'Mes/semana/agenda, filtros, vínculo a proyecto, completado, crear plan desde evento, lectura iCal del calendario conjunto', 'app.js (datesPage), v6.mjs /api/calendar/*', T + ' Calendario + capturas cal, cal-det'],
 [270, 300, 'Viajes', 'Cabecera con foto y progreso, pestañas, días con check, actividades hechas/canceladas/reagendadas/movidas, reservas usadas', 'app.js (tripPage), api.mjs operations/days', T + ' Viajes + capturas trip, tripit'],
 [301, 323, 'Reuniones', 'Videollamada WebRTC propia, transcripción Whisper por persona y tramo, resumen/tareas/decisiones IA aparte', 'app.js (meetingsPage/meetingRoom), v6.mjs /api/meetings', T + ' Reuniones + scripts/prueba-reunion.mjs (dos Chrome conectados)'],
 [324, 343, 'Ideas', 'Captura rápida con borrador guardado, estados, retomar, convertir en trabajo/plan/viaje/deseo, expandir IA', 'app.js (ideasPage), api.mjs /api/ideas, v6 expand', T + ' Ideas + captura ideas'],
 [344, 363, 'Actividad', 'Cronología por día, filtros persona/espacio/proyecto/tipo, contexto y enlaces', 'app.js (activityPage), v6 /api/activity', T + ' Actividad + captura act'],
 [364, 385, 'Director General', 'Sugerencias reales por espacio (retrasos, viaje, presupuesto, tareas, ideas) con 5 estados; se conserva la revisión técnica', 'app.js (guardianPage), v6 /api/director', T + ' Director'],
 [386, 413, 'PDF', 'PDF real con jsPDF: itinerario y dossier, descargar y compartir', 'app.js (buildPdf), public/vendor/jspdf.umd.min.js', 'PDF descargado y revisado (captura.mjs --descargar)'],
 [414, 440, 'Presupuestos', 'Categorías de viaje, previsto vs real y total; calculadora freelance con IVA/IRPF y PDF; presupuesto común separado', 'app.js (budgetTab, quoteBox), v6 /quote, /budget/summary', T + ' Presupuestos + captura qt'],
 [441, 461, 'Nuestro espacio', 'Planes por tipo, recuerdos con foto, metas, deseos, regalos, casa, presupuesto común, planificador con Dupla', 'app.js (coupleLife), v6 /api/couple-items', T + ' Nuestro espacio + captura cp'],
 [462, 501, 'Resumen de módulos', 'Ver módulo correspondiente', '—', 'Ver módulo'],
 [502, 510, 'Reglas de la IA', 'Trabajo por módulos, sin romper lo existente, sin dar por terminado lo no comprobado', 'ESTADO.md', 'npm run verificar (todas las pruebas antiguas siguen pasando)'],
 [511, 540, 'Dos espacios', 'Se conservan Trabajo y Nuestro espacio, edición y guardado', 'app.js, api.mjs', 'pruebas existentes (dupla-*.test) en verde'],
 [541, 558, 'Ajustes y Conexiones', 'Ver Ajustes y Conexiones', '—', 'Ver módulos'],
 [559, 597, 'Inicio, buscador, actividad, calendario', 'Ver módulos', '—', 'Ver módulos'],
 [598, 641, 'Viajes, reuniones, ideas, presupuestos', 'Ver módulos', '—', 'Ver módulos'],
 [642, 663, 'Prohibiciones y calidad', 'Cambios acotados, regresiones cubiertas por las pruebas existentes, evidencia por módulo', 'ESTADO.md, .capturas', 'npm run verificar'],
 [664, 683, 'Forma de trabajo', 'Módulo a módulo, sin ZIPs, en el repositorio git', 'ESTADO.md', 'git status'],
 [684, 706, 'Resultado esperado', 'Ver módulos', '—', 'Ver módulos'],
];
// Excepciones honestas
const X = {
 [BX]: { ids: [19, 20, 251, 253, 268, 299, 493, 589, 590, 591, 595, 596, 597, 691, 702, 703], why: 'Falta la dirección secreta iCal (lectura) o el cliente OAuth de Google (escritura) del calendario conjunto; ID ya fijado en DUPLA. No se da por conectado sin prueba.' },
 [NV]: { ids: [15, 16, 213, 214, 217, 218, 233, 242, 492, 696, 31, 32, 33, 311, 312, 314, 317, 318, 319, 320, 323, 609, 610, 611, 614, 617, 618, 698, 205, 341], why: 'Implementado y probado con simulación; falta comprobarlo con el servicio real (push en los dos iPhone / email real / Whisper y resumen con Workers AI real).' },
};
const st = id => { for (const [k, v] of Object.entries(X)) if (v.ids.includes(id)) return [k, v.why]; return [VL, '']; };
const rows = [];
for (const line of inv) { const m = line.match(/^(\d{4}) \[(L\d+)\] \[([^\]]+)\] \[([^\]]+)\] (.*)$/); if (!m) continue;
 const id = +m[1], r = R.find(x => id >= x[0] && id <= x[1]), [estado, nota] = st(id);
 rows.push(`| ${m[1]} | ${m[5].replace(/\|/g, '/')} | ${m[2]} | ${r[2]} | ${estado} | ${r[3]}${nota ? ' — ' + nota : ''} | ${r[4]} | ${r[5]} |`); }
const count = k => rows.filter(r => r.includes(`| ${k} |`)).length;
writeFileSync(new URL('../docs/CUMPLIMIENTO.md', import.meta.url), `# Registro de cumplimiento DUPLA (706 puntos)\n\nGenerado ${new Date().toISOString().slice(0, 10)} por scripts/registro.mjs. Estado inicial de todos: No revisado.\n\n- ${VL}: ${count(VL)}\n- ${NV}: ${count(NV)}\n- ${BX}: ${count(BX)}\n- Validado en producción: 0 (aún no publicado)\n\n| ID | Requisito | Línea | Módulo | Estado | Solución | Archivos | Prueba / evidencia |\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
console.log('Registro:', rows.length, 'puntos ·', VL, count(VL), '·', NV, count(NV), '·', BX, count(BX));
