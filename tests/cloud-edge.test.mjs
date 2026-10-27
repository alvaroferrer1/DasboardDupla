import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createApi } from '../edge/api.mjs';

// High-fidelity local adapter for Cloudflare's synchronous SQL Durable Object API.
// This does NOT replace the final smoke test against a real deployed Worker.
const withSql = () => {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const sql={exec(sql,...bindings){
  if(!bindings.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?stmt.all(...bindings):[];
  const changes=reader?0:stmt.run(...bindings).changes;
  return {toArray:()=>rows,rowsWritten:changes};
 }};
 return {sql,transactionSync(f){db.exec('BEGIN');try{const result=f();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
};
function mockNode(request){
 let delivered=false;
 return {method:request.method,url:new URL(request.url).pathname,headers:Object.fromEntries(request.headers.entries()),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(delivered)return;delivered=true;const buf=await request.arrayBuffer();if(buf.byteLength)yield Buffer.from(buf);}};
}
function mockResponse(){let done,code=200,h=new Headers();const promise=new Promise(r=>done=r);const res={writableEnded:false,headersSent:false,writeHead(status,headers={}){code=status;this.headersSent=true;for(const[k,v]of Object.entries(headers))h.set(k,v);},end(payload){if(this.writableEnded)return;this.writableEnded=true;done(new Response(payload??null,{status:code,headers:h}));}};return {res,promise};}

test('Cloud Durable Object core preserves both-user CRUD, privacy, events, files, knowledge and decisions',async()=>{
 const storage=withSql();const env={SETUP_TOKEN:'Q'.repeat(48)};const notifications=[];const sockets=[];const app=createApi(storage,env,{getWebSockets:()=>sockets});
 async function call(path,method='GET',body,cookie){
  const h=new Headers({origin:'https://dos.example.test',host:'dos.example.test'});if(cookie)h.set('cookie',cookie);if(body!==undefined)h.set('content-type','application/json');
  const req=new Request('https://dos.example.test'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const output=mockResponse();try{await app.api(mockNode(req),output.res,new URL(req.url));}catch(e){if(!output.res.headersSent)output.res.writeHead(e.status||500,{'content-type':'application/json'});output.res.end(JSON.stringify({error:e.message}));}
  const response=await output.promise;let data;try{data=await response.clone().json();}catch{}return {status:response.status,data,cookie:response.headers.get('set-cookie'),body:response};
 }
 try{
  assert.equal((await call('/api/me')).data.configured,false);
  assert.equal((await call('/api/projects','POST',{space:'work',title:'bloqueado'})).status,401);
  assert.equal((await call('/api/initialize','POST',{setup_token:'wrong'})).status,403);
  assert.equal((await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'a@test.example',email_b:'b@test.example',password_a:'UnPasswordSeguro_1234',password_b:'OtroPasswordSeguro_5678'})).status,201);
  assert.equal((await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN})).status,409);
  const A=await call('/api/login','POST',{email:'a@test.example',password:'UnPasswordSeguro_1234'});
  const B=await call('/api/login','POST',{email:'b@test.example',password:'OtroPasswordSeguro_5678'});
  assert.equal(A.status,200);assert.equal(B.status,200);
  assert.match(A.cookie,/Secure/);
  const cookieA=A.cookie.split(';')[0],cookieB=B.cookie.split(';')[0];
  let socketClosed=false;const hashB=createHash('sha256').update(cookieB.split('=')[1]).digest('hex');
  sockets.push({deserializeAttachment(){return {sessionHash:hashB}},send(x){notifications.push(JSON.parse(x))},close(){socketClosed=true}});
  const created=await call('/api/projects','POST',{space:'work',title:'Web conjunta',template:'website'},cookieA);
  assert.equal(created.status,201,JSON.stringify(created.data));const pid=created.data.project.id;
  const d=await call('/api/dashboard','GET',undefined,cookieB);assert(d.data.projects.some(p=>p.id===pid));
  const detail=await call('/api/projects/'+pid,'GET',undefined,cookieB);
  assert(detail.data.project.tasks.length>=1);
  const knowledge=await call('/api/knowledge','POST',{space:'work',project_id:pid,title:'Decisión UX',answer:'Usamos tarjetas para tareas.'},cookieB);
  assert.equal(knowledge.status,201,JSON.stringify(knowledge.data));
  assert((await call('/api/knowledge','GET',undefined,cookieA)).data.entries.some(x=>x.title==='Decisión UX'));
  assert.equal((await call('/api/knowledge','GET')).status,401);
  const analytics=await call('/api/analytics','GET',undefined,cookieA);assert(analytics.data.totals.projects>=1);
  const file=Buffer.from('Contenido compartido para Angie y Álvaro');
  const asset=await call('/api/projects/'+pid+'/assets','POST',{name:'documento.txt',mime:'text/plain',base64:file.toString('base64')},cookieA);
  assert.equal(asset.status,201,JSON.stringify(asset.data));
  const project=await call('/api/projects/'+pid,'GET',undefined,cookieB);
  assert(project.data.project.assets.length===1);
  const download=await call('/api/assets/'+project.data.project.assets[0].id,'GET',undefined,cookieB);
  assert.equal(download.status,200);assert.equal(await download.body.text(),file.toString());
  assert(notifications.some(x=>x.projectId===pid));
  const plans=await call('/api/projects','POST',{space:'couple',title:'Nuestro próximo viaje',template:'trip'},cookieB);
  assert.equal(plans.status,201);const planId=plans.data.project.id;
  const both=(await call('/api/dashboard','GET',undefined,cookieA)).data.projects;
  assert(both.some(p=>p.id===pid&&p.space==='work'));assert(both.some(p=>p.id===planId&&p.space==='couple'));
  assert.equal((await call(`/api/projects/${planId}/ai`,'POST',{prompt:'planificar'},cookieB)).status,403);
  const task=detail.data.project.tasks[0];
  const changed=await call('/api/tasks/'+task.id,'PATCH',{revision:task.revision,title:'Nueva tarea compartida'},cookieB);
  assert.equal(changed.status,200,JSON.stringify(changed.data));
  const conflict=await call('/api/tasks/'+task.id,'PATCH',{revision:task.revision,title:'Edición vieja'},cookieA);
  assert.equal(conflict.status,409);
  const comment=await call(`/api/projects/${pid}/comments`,'POST',{content:'Mensaje de Angie'},cookieB);
  assert.equal(comment.status,201);
  const vote=await call(`/api/projects/${pid}/decisions`,'POST',{title:'¿Publicamos?',choices:['Sí','Aún no']},cookieA);
  assert.equal(vote.status,201);
  assert.equal((await call(`/api/decisions/${vote.data.item.id}/vote`,'POST',{choice_index:1},cookieB)).status,200);
  const event=await call(`/api/projects/${planId}/events`,'POST',{title:'Salida',event_date:'2026-12-10'},cookieA);
  assert.equal(event.status,201);
  assert.equal((await call('/api/calendar.ics','GET',undefined,cookieB)).status,200);
  const notes=detail.data.project.sections[0];
  const edited=await call(`/api/sections/${notes.id}`,'PATCH',{revision:notes.revision,content:'Nota nueva de Angie'},cookieB);
  assert.equal(edited.status,200,JSON.stringify(edited.data));
  const history=await call(`/api/sections/${notes.id}/versions`,'GET',undefined,cookieA);
  assert(history.data.versions.length>=1);
  const alerts=await call('/api/notifications','GET',undefined,cookieA);
  assert(alerts.data.unread>0);
  assert.equal((await call('/api/notifications/read','POST',{},cookieA)).status,200);
  assert.equal((await call('/api/notifications','GET',undefined,cookieA)).data.unread,0);
  const snapshot=await call('/api/snapshot','GET',undefined,cookieA);
  assert.equal(snapshot.status,200,JSON.stringify(snapshot.data));
  assert(snapshot.data.files.some(f=>f.base64===file.toString('base64')));
  assert(!JSON.stringify(snapshot.data).includes('password_hash'));
  assert(!JSON.stringify(snapshot.data).includes('token_hash'));
  const arch=await call(`/api/projects/${planId}`,'PATCH',{revision:plans.data.project.revision,archived:true},cookieB);
  assert.equal(arch.status,200);
  assert((await call('/api/archives','GET',undefined,cookieA)).data.projects.some(x=>x.id===planId));
  assert.equal((await call(`/api/projects/${planId}`,'DELETE',undefined,cookieA)).status,200);
  assert((await call('/api/trash','GET',undefined,cookieB)).data.projects.some(x=>x.id===planId));
  assert.equal((await call(`/api/trash/${planId}/restore`,'POST',{},cookieA)).status,200);
  assert.equal((await call(`/api/projects/${planId}`,'GET',undefined,cookieB)).status,200);
  const big=Buffer.alloc(430000,73);
  const upload2=await call(`/api/projects/${pid}/assets`,'POST',{name:'grande.txt',mime:'text/plain',base64:big.toString('base64')},cookieA);
  assert.equal(upload2.status,201,JSON.stringify(upload2.data));
  const assets2=(await call(`/api/projects/${pid}`,'GET',undefined,cookieB)).data.project.assets;
  const bigname=assets2.find(x=>x.name==='grande.txt');
  assert(bigname);
  const result=await call(`/api/assets/${bigname.id}`,'GET',undefined,cookieB);
  assert.equal(result.status,200);assert.deepEqual(Buffer.from(await result.body.arrayBuffer()),big);
  const malicious=await call(`/api/projects/${pid}/assets`,'POST',{name:'engaño.png',mime:'image/png',base64:Buffer.from('<script>alert(1)</script>').toString('base64')},cookieA);
  assert.equal(malicious.status,415,'No se debe aceptar HTML suplantando una imagen');
  assert.equal((await call('/api/logout','POST',{},cookieB)).status,200);
  const n=notifications.length;
  assert.equal((await call(`/api/projects/${pid}/comments`,'POST',{content:'La sesión caducada no recibe el evento'},cookieA)).status,201);
  assert.equal(notifications.length,n); assert.equal(socketClosed,true);

 }finally{storage.close();}
});
