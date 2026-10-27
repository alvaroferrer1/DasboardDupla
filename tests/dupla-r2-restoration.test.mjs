import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const meta=new Map(),bucket=new Map();
 const BACKUP_BUCKET={
  async put(key,text,props={}){bucket.set(key,{text,props})},
  async get(key){const item=bucket.get(key);return item?{size:Buffer.byteLength(item.text),customMetadata:item.props.customMetadata||{},async text(){return item.text},async arrayBuffer(){return Buffer.from(item.text)}}:null},
  async head(key){const item=bucket.get(key);return item?{size:Buffer.byteLength(item.text)}:null},
  async list(){return {objects:[...bucket].map(([key,v])=>({key,size:Buffer.byteLength(v.text)}))}} 
 };
 const storage={
  async get(k){return meta.get(k)??null},async put(k,v){meta.set(k,v)},
  sql:{exec(sql,...args){
   if(!args.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0}}
   const stmt=db.prepare(sql);const isRead=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
   const rows=isRead?stmt.all(...args):[];
   return {toArray:()=>rows,rowsWritten:isRead?0:stmt.run(...args).changes};
  }},
  transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(ex){db.exec('ROLLBACK');throw ex;}}
 };
 const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64),BACKUP_BUCKET},{getWebSockets:()=>[],waitUntil(){}});
 async function call(path,method='GET',body,cookie){
  const headers={origin:'https://dupla.test',host:'dupla.test',...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})};
  const req={method,headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body))}};
  let resolve,status=200;const promise=new Promise(r=>resolve=r);const responseHeaders=new Headers();
  const res={headersSent:false,writableEnded:false,writeHead(n,hs={}){status=n;this.headersSent=true;for(const [k,v]of Object.entries(hs))responseHeaders.set(k,v)},end(payload){this.writableEnded=true;resolve(new Response(payload??null,{status,headers:responseHeaders}))}};
  try{await app.api(req,res,new URL('https://dupla.test'+path));}catch(ex){if(!res.headersSent)res.writeHead(ex.status||500);res.end(JSON.stringify({error:ex.status?ex.message:String(ex)}));}
  const response=await promise;let data;try{data=await response.json()}catch{}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
 }
 async function login(){
  assert.equal((await call('/api/initialize','POST',{setup_token:'A'.repeat(64),email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'password-one-12456',password_b:'password-two-12456'})).status,201);
  const a=await call('/api/login','POST',{email:'a@dupla.test',password:'password-one-12456'});
  const b=await call('/api/login','POST',{email:'b@dupla.test',password:'password-two-12456'});
  assert.equal(a.status,200);assert.equal(b.status,200);
  return [a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,bucket,call,login,app};
}

test('DUPLA: copia R2 con checksum, verificación, autorización y restauración transaccional entre dos cuentas',async()=>{
 const {db,bucket,call,login}=fixture();try{
  const [a,b]=await login();
  assert.equal((await call('/api/backups/run','POST',{})).status,401);
  const p=await call('/api/projects','POST',{space:'work',title:'Proyecto protegido R2'},a);
  assert.equal(p.status,201);const projectId=p.data.project.id;
  const note=await call(`/api/projects/${projectId}/sections`,'POST',{title:'Información',content:'Contenido antes del backup'},b);
  assert.equal(note.status,201);
  const first=await call('/api/backups/run','POST',{},a);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.created,true);
  const second=await call('/api/backups/run','POST',{},b);
  assert.equal(second.status,200);assert.equal(second.data.created,false,'No debe duplicar la copia del mismo día');
  const date=first.data.key.split('/').at(-1).replace('.json','');
  const verify=await call('/api/backups/verify?date='+date,'GET',undefined,b);
  assert.equal(verify.status,200,JSON.stringify(verify.data));assert.equal(verify.data.projects,1);assert.equal(verify.data.accounts,2);assert.equal(verify.data.restorable,true);
  assert.equal((await call('/api/backups/restore','POST',{date,password:'password-one-12456',confirmation:'RESTAURAR DUPLA'})).status,401);
  assert.equal((await call('/api/backups/restore','POST',{date,password:'incorrect',confirmation:'RESTAURAR DUPLA'},a)).status,403);
  assert.equal((await call('/api/backups/restore','POST',{date,password:'password-one-12456',confirmation:'no'},a)).status,400);
  assert.equal((await call(`/api/projects/${projectId}`,'DELETE',undefined,a)).status,200);
  assert.equal((await call(`/api/projects/${projectId}`,'GET',undefined,b)).status,404);
  const restored=await call('/api/backups/restore','POST',{date,password:'password-two-12456',confirmation:'RESTAURAR DUPLA'},b);
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  const restoredP=await call(`/api/projects/${projectId}`,'GET',undefined,a);
  assert.equal(restoredP.status,200);assert.equal(restoredP.data.project.sections[0].content,'Contenido antes del backup');
  const remote=bucket.get(first.data.key);remote.text=remote.text.replace('Contenido antes del backup','Contenido ALTERADO');
  assert.equal((await call('/api/backups/verify?date='+date,'GET',undefined,a)).status,409);
  assert.equal((await call('/api/backups/restore','POST',{date,password:'password-one-12456',confirmation:'RESTAURAR DUPLA'},a)).status,409);
  assert.equal((await call(`/api/projects/${projectId}`,'GET',undefined,b)).status,200,'Copia alterada no debe tocar los datos');
 }finally{db.close()}
});

test('DUPLA: copia externa con más de 6 MiB de archivos se puede recuperar mediante R2',async()=>{
 const {db,call,login}=fixture();try{
  const [a,b]=await login();
  const project=await call('/api/projects','POST',{space:'couple',title:'Archivos voluminosos'},a);assert.equal(project.status,201);
  const id=project.data.project.id;
  for(let i=0;i<2;i++){
   const content=Buffer.alloc(3_400_000,i===0?65:66);
   const upload=await call(`/api/projects/${id}/assets`,'POST',{name:'archivo'+i+'.bin',mime:'application/octet-stream',base64:content.toString('base64')},a);
   assert.equal(upload.status,201,JSON.stringify(upload.data));
  }
  const backup=await call('/api/backups/run','POST',{},a);
  assert.equal(backup.status,200,JSON.stringify(backup.data));
  const date=backup.data.key.split('/').at(-1).replace('.json','');
  const verified=await call('/api/backups/verify?date='+date,'GET',undefined,b);assert.equal(verified.status,200,JSON.stringify(verified.data));assert.equal(verified.data.files,2);
  assert.equal((await call('/api/projects/'+id,'DELETE',undefined,a)).status,200);
  const restored=await call('/api/backups/restore','POST',{date,password:'password-one-12456',confirmation:'RESTAURAR DUPLA'},a);
  assert.equal(restored.status,200,JSON.stringify(restored.data));assert.equal(restored.data.restored_files,2);
  const saved=await call('/api/projects/'+id,'GET',undefined,b);
  assert.equal(saved.status,200);assert.equal(saved.data.project.assets.length,2);
  assert.equal(saved.data.project.assets.reduce((n,x)=>n+x.size,0),6_800_000);
 }finally{db.close()}
});

test('DUPLA: Director General ejecuta supervisión preventiva en Trabajo sin alertar por Planes',async()=>{
 const {db,call,login,app}=fixture();try{
  const [a,b]=await login();
  const work=await call('/api/projects','POST',{space:'work',title:'Trabajo con proyecto vacío'},a);
  const couple=await call('/api/projects','POST',{space:'couple',title:'Viaje con proyecto vacío'},a);
  assert.equal(work.status,201);assert.equal(couple.status,201);
  const first=app.processGuardianReview();assert.equal(first.reviewed_projects,1);assert.equal(first.notices,2);
  const repeated=app.processGuardianReview();assert.equal(repeated.notices,0,'Una sola notificación diaria de cada incidencia');
  const n=await call('/api/notifications','GET',undefined,b);assert.equal(n.status,200);assert(n.data.items.some(x=>x.detail.includes('Proyecto activo sin tareas')));
  assert(n.data.items.filter(x=>x.action==='Director General: revisión preventiva').every(x=>x.space==='work'),'El Director General no accede a planes privados');
 }finally{db.close()}
});

test('DUPLA 5.6: R2 segmentado supera 18 MiB, valida cada adjunto y restaura ambos usuarios sin pérdida',async()=>{
 const {db,bucket,call,login}=fixture();
 try{
  const [a,b]=await login();
  const created=await call('/api/projects','POST',{space:'work',title:'Copia R2 segmentada de 19 MiB'},a);
  assert.equal(created.status,201);
  const id=created.data.project.id;
  for(let i=0;i<6;i++){
   const content=Buffer.alloc(3_250_000,65+i);
   const upload=await call(`/api/projects/${id}/assets`,'POST',{name:'prueba-'+i+'.bin',mime:'application/octet-stream',base64:content.toString('base64')},a);
   assert.equal(upload.status,201,JSON.stringify(upload.data));
  }
  const backup=await call('/api/backups/run','POST',{},a);
  assert.equal(backup.status,200,JSON.stringify(backup.data));
  assert.equal(backup.data.format,'dos-espacios-edge-v2');
  const date=backup.data.key.split('/').at(-1).replace('.json','');
  assert.equal(bucket.size,7,'Seis objetos de archivo privados y un manifiesto al final');
  const manifest=JSON.parse(bucket.get(backup.data.key).text);
  assert.equal(manifest.format,'dos-espacios-edge-v2');
  assert.equal(manifest.files.length,6);
  const verified=await call('/api/backups/verify?date='+date,'GET',undefined,b);
  assert.equal(verified.status,200,JSON.stringify(verified.data));
  assert.equal(verified.data.restorable,true);
  assert.equal(verified.data.files,6);
  const tamper=bucket.get(manifest.files[0].key);
  const original=tamper.text;
  tamper.text=Buffer.alloc(original.length,90);
  const corrupted=await call('/api/backups/verify?date='+date,'GET',undefined,b);
  assert.equal(corrupted.status,409,'Un adjunto cambiado debe invalidar la copia, no solo el manifiesto');
  assert.equal((await call('/api/backups/restore','POST',{date,password:'password-one-12456',confirmation:'RESTAURAR DUPLA'},a)).status,409);
  tamper.text=original;
  assert.equal((await call('/api/projects/'+id,'DELETE',undefined,a)).status,200);
  assert.equal((await call('/api/projects/'+id,'GET',undefined,b)).status,404);
  const restored=await call('/api/backups/restore','POST',{date,password:'password-two-12456',confirmation:'RESTAURAR DUPLA'},b);
  assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.equal(restored.data.restored_files,6);
  const present=await call('/api/projects/'+id,'GET',undefined,a);
  assert.equal(present.status,200);assert.equal(present.data.project.assets.length,6);
  assert.equal(present.data.project.assets.reduce((sum,f)=>sum+f.size,0),19_500_000);
  const downloadable=await call('/api/backups/download?date='+date,'GET',undefined,b);
  assert.equal(downloadable.status,200);
 }finally{db.close()}
});
