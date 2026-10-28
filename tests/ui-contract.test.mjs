import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('DUPLA UI: cada data-action tiene un caso real y no queda como botón decorativo',()=>{
 const source=['app.js','m/pdf.js','m/ajustes.js','m/conexiones.js'].map(x=>read('edge/public/'+x)).join('\n');
 const actions=[...source.matchAll(/data-action="([a-z-]+)"/g)].map(x=>x[1]);
 const handlers=new Set([...source.matchAll(/case '([a-z-]+)'/g)].map(x=>x[1]));
 assert(actions.length>50);
 for(const action of actions)assert(handlers.has(action),`Sin manejador: ${action}`);
 assert(source.includes('await api(`/api/projects/${id}/tasks/manual-bulk`'));
 assert(source.includes('await api(\'/api/system/status\')'));
 assert(source.includes('await api(\'/api/sessions/revoke-others\''));
});
test('DUPLA Cloudflare: marca nueva, mismas cuentas y misma base de datos',()=>{
 const config=read('wrangler.jsonc');const worker=read('edge/worker.mjs');const css=read('edge/public/style.css');
 assert(config.includes('"name": "dos-espacios-compartido"'));
 assert(config.includes('"class_name": "DosRoom"'));
 assert(config.includes('"new_sqlite_classes"'));
 assert(worker.includes("idFromName('shared-home')"));
 assert(css.includes('.sidebar{position:fixed;top:0;bottom:0;left:0;width:255px;'));
 assert(css.includes('.side-group {'));
 assert(read('edge/public/index.html').includes('DUPLA'));
 assert(fs.existsSync(path.join(root,'edge/public/dupla-icon.svg')));
 assert(read('edge/db.mjs').includes('iterations:100000'));
});
