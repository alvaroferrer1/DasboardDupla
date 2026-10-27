import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(query,...bindings){
  if(!bindings.length&&/;\s*\S/.test(query.trim().replace(/;\s*$/,''))){sqlite.exec(query);return {toArray:()=>[],rowsWritten:0};}
  const st=sqlite.prepare(query),reading=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(query);
  return {toArray:()=>reading?st.all(...bindings):[],rowsWritten:reading?0:st.run(...bindings).changes};
 }},transactionSync(fn){sqlite.exec('BEGIN');try{const v=fn();sqlite.exec('COMMIT');return v;}catch(err){sqlite.exec('ROLLBACK');throw err;}}};
 const app=createApi(storage,{SETUP_TOKEN:'P'.repeat(64)},{getWebSockets:()=>[]});
 async function call(path,method='GET',data,cookie){
  let fulfill;const promise=new Promise(r=>fulfill=r),headers={'origin':'https://dupla.test','host':'dupla.test',...(data!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{})};
  const req={method,headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(data!==undefined)yield Buffer.from(JSON.stringify(data));}};
  let status=200,respondedHeaders={};const res={headersSent:false,writableEnded:false,writeHead(n,h={}){status=n;respondedHeaders=h;this.headersSent=true;},end(text){this.writableEnded=true;fulfill({status,data:JSON.parse(text||'{}'),headers:respondedHeaders});}};
  try{await app.api(req,res,new URL('https://dupla.test'+path));}catch(err){res.writeHead(err.status||500);res.end(JSON.stringify({error:err.status?err.message:'Error interno'}));}
  return promise;
 }
 return {sqlite,call};
}
test('Crear proyecto en blanco y con plantilla: escritura atómica, dos cuentas, reintentos idempotentes',async()=>{
 const {sqlite,call}=fixture();try{
  const setup=await call('/api/initialize','POST',{setup_token:'P'.repeat(64),email_a:'owner@dupla.test',password_a:'ClaveLarga_12345678',email_b:'angie@dupla.test',password_b:'ClaveLarga_87654321'});
  assert.equal(setup.status,201,JSON.stringify(setup.data));
  const auth=await call('/api/login','POST',{email:'owner@dupla.test',password:'ClaveLarga_12345678'});const cookie=auth.headers['Set-Cookie'].split(';')[0];
  const other=await call('/api/login','POST',{email:'angie@dupla.test',password:'ClaveLarga_87654321'});const otherCookie=other.headers['Set-Cookie'].split(';')[0];
  const key='cf3045fa-f687-4e37-96e4-f2103ac882f9';
  const invalid=await call('/api/projects','POST',{title:'No crear',space:'work',template:'trip',client_request_id:key},cookie);
  assert.equal(invalid.status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0,'No dejar proyectos huérfanos ante un error');
  const first=await call('/api/projects','POST',{title:'Proyecto móvil compartido',description:'Creado desde navegador',space:'work',template:'website',client_request_id:key},cookie);
  assert.equal(first.status,201,JSON.stringify(first.data));
  const again=await call('/api/projects','POST',{title:'Proyecto móvil compartido',space:'work',template:'website',client_request_id:key},cookie);
  assert.equal(again.status,200);assert.equal(again.data.already_created,true);assert.equal(again.data.project.id,first.data.project.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM projects').get().n,1);
  const project=await call('/api/projects/'+first.data.project.id,'GET',undefined,otherCookie);
  assert.equal(project.status,200);assert(project.data.project.tasks.length>=3);assert(project.data.project.sections.length>=3);
  const key2='a93f7d0e-5371-4298-a6dc-7e9f5641bdad';
  const couple=await call('/api/projects','POST',{title:'Plan en pareja',space:'couple',template:'blank',client_request_id:key2},otherCookie);
  assert.equal(couple.status,201);assert.equal((await call('/api/projects/'+couple.data.project.id,'GET',undefined,cookie)).status,200);
  const patch=await call('/api/projects/'+couple.data.project.id,'PATCH',{title:'Plan actualizado',revision:1},cookie);assert.equal(patch.status,200);
  const latest=await call('/api/projects/'+couple.data.project.id,'GET',undefined,otherCookie);assert.equal(latest.data.project.title,'Plan actualizado');
  const old=await call('/api/projects/'+couple.data.project.id,'PATCH',{title:'Cambio perdido',revision:1},otherCookie);assert.equal(old.status,409);
 }finally{sqlite.close();}
});
