import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWebhookUrl,extractTasksFromAI } from '../edge/integrations.mjs';

test('Webhook solo HTTPS público sin credenciales o destinos privados evidentes',()=>{
 assert.equal(validateWebhookUrl('https://abc.n8n.cloud/webhook/example'),'https://abc.n8n.cloud/webhook/example');
 for(const bad of ['http://foo.com/path','https://localhost/a','https://127.0.0.1/hook','https://10.0.0.2','https://[::1]/hook','https://user:secret@host.com/test','https://host.local/a'])assert.throws(()=>validateWebhookUrl(bad));
});
test('Tareas IA estrictamente estructuradas, sin contaminar proyectos',()=>{
 assert.deepEqual(extractTasksFromAI('{"tasks":[{"title":"Prototipo","priority":"high"}]}'),[{title:'Prototipo',description:'',priority:'high'}]);
 assert.deepEqual(extractTasksFromAI('hola mundo'),[]);
 assert.deepEqual(extractTasksFromAI('{"tasks":[{"title":""}]}'),[]);
 assert.deepEqual(extractTasksFromAI('{"tasks":[{"title":"OK","description":true}]}'),[]);
 assert.deepEqual(extractTasksFromAI('{"tasks":[]}'),[]);
});
test('Cliente WebSocket y servidor hablan el mismo endpoint',()=>{
 const client=[readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8'),...['pdf','ajustes','conexiones'].map(m=>readFileSync(new URL('../edge/public/m/'+m+'.js',import.meta.url),'utf8'))].join('\n');
 const server=readFileSync(new URL('../edge/worker.mjs',import.meta.url),'utf8');
 assert.match(client,/new WebSocket\(/);
 assert.match(client,/\/api\/ws/);
 assert.doesNotMatch(client,/new EventSource\(/);
 assert.match(server,/url\.pathname==='\/api\/ws'/);
});
test('La pantalla ofrece acciones funcionales y no exposición de claves',()=>{
 const frontend=[readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8'),...['pdf','ajustes','conexiones'].map(m=>readFileSync(new URL('../edge/public/m/'+m+'.js',import.meta.url),'utf8'))].join('\n');
 const backend=readFileSync(new URL('../edge/api.mjs',import.meta.url),'utf8');
 assert.match(frontend,/connections-import-form/);
 assert.match(frontend,/test-integration/);
 assert.match(frontend,/create-ai-tasks/);
 assert.match(backend,/path==='\/api\/integrations\/test'/);
 assert.match(backend,/const taskBulk/);
 assert.match(backend,/if\(p.space!=='work'\)fail\(403/);
});
