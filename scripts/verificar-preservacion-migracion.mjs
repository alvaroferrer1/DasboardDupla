// Verifies migration 5.5 -> 5.6 against an *isolated* durable SQLite file.
// It never reads real users, passwords, secrets, or Cloudflare resources.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApi as upgraded} from '../edge/api.mjs';
const oldPath=process.env.DUPLA_OLD_API;
if(!oldPath)throw Error('DUPLA_OLD_API debe apuntar a la versión 5.5 local extraída (no producción)');
const {createApi:previous}=await import(oldPath);
const folder=mkdtempSync(join(tmpdir(),'dupla-migrate-'));
const dbFile=join(folder,'persistent.sqlite');
const env={SETUP_TOKEN:'Z'.repeat(64),DEV_MODE:'true'};
function adapter(version){
 const sqlite=new DatabaseSync(dbFile);sqlite.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(sql,...params){if(!params.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){sqlite.exec(sql);return {toArray:()=>[],rowsWritten:0};}const stmt=sqlite.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);return {toArray:()=>reader?stmt.all(...params):[],rowsWritten:reader?0:stmt.run(...params).changes};}},transactionSync(fn){sqlite.exec('BEGIN');try{const res=fn();sqlite.exec('COMMIT');return res;}catch(err){sqlite.exec('ROLLBACK');throw err;}}};
 const app=version(storage,env,{getWebSockets:()=>[]});
 async function request(path,method='GET',data,cookie){
  let done,status=200,headers={};const ready=new Promise(r=>done=r);
  const req={method,headers:{origin:'https://migration.test',host:'migration.test',...(cookie?{cookie}:{}),...(data!==undefined?{'content-type':'application/json'}:{})},socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(data!==undefined)yield Buffer.from(JSON.stringify(data));}};
  const res={headersSent:false,writableEnded:false,writeHead(n,h={}){status=n;headers=h;this.headersSent=true;},end(raw){this.writableEnded=true;let parsed;try{parsed=JSON.parse(raw)}catch{parsed=null};done({status,body:parsed,cookie:headers['Set-Cookie']?.split(';')[0]})}};
  try{await app.api(req,res,new URL('https://migration.test'+path));}catch(e){res.writeHead(e.status||500);res.end(JSON.stringify({error:e.message}));}
  return await ready;
 }
 return {request,sqlite,close:()=>sqlite.close()};
}
let created,projectId,bytes;
try{
 let old=adapter(previous);const call=old.request;
 const init=await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'ensayoA@invalid.test',email_b:'ensayoB@invalid.test',password_a:'AntiguaClave-A-2026',password_b:'AntiguaClave-B-2026'});assert.equal(init.status,201,JSON.stringify(init.body));
 const a=await call('/api/login','POST',{email:'ensayoA@invalid.test',password:'AntiguaClave-A-2026'});
 const b=await call('/api/login','POST',{email:'ensayoB@invalid.test',password:'AntiguaClave-B-2026'});
 assert.equal(a.status,200);assert.equal(b.status,200);
 const p=await call('/api/projects','POST',{space:'couple',title:'Viaje compartido a conservar'},a.cookie);assert.equal(p.status,201,JSON.stringify(p.body));projectId=p.body.project.id;
 const t=await call(`/api/projects/${projectId}/tasks`,'POST',{title:'Comprar billetes'},b.cookie);assert.equal(t.status,201);
 bytes=randomBytes(65536);
 const file=await call(`/api/projects/${projectId}/assets`,'POST',{name:'contenido-original.bin',mime:'application/octet-stream',base64:bytes.toString('base64')},a.cookie);assert.equal(file.status,201,JSON.stringify(file.body));
 const baseline={users:old.sqlite.prepare('SELECT id,email,password_hash FROM users ORDER BY email').all(),sessions:old.sqlite.prepare('SELECT token_hash,user_id,expires_at FROM sessions ORDER BY token_hash').all(),projects:old.sqlite.prepare('SELECT id,title,space FROM projects ORDER BY id').all(),files:old.sqlite.prepare('SELECT id,name,size,stored_name FROM assets ORDER BY id').all(),chunks:old.sqlite.prepare('SELECT name,seq,data FROM upload_chunks ORDER BY name,seq').all()};
 assert.equal(baseline.users.length,2);assert.equal(baseline.sessions.length,2);
 old.close();
 let updated=adapter(upgraded);
 const same=(query)=>updated.sqlite.prepare(query).all();
 assert.deepEqual(same('SELECT id,email,password_hash FROM users ORDER BY email'),baseline.users,'IDs/correos/hashes');
 assert.deepEqual(same('SELECT token_hash,user_id,expires_at FROM sessions ORDER BY token_hash'),baseline.sessions,'sesiones antiguas');
 assert.deepEqual(same('SELECT id,title,space FROM projects ORDER BY id'),baseline.projects,'proyectos antiguos');
 assert.deepEqual(same('SELECT id,name,size,stored_name FROM assets ORDER BY id'),baseline.files,'adjuntos antiguos');
 assert.deepEqual(same('SELECT name,seq,data FROM upload_chunks ORDER BY name,seq'),baseline.chunks,'bytes de adjuntos originales');
 console.log('PASS: migración no cambia correos, hashes, IDs, sesiones, proyectos ni adjuntos');
 assert.equal((await updated.request('/api/me','GET',undefined,a.cookie)).body.user.email,'ensayoa@invalid.test');
 assert.equal((await updated.request('/api/me','GET',undefined,b.cookie)).body.user.email,'ensayob@invalid.test');
 assert.equal((await updated.request('/api/login','POST',{email:'ensayoA@invalid.test',password:'AntiguaClave-A-2026'})).status,200);
 assert.equal((await updated.request('/api/login','POST',{email:'ensayoB@invalid.test',password:'AntiguaClave-B-2026'})).status,200);
 assert.equal((await updated.request('/api/initialize','POST',{setup_token:env.SETUP_TOKEN})).status,409);
 const read=await updated.request(`/api/projects/${projectId}`,'GET',undefined,b.cookie);assert.equal(read.status,200);assert.equal(read.body.project.tasks[0].title,'Comprar billetes');assert.equal(read.body.project.assets[0].size,bytes.length);
 console.log('PASS: las dos contraseñas y sesiones anteriores siguen funcionando; creación de cuentas cerrada');
 updated.close();
 updated=adapter(upgraded);
 assert.equal((await updated.request(`/api/projects/${projectId}`,'GET',undefined,a.cookie)).status,200);
 const dataRows=updated.sqlite.prepare('SELECT name,seq,data FROM upload_chunks ORDER BY name,seq').all();assert.deepEqual(Buffer.concat(dataRows.map(x=>Buffer.from(x.data))),bytes);
 updated.close();console.log('PASS: segundo reinicio conserva la base y archivos intactos');
}finally{rmSync(folder,{recursive:true,force:true});}
