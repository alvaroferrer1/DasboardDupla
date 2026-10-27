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

test('DUPLA 4.7: alta, dos cuentas, operaciones de proyecto, tareas masivas, diagnostico, sesiones y privacidad',async()=>{
 const storage=withSql();const env={SETUP_TOKEN:'X'.repeat(64)};const delivered=[];const sockets=[];
 const app=createApi(storage,env,{getWebSockets:()=>sockets,waitUntil(){}});
 async function call(path,method='GET',body,cookie){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test'});
  if(cookie)headers.set('cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const req=new Request('https://dupla.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const out=mockResponse();try{await app.api(mockNode(req),out.res,new URL(req.url));}catch(e){if(!out.res.headersSent)out.res.writeHead(e.status||500,{'content-type':'application/json'});out.res.end(JSON.stringify({error:e.message}));}
  const response=await out.promise;let data;try{data=await response.clone().json()}catch{};
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
 }
 try{
  assert.equal((await call('/api/system/status')).status,401,'Estado privado');
  assert.equal((await call('/api/sessions/revoke-others','POST',{})).status,401);
  const start=await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'alvaro@test.invalid',email_b:'angie@test.invalid',password_a:'ClaveUno_Larga_2026!',password_b:'ClaveDos_Larga_2026!'});
  assert.equal(start.status,201,JSON.stringify(start.data));
  const A=await call('/api/login','POST',{email:'alvaro@test.invalid',password:'ClaveUno_Larga_2026!'});
  const B=await call('/api/login','POST',{email:'angie@test.invalid',password:'ClaveDos_Larga_2026!'});
  assert.equal(A.status,200);assert.equal(B.status,200);
  const aCookie=A.cookie.split(';')[0],bCookie=B.cookie.split(';')[0];
  assert.equal((await call('/api/system/status','GET',undefined,aCookie)).data.users,2);
  const work=await call('/api/projects','POST',{title:'Trabajo real',space:'work',template:'app'},aCookie);
  const couple=await call('/api/projects','POST',{title:'Viaje conjunto',space:'couple',template:'trip'},bCookie);
  assert.equal(work.status,201);assert.equal(couple.status,201);
  const templatesToCheck=[['automation','work'],['ai_agent','work'],['freelance','work'],['weekend','couple'],['celebration','couple']];
  for(const [template,space] of templatesToCheck){
   const created=await call('/api/projects','POST',{title:'Plantilla '+template,space,template},aCookie);
   assert.equal(created.status,201,JSON.stringify(created.data));
   const d=await call('/api/projects/'+created.data.project.id,'GET',undefined,bCookie);
   assert(d.data.project.tasks.length>=3,'Plantilla '+template+' debe crear tareas reales');
   assert(d.data.project.sections.length>=3,'Plantilla '+template+' debe crear notas reales');
  }
  const pid=work.data.project.id,cid=couple.data.project.id;
  const batch=await call(`/api/projects/${pid}/tasks/manual-bulk`,'POST',{tasks:['Analizar requisitos','Diseñar UX','Programar app'],priority:'high',assigned_to:B.data.user.id,due_date:'2026-11-04'},aCookie);
  assert.equal(batch.status,201,JSON.stringify(batch.data));assert.equal(batch.data.created,3);
  const planBatch=await call(`/api/projects/${cid}/tasks/manual-bulk`,'POST',{tasks:['Comprar billetes','Preparar maleta'],priority:'normal'},bCookie);
  assert.equal(planBatch.status,201);
  const after=(await call('/api/projects/'+pid,'GET',undefined,bCookie)).data.project;
  assert(after.tasks.some(t=>t.title==='Diseñar UX'&&t.assigned_to===B.data.user.id));
  const beforeInvalid=after.tasks.length;
  assert.equal((await call(`/api/projects/${pid}/tasks/manual-bulk`,'POST',{tasks:['Repetida','repetida']},aCookie)).status,400);
  assert.equal((await call(`/api/projects/${pid}/tasks/manual-bulk`,'POST',{tasks:['Correcta','']},aCookie)).status,400);
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,bCookie)).data.project.tasks.length,beforeInvalid,'No guardar medio lote');
  const status=(await call('/api/system/status','GET',undefined,bCookie)).data;
  assert.equal(status.database,'available');assert.equal(status.projects,7);assert(status.tasks>=5);
  assert.equal(status.connected.ai,false);assert.equal(status.connected.webhook,false);
  assert(!JSON.stringify(status).includes(env.SETUP_TOKEN));
  const another=await call('/api/login','POST',{email:'alvaro@test.invalid',password:'ClaveUno_Larga_2026!'});
  const aCookie2=another.cookie.split(';')[0];
  assert.equal((await call('/api/me','GET',undefined,aCookie2)).data.user.email,'alvaro@test.invalid');
  const revoked=await call('/api/sessions/revoke-others','POST',{},aCookie);
  assert.equal(revoked.status,200);assert(revoked.data.revoked>=1);
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,aCookie2)).status,401,'Sesion cerrada');
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,aCookie)).status,200,'Sesion actual conservada');
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,bCookie)).status,200,'Otra persona NO pierde su sesion');
  assert.equal((await call('/api/system/status')).status,401);
  assert.equal((await call('/api/projects/'+pid+'/tasks/manual-bulk','POST',{tasks:['Falsa']})).status,401);
 }finally{storage.close()}
});
