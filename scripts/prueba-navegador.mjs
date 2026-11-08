// Pruebas en Chrome real dentro de `npm run verificar`: cada guion de tests/navegador se ejecuta sobre la web local con datos de ejemplo.
// Fallan si hay errores de consola, peticiones fallidas o desbordamiento (captura.mjs) o si el guion escribe console.error.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
// Arrastre real con el ratón (Prueba uno/dos/tres las crea el guion tablero.js).
const tarjeta = t => `article.bd-card:has-text("${t}")`;
const arrastres = [['Prueba tres', 'Prueba dos'], ['Prueba uno', 'Prueba parada'], ['Prueba dos', 'Prueba urgente']].flatMap(([a, b]) => ['--clic', `drag:${tarjeta(a)}=>${tarjeta(b)}`]);
const casos = [
  ['menu-y-foco', '390,1440'],
  ['direcciones', '390,1440'],
  ['deshacer', '1440'],
  ['agente', '390,1440'],
  ['informe', '390,1440'],
  ['finanzas-csv', '390,1440'],
  ['novedades', '390,1440'],
  ['saldar', '390,1440'],
  ['viajes-finanzas', '390,1440'],
  ['panel-movil', '390'],
  ['errores', '1440'],
  ['nosotros', '390,1440'],
  ['gastos-fotos-listas', '390,1440'],
  ['tablero', '1440', [...arrastres, '--tras', readFileSync(new URL('../tests/navegador/tablero-tras.js', import.meta.url), 'utf8')]],
];
let fallos = 0;
for (const [nombre, anchos, extra = []] of casos) {
  const js = readFileSync(new URL(`../tests/navegador/${nombre}.js`, import.meta.url), 'utf8');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['scripts/captura.mjs', '--datos', '--solo-vista', '--nombre', 'nav-' + nombre, '--anchos', anchos, '--eval', js, ...extra], { cwd: raiz, encoding: 'utf8', timeout: 240000 });
  const ok = r.status === 0;
  if (!ok) fallos++;
  console.log(`${ok ? '✔' : '✖'} navegador: ${nombre} (${anchos}) ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!ok) console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => /PROBLEMAS|consola|excepcion|HTTP|desbord|Error/.test(l)).slice(0, 8).join('\n'));
}
if (fallos) { console.log(`✖ ${fallos} prueba(s) de navegador fallida(s)`); process.exit(1); }
console.log('✔ pruebas de navegador en verde');
