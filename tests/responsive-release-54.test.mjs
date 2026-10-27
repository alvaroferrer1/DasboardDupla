import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const get=x=>readFileSync(join(root,x),'utf8');
const browser=get('edge/public/app.js');
const css=get('edge/public/style.css');
const html=get('edge/public/index.html');

test('Instalable en móvil: manifest accesible, recursos reales y metadatos iOS',()=>{
 const m=JSON.parse(get('edge/public/manifest.webmanifest'));
 assert.equal(m.display,'standalone');assert.equal(m.scope,'/');assert.equal(m.start_url,'/');
 assert.match(html,/rel="manifest"/);assert.match(html,/rel="apple-touch-icon"/);
 for(const size of [192,512]){
  const b=readFileSync(join(root,'edge/public',`dupla-icon-${size}.png`));
  assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert(b.length>500,'Los iconos para la pantalla de inicio no son marcadores vacíos');
 }
});

test('Responsive para móvil, tableta, sobremesa y paisaje, sin truncar contenido principal',()=>{
 for(const query of ['max-width:1100px','max-width:850px','max-width:600px','max-width:360px','max-height:500px'])assert(css.includes(query),query);
 for(const rule of ['overflow-wrap:anywhere','height:100dvh','env(safe-area-inset-bottom)','overscroll-behavior-x:contain','prefers-reduced-motion:reduce'])assert(css.includes(rule),rule);
 assert.match(css,/\.modal-form\{overflow-y:auto/);
 assert.match(css,/\.sidebar\.mobile-open \.side-group\{flex:1 1 auto;min-height:0;overflow-y:auto/);
 assert.match(css,/\.budget-scroll,.table-scroll,.project-tabs,.filter-list/);
});

test('Accesibilidad: modal recupera foco, tecla Escape y Tab, menú móvil anuncia estado',()=>{
 assert.match(browser,/S\.modalReturnFocus=document\.activeElement/);
 assert.match(browser,/S\.modalReturnFocus\?\.isConnected/);
 assert.match(browser,/ev\.key==='Tab'&&S\.modal/);
 assert.match(browser,/aria-expanded="false" aria-label="Abrir menú"/);
 assert.match(browser,/setAttribute\('aria-expanded'/);
 assert.match(browser,/id="modal-feedback" class="form-error modal-feedback" role="alert"/);
});

test('Creación segura: confirma identificador y elimina formulario antes de actualizar lista',()=>{
 assert.match(browser,/const v=await api\('\/api\/projects','POST',data\)/);
 assert.match(browser,/if\(!v\?\.project\?\.id\)throw Error/);
 assert.match(browser,/if\(\$\('#modal-root'\)\)\$\('#modal-root'\)\.innerHTML=''/);
 assert.match(browser,/S\.view='work'; S\.space=data\.space==='couple'\?'couple':'work'/);
 assert.match(browser,/if\(form\.dataset\.saving==='1'\)return/);
});

test('Navegación informa errores del servidor y conserva worker/bd originales',()=>{
 assert.match(browser,/No se ha podido actualizar la sección:/);
 assert.match(browser,/No se pudo cargar la sección/);
 const cfg=get('wrangler.jsonc');
 assert(cfg.includes('"name": "dos-espacios-compartido"'));
 assert(cfg.includes('"class_name": "DosRoom"'));
 assert(get('edge/worker.mjs').includes("idFromName('shared-home')"));
 assert.match(html,/v=(5\.[78]|6\.\d+)\.0/);
});

test('Laboratorio IA no rompe la pestaña si el estado externo todavía está cargando',()=>{
 assert.match(browser,/function aiTab\(\)\{const active=Boolean\(S\.dash\?\.integrations\?\.ai\)/);
});
