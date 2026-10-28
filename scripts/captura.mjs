// Capturas reales en Chrome de la web local (harness con SQLite en memoria y dos cuentas de prueba).
// Uso: node scripts/captura.mjs [--anchos 390,768,1440] [--clic "selector"]... [--nombre etiqueta] [--sin-login] [--solo-vista]
// Informa de errores de consola, peticiones fallidas y desbordamiento horizontal; sale con codigo 1 si hay alguno.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const anchos = opt('--anchos', '390,768,1440').split(',').map(Number);
const clics = args.flatMap((a, i) => a === '--clic' ? [args[i + 1]] : []);
const nombre = opt('--nombre', 'captura');
const sinLogin = args.includes('--sin-login');
const soloVista = args.includes('--solo-vista'); // solo lo visible (capturas mas ligeras)
const teclear = opt('--teclear', ''); // texto que se escribe tras los clics, seguido de Intro
const port = Number(opt('--puerto', String(39000 + Math.floor(Math.random() * 700))));
// --base: usar un servidor ya arrancado (p. ej. wrangler dev con IA real) en vez del harness en memoria.
const externo = opt('--base', '');
const base = externo || `http://127.0.0.1:${port}`;
const descargar = opt('--descargar', ''); // selector cuyo clic descarga un archivo: se guarda en .capturas
const esperar = opt('--esperar', ''); // selector que debe aparecer tras clics/tecleo (hasta 90 s)
const outDir = new URL('../.capturas/', import.meta.url);
await mkdir(outDir, { recursive: true });

const server = externo ? null : spawn(process.execPath, ['scripts/local-cloud-browser-harness.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
if (server) await new Promise((ok, ko) => { server.stdout.on('data', d => String(d).includes('DUPLA_TEST_SERVER_READY') && ok()); server.on('exit', c => ko(new Error('harness salio ' + c))); });

const api = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
const init = await api('/api/initialize', { setup_token: 'T'.repeat(64), email_a: 'alvaro@dupla.test', email_b: 'angie@dupla.test', password_a: 'Prueba-Alvaro-2026!', password_b: 'Prueba-Angie-2026!' });
// Con servidor externo las cuentas pueden existir ya (409): se reutilizan.
if (init.status !== 201 && !(externo && init.status === 409)) throw new Error('initialize ' + init.status + ' ' + await init.text());
if (args.includes('--datos')) await sembrar();

// Datos de ejemplo (solo en la base en memoria del harness): viaje con destino real, planes, tareas e ideas de los dos.
async function sembrar() {
  const login = async (email, password) => (await api('/api/login', { email, password })).headers.get('set-cookie').split(';')[0];
  const as = cookie => (path, body, method = 'POST') => fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, cookie }, body: JSON.stringify(body) }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(path + ' ' + r.status + ' ' + JSON.stringify(j)); return j; });
  const alvaro = as(await login('alvaro@dupla.test', 'Prueba-Alvaro-2026!')), angie = as(await login('angie@dupla.test', 'Prueba-Angie-2026!'));
  const d = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const bud = (await alvaro('/api/projects', { space: 'couple', title: 'Viaje a Budapest', template: 'trip', destination: 'Budapest', start_date: d(52), end_date: d(56), status: 'planning' })).project;
  const ita = (await angie('/api/projects', { space: 'couple', title: 'Escapada Italia', template: 'weekend', destination: 'Florencia', start_date: d(10), end_date: d(12), status: 'planning' })).project;
  const cena = (await angie('/api/projects', { space: 'couple', title: 'Cena de aniversario', template: 'dinner', status: 'planning' })).project;
  const web = (await alvaro('/api/projects', { space: 'work', title: 'Web Lumen Estudio', template: 'website', status: 'active' })).project;
  await alvaro(`/api/projects/${bud.id}/tasks`, { title: 'Confirmar hotel', due_date: d(9), priority: 'high' });
  await angie(`/api/projects/${bud.id}/tasks`, { title: 'Revisar itinerario día 2', due_date: d(30) });
  for (const [t, k, h, b] of [['Galería Uffizi', 10, '10:00', 'booked'], ['Cena en Oltrarno', 10, '21:00', 'pending'], ['Subir al Piazzale Michelangelo', 11, '19:30', 'not_needed']]) await angie(`/api/projects/${ita.id}/operations/itinerary`, { title: t, visit_date: d(k), visit_time: h, booking_state: b, location: 'Florencia' });
  await angie(`/api/projects/${bud.id}/events`, { title: 'Paseo en barco por el Danubio', event_date: d(53), event_time: '20:30', location: 'Budapest' });
  const us = (await alvaro('/api/dashboard', undefined, 'GET')).users || [], uid = n => us.find(x => new RegExp(n, 'i').test(x.name))?.id;
  for (const [t, c, a, w] of [['Vuelos Ryanair', 'flights', 186, 'lvaro'], ['Apartamento centro', 'stay', 340, 'Angie'], ['Cena en Gerbeaud', 'food', 74.5, 'Angie']]) await alvaro(`/api/projects/${bud.id}/expenses`, { title: t, category: c, estimated: a, actual: a, paid_by: uid(w) });
  for (const [t, dd, b] of [['Primera cena en Gerbeaud', d(-365), 'Nos prometimos volver'], ['Concierto en el Pilar', d(-30), ''], ['Domingo de picnic', d(-370), 'El día que vimos la casa']]) await angie('/api/couple-items', { kind: 'memory', title: t, item_date: dd, body: b });
  await alvaro('/api/projects', { space: 'couple', title: 'Escapada a Oporto', template: 'trip', destination: 'Oporto', start_date: d(-120), end_date: d(-117), status: 'done' });
  await alvaro('/api/weekly-review/run', {});
  await angie(`/api/projects/${cena.id}/events`, { title: 'Cena especial', event_date: d(25), event_time: '21:00', location: 'Restaurante del puerto' });
  await alvaro(`/api/projects/${web.id}/events`, { title: 'Entrega del prototipo', event_date: d(18) });
  await angie('/api/ideas', { space: 'couple', title: 'Spa en Budapest', body: 'Baños Széchenyi al atardecer' });
  await alvaro('/api/ideas', { space: 'work', title: 'Newsletter mensual para clientes' });
  // Las portadas se descargan en segundo plano: espera (max. 15 s) a que lleguen para que salgan en la captura.
  const cookie = await login('alvaro@dupla.test', 'Prueba-Alvaro-2026!');
  for (let i = 0; i < 30; i++) { const ps = await Promise.all([bud, ita].map(p => fetch(`${base}/api/projects/${p.id}`, { headers: { cookie } }).then(r => r.json()))); if (ps.every(x => x.project?.cover_file)) break; await new Promise(r => setTimeout(r, 500)); }
  const hoy = new Date().toLocaleDateString('en-CA');
  await alvaro(`/api/projects/${web.id}/events`, { title: 'Llamada con cliente', event_date: hoy, event_time: '18:00' });
  await angie(`/api/projects/${cena.id}/events`, { title: 'Yoga', event_date: hoy, event_time: '18:30' });
  const t1 = (await alvaro('/api/board', { title: 'Reservar hotel en Zaragoza', priority: 'urgent' })).item;
  await alvaro('/api/board', { title: 'Pagar la señal', parent_id: t1.id, priority: 'high' });
  await alvaro('/api/task-notes', { kind_of: 'board', id: t1.id, kind: 'avance', content: 'He mirado 3 hoteles cerca del centro, el mejor es el Palafox.' });
  await angie('/api/task-notes', { kind_of: 'board', id: t1.id, kind: 'falta', content: '¿Llegamos el viernes o el sábado? Sin eso no puedo reservar.' });
  await alvaro('/api/task-notes', { kind_of: 'board', id: t1.id, kind: 'bloqueo', content: 'La web del hotel da error al pagar con tarjeta.' });
  await angie('/api/board', { title: 'Pedir cita médico', priority: 'normal', status: 'doing' });
  await angie('/api/board', { title: 'Comprar regalo', priority: 'low', status: 'done' });
  console.log('DATOS de ejemplo creados', [bud.title, ita.title, cena.title, web.title].join(' · '));
}

if (args.includes('--servir')) { console.log(`VISTA PREVIA en ${base}  ·  alvaro@dupla.test / Prueba-Alvaro-2026!  ·  angie@dupla.test / Prueba-Angie-2026!  (Ctrl+C para parar)`); await new Promise(() => {}); }
const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
const problemas = [];
try {
  for (const ancho of anchos) {
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: ancho, height: ancho < 600 ? 844 : 900 }, deviceScaleFactor: 1, locale: 'es-ES' });
    const page = await ctx.newPage();
    page.on('console', m => m.type() === 'error' && problemas.push(`[${ancho}] consola: ${m.text()}`));
    page.on('pageerror', e => problemas.push(`[${ancho}] excepcion: ${e.message}`));
    page.on('response', r => r.status() >= 400 && !r.url().includes('/api/ws') && problemas.push(`[${ancho}] HTTP ${r.status()} ${r.url().replace(base, '')}`));
    if (!sinLogin) {
      const r = await ctx.request.post(base + '/api/login', { headers: { origin: base }, data: { email: 'alvaro@dupla.test', password: 'Prueba-Alvaro-2026!' } });
      if (!r.ok()) throw new Error('login ' + r.status());
    }
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    // --sin-red: la página ya cargada con el service worker; se corta la red y se recarga (modo sin cobertura).
    if (args.includes('--sin-red')) { await page.evaluate(() => navigator.serviceWorker.ready); await page.reload({ waitUntil: 'networkidle' }); await ctx.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500); }
    for (const js of args.flatMap((a, i) => a === "--eval" ? [args[i + 1]] : [])) await page.evaluate(js);
    for (const sel of clics) { if (sel.startsWith("fill:")) { const k = sel.lastIndexOf("="); await page.fill(sel.slice(5, k), sel.slice(k + 1)); continue; } await page.click(sel, { timeout: 5000 }); await page.waitForTimeout(400); }
    if (teclear) { await page.keyboard.type(teclear); await page.keyboard.press('Enter'); await page.waitForTimeout(800); }
    if (esperar) await page.waitForSelector(esperar, { timeout: 90000 });
    if (descargar) { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(descargar)]); const f = fileURLToPath(new URL(`${nombre}-${ancho}-${dl.suggestedFilename().replace(/[^\w.-]+/g, '_')}`, outDir)); await dl.saveAs(f); console.log('DESCARGA', f); }
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problemas.push(`[${ancho}] desbordamiento horizontal de ${overflow}px`);
    const file = fileURLToPath(new URL(`${nombre}-${ancho}.png`, outDir));
    await page.screenshot({ path: file, fullPage: !soloVista });
    console.log('CAPTURA', file);
    await ctx.close();
  }
} finally { await browser.close(); server?.kill(); }

if (problemas.length) { console.log('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('OK: sin errores de consola, sin peticiones fallidas, sin desbordamiento.');
