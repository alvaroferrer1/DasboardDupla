import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../edge/api.mjs';

function fixture(extraEnv={},file=':memory:'){
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');
 const metadata=new Map();const storage={async get(key){return metadata.get(key)||null;},async put(key,value){metadata.set(key,value);},sql:{exec(sql,...bindings){
  if(!bindings.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
  const rows=reader?stmt.all(...bindings):[];
  const changes=reader?0:stmt.run(...bindings).changes;
  return {toArray:()=>rows,rowsWritten:changes};
 }},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(err){db.exec('ROLLBACK');throw err;}}};
 const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64),...extraEnv},{getWebSockets:()=>[]});
 async function call(path,method='GET',body,cookie){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test'});
  if(cookie)headers.set('cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const request=new Request('https://dupla.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let consumed=false,resolve,code=200;const h=new Headers(),promise=new Promise(r=>resolve=r);
  const req={method,headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(consumed)return;consumed=true;const bytes=await request.arrayBuffer();if(bytes.byteLength)yield Buffer.from(bytes);}};
  const res={headersSent:false,writableEnded:false,writeHead(n,headers={}){code=n;this.headersSent=true;for(const[k,v]of Object.entries(headers))h.set(k,v);},end(body){this.writableEnded=true;resolve(new Response(body??null,{status:code,headers:h}));}};
  try{await app.api(req,res,new URL(request.url));}catch(e){if(!res.headersSent)res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:String(e)}));}
  const response=await promise;let data;try{data=await response.clone().json();}catch{}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
 }
 async function initialize(){
  const init=await call('/api/initialize','POST',{setup_token:'A'.repeat(64),email_a:'a@local.test',email_b:'b@local.test',password_a:'clave-super-a-1234',password_b:'clave-super-b-2345'});assert.equal(init.status,201,JSON.stringify(init.data));
  const a=await call('/api/login','POST',{email:'a@local.test',password:'clave-super-a-1234'});assert.equal(a.status,200,JSON.stringify(a.data));
  const b=await call('/api/login','POST',{email:'b@local.test',password:'clave-super-b-2345'});assert.equal(b.status,200);
  return [a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,app,call,initialize};
}



test('WEBHOOK OUTBOX: Work se guarda en SQLite, reintenta tras fallo y se entrega una sola vez',async()=>{
 const original=globalThis.fetch, calls=[];
 let mode='network-fail';
 globalThis.fetch=async(url,opts)=>{
  assert.equal(url,'https://automation.example.com/dupla');calls.push({id:opts.headers['Idempotency-Key'],body:JSON.parse(opts.body)});
  if(mode==='network-fail')throw Error('Servidor remoto no disponible');
  if(mode==='bad-request')return new Response('bad request',{status:400});
  return new Response('ok',{status:200});
 };
 const {db,app,call,initialize}=fixture({WORK_WEBHOOK_URL:'https://automation.example.com/dupla'});
 try{
  const [a,b]=await initialize();
  assert.equal((await call('/api/integrations/outbox')).status,401);
  assert.equal((await call('/api/integrations/retry','POST',{})).status,401);
  const c=await call('/api/projects','POST',{space:'couple',title:'Cena privada'},a);
  assert.equal(c.status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_outbox').get().n,0,'Planes no se exporta a webhooks profesionales');
  const p=await call('/api/projects','POST',{space:'work',title:'Proyecto de automatización'},a);
  assert.equal(p.status,201);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_outbox').get().n,1);
  const queue=await call('/api/integrations/outbox','GET',undefined,b);
  assert.equal(queue.status,200);
  assert(!JSON.stringify(queue.data).includes('automation.example.com'),'diagnóstico no filtra URL privada');
  const failed=await app.flushWebhookQueue();assert.equal(failed.failed,1);
  let row=db.prepare('SELECT * FROM webhook_outbox').get();assert.equal(row.status,'pending');assert.equal(row.attempts,1);
  db.prepare('UPDATE webhook_outbox SET next_attempt_at=0').run();mode='ok';
  const success=await app.flushWebhookQueue();assert.equal(success.sent,1);
  row=db.prepare('SELECT * FROM webhook_outbox').get();assert.equal(row.status,'sent');assert.equal(row.attempts,2);
  assert.equal(calls[0].id,calls[1].id,'Idempotency-Key idéntica en cada reintento');
  assert.equal(calls[1].body.space,'work');
  assert.equal((await app.flushWebhookQueue()).sent,0,'No duplica la entrega ya confirmada');
  assert.equal(calls.length,2);
  const fromB=await call('/api/integrations/outbox','GET',undefined,b);
  assert.equal(fromB.data.items[0].status,'sent');
 }finally{globalThis.fetch=original;db.close();}
});

test('WEBHOOK OUTBOX: fallo HTTP 400 no entra en bucle; 503 respeta el backoff',async()=>{
 const previous=globalThis.fetch;let remoteCode=400,calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('error',{status:remoteCode});};
 const {db,app,call,initialize}=fixture({WORK_WEBHOOK_URL:'https://automation.example.com/dupla'});
 try{
  const [a]=await initialize();const p=await call('/api/projects','POST',{space:'work',title:'Reintentos verificables'},a);assert.equal(p.status,201);
  let outcome=await app.flushWebhookQueue();assert.equal(outcome.failed,1);
  const row=db.prepare('SELECT * FROM webhook_outbox').get();assert.equal(row.status,'failed');
  await app.flushWebhookQueue();assert.equal(calls,1,'Error permanente no se vuelve a enviar');
  remoteCode=503;const task=await call('/api/projects/'+p.data.project.id+'/tasks','POST',{title:'Nuevo evento'},a);assert.equal(task.status,201);
  outcome=await app.flushWebhookQueue();assert.equal(outcome.failed,1);
  const failed=db.prepare("SELECT status,attempts FROM webhook_outbox WHERE status='pending'").get();assert.equal(failed.attempts,1);
  const retry=await call('/api/integrations/retry','POST',{},a);assert.equal(retry.status,200);
  assert.equal(retry.data.pending,1);
  assert.equal(calls,2,'respeta el backoff y no reintenta de inmediato');
 }finally{globalThis.fetch=previous;db.close();}
});

test('WEBHOOK OUTBOX: rechaza URL local, no crea pendientes y no expone secretos',async()=>{
 const {db,call,initialize}=fixture({WORK_WEBHOOK_URL:'http://127.0.0.1/secret'});
 try{const [a]=await initialize();const project=await call('/api/projects','POST',{space:'work',title:'Evento sin salida'},a);assert.equal(project.status,201);assert.equal(db.prepare('SELECT COUNT(*) n FROM webhook_outbox').get().n,0);}
 finally{db.close();}
});

test('WEBHOOK OUTBOX: pendiente persiste al cerrar y reabrir SQLite; restaurar borra entregas obsoletas',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dupla-webhook-')),filename=join(folder,'store.sqlite');
 const env={WORK_WEBHOOK_URL:'https://automation.example.com/dupla'};
 const original=globalThis.fetch;let delivered=[];
 globalThis.fetch=async(url,options)=>{delivered.push(options.headers['Idempotency-Key']);return new Response('',{status:200});};
 try{
  let h=fixture(env,filename);const [a,b]=await h.initialize();
  // Snapshot before the work event. Restoring this must not replay the event.
  const snapshot=await h.call('/api/snapshot','GET',undefined,a);assert.equal(snapshot.status,200);
  const p=await h.call('/api/projects','POST',{space:'work',title:'Pendiente de nube'},a);assert.equal(p.status,201);
  let pending=h.db.prepare('SELECT * FROM webhook_outbox').get();assert.equal(pending.status,'pending');
  h.db.close();h=fixture(env,filename);
  assert.equal(h.db.prepare('SELECT id FROM webhook_outbox').get().id,pending.id,'La cola se guarda en el archivo SQLite');
  assert.equal((await h.app.flushWebhookQueue()).sent,1);
  assert.deepEqual(delivered,[pending.id]);
  // A second queued event should vanish after restoring the earlier snapshot.
  await h.call('/api/projects','POST',{space:'work',title:'No reenviar tras restaurar'},b);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM webhook_outbox').get().n,2);
  const restored=await h.call('/api/snapshot/restore','POST',{confirmation:'RESTAURAR DUPLA',password:'clave-super-a-1234',snapshot:snapshot.data},a);
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM webhook_outbox').get().n,0);
  assert.equal((await h.app.flushWebhookQueue()).sent,0);
  h.db.close();
 }finally{globalThis.fetch=original;rmSync(folder,{recursive:true,force:true});}
});
