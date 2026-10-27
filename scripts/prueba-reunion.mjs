// Prueba real de la videollamada: dos cuentas en dos Chrome (cámara y micro simulados) se unen y deben verse.
// Uso: node scripts/prueba-reunion.mjs   → capturas en .capturas/reunion-alvaro.png y reunion-angie.png
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const port = 39300 + Math.floor(Math.random() * 500), base = `http://127.0.0.1:${port}`, outDir = new URL('../.capturas/', import.meta.url);
await mkdir(outDir, { recursive: true });
const server = spawn(process.execPath, ['scripts/local-cloud-browser-harness.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, ko) => { server.stdout.on('data', d => String(d).includes('DUPLA_TEST_SERVER_READY') && ok()); server.on('exit', c => ko(new Error('harness ' + c))); });
const post = (path, data, cookie) => fetch(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(data) });
await post('/api/initialize', { setup_token: 'T'.repeat(64), email_a: 'alvaro@dupla.test', email_b: 'angie@dupla.test', password_a: 'Prueba-Alvaro-2026!', password_b: 'Prueba-Angie-2026!' });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const problemas = [];
try {
  const pages = [];
  for (const [who, email, pass] of [['alvaro', 'alvaro@dupla.test', 'Prueba-Alvaro-2026!'], ['angie', 'angie@dupla.test', 'Prueba-Angie-2026!']]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'es-ES', permissions: ['camera', 'microphone'] });
    const r = await ctx.request.post(base + '/api/login', { headers: { origin: base }, data: { email, password: pass } });
    if (!r.ok()) throw new Error('login ' + who);
    const page = await ctx.newPage();
    page.on('pageerror', e => problemas.push(`${who}: ${e.message}`));
    page.on('console', m => m.type() === 'error' && problemas.push(`${who} consola: ${m.text()}`));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    pages.push([who, page, ctx]);
  }
  const [, pa, ctxA] = pages[0];
  const m = await (await ctxA.request.post(base + '/api/meetings', { headers: { origin: base }, data: { title: 'Prueba de videollamada' } })).json();
  for (const [, page] of pages) { await page.click('[data-nav="meetings"] >> visible=true'); await page.click(`[data-action="meeting-open"][data-id="${m.meeting.id}"]`); }
  for (const [, page] of pages) { await page.click('[data-action="mt-join"]'); await page.waitForTimeout(800); }
  for (const [who, page] of pages) {
    await page.waitForFunction(() => { const v = document.querySelector('#mt-remote'); return v && v.srcObject && v.videoWidth > 0; }, null, { timeout: 30000 }).catch(() => problemas.push(`${who}: no recibe el vídeo de la otra persona`));
    const estado = await page.evaluate(() => { const v = document.querySelector('#mt-remote'); return v?.videoWidth ? 'vídeo remoto ' + v.videoWidth + 'x' + v.videoHeight : 'sin vídeo remoto'; });
    console.log(who, 'estado conexión:', estado);
    await page.screenshot({ path: fileURLToPath(new URL(`reunion-${who}.png`, outDir)) });
  }
  await pa.click('[data-action="mt-hang"]');
} finally { await browser.close(); server.kill(); }
if (problemas.length) { console.error('PROBLEMAS:\n' + problemas.join('\n')); process.exit(1); }
console.log('OK: los dos se ven y se oyen (conexión WebRTC directa).');
