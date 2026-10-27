// Recorrido real en Chrome: Conexiones -> elegir proyecto -> activar Figma solo ahí -> comprobar tabla y otro proyecto.
import { chromium } from 'playwright-core';
const base = process.argv[2];
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
await ctx.request.post(base + '/api/login', { headers: { origin: base }, data: { email: 'alvaro@dupla.test', password: 'Prueba-Alvaro-2026!' } });
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto(base + '/', { waitUntil: 'networkidle' });
await page.click('.sidebar [data-nav=connections]'); await page.waitForSelector('.cx-grid');
const web = await page.$eval('[data-cx-scope]', s => [...s.options].find(o => o.text.includes('Web Lumen')).value);
await page.selectOption('[data-cx-scope]', web); await page.waitForTimeout(300);
await page.click('[data-action=cx-toggle][data-provider=figma]'); await page.waitForSelector('.cx-table');
const fila = await page.$eval('.cx-table tbody tr', r => r.innerText.replace(/\s+/g, ' '));
await page.screenshot({ path: process.argv[3] });
const viaje = await page.$eval('[data-cx-scope]', s => [...s.options].find(o => o.text.includes('Viaje a Budapest')).value);
await page.selectOption('[data-cx-scope]', viaje); await page.waitForTimeout(300);
const figmaViaje = await page.$eval('[data-action=cx-toggle][data-provider=figma]', el => el.getAttribute('aria-checked'));
console.log('FILA:', fila); console.log('FIGMA en Viaje a Budapest activo:', figmaViaje); console.log('ERRORES:', errs.length ? errs : 'ninguno');
await b.close();
