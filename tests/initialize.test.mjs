import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const pwdA='Fresh_Alvaro_2026_Password!';
const pwdB='Fresh_Angie_2026_Password!';
const secret='super-secret-token-created-in-hosting-panel-32chars';
const tmp=mkdtempSync(join(tmpdir(),'dos-web-setup-'));
const port=34000+Math.floor(Math.random()*2000);
const BASE=`http://127.0.0.1:${port}`;
const env={...process.env,DOS_DATA_DIR:tmp,SETUP_TOKEN:secret,COOKIE_SECURE:'false',RAILWAY_ENVIRONMENT:'',HOST:'127.0.0.1',PORT:String(port)};
const server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env,stdio:'ignore'});
async function req(path,method='GET',body){const r=await fetch(BASE+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return [r,await r.json()];}
await test('Primera configuración web protegida y compartición entre ambos',async t=>{
 try{
  let live=false;
  for(let i=0;i<70;i++){try{const [r]=await req('/api/health');if(r.ok){live=true;break;}}catch{}await new Promise(r=>setTimeout(r,60));}
  assert.ok(live,'El servidor debe arrancar');
  await t.test('Web detecta sin usuarios y asistente disponible',async()=>{
   const [r,data]=await req('/api/me');assert.equal(r.status,200);assert.equal(data.configured,false);assert.equal(data.setupAvailable,true);
  });
  const payload={setup_token:secret,email_a:'a@example.invalid',password_a:pwdA,email_b:'b@example.invalid',password_b:pwdB};
  await t.test('No se permite crear usuarios con clave incorrecta ni duplicados',async()=>{
   assert.equal((await req('/api/initialize','POST',{...payload,setup_token:'wrong'}))[0].status,403);
   assert.equal((await req('/api/initialize','POST',{...payload,email_b:'a@example.invalid'}))[0].status,400);
   assert.equal((await req('/api/initialize','POST',{...payload,password_b:pwdA}))[0].status,400);
   assert.equal((await req('/api/me'))[1].configured,false);
  });
  await t.test('Alta real de exactamente dos cuentas y cierre definitivo de alta',async()=>{
   const [r]=await req('/api/initialize','POST',payload);assert.equal(r.status,201);
   assert.equal((await req('/api/me'))[1].configured,true);
   assert.equal((await req('/api/me'))[1].setupAvailable,false);
   assert.equal((await req('/api/initialize','POST',payload))[0].status,409);
  });
  await t.test('Ambas cuentas inician sesión, comparten proyectos y persisten',async()=>{
   const a=await req('/api/login','POST',{email:payload.email_a,password:pwdA});assert.equal(a[0].status,200);assert.equal(a[1].user.name,'Álvaro');
   const cookieA=a[0].headers.get('set-cookie').split(';')[0];
   const b=await req('/api/login','POST',{email:payload.email_b,password:pwdB});assert.equal(b[0].status,200);assert.equal(b[1].user.name,'Angie');
   const cookieB=b[0].headers.get('set-cookie').split(';')[0];
   assert.notEqual(cookieA,cookieB);
   const created=await fetch(BASE+'/api/projects',{method:'POST',headers:{cookie:cookieA,'Content-Type':'application/json'},body:JSON.stringify({space:'couple',title:'Primer viaje conjunto'})});assert.equal(created.status,201);
   const view=await fetch(BASE+'/api/dashboard',{headers:{cookie:cookieB}});assert.equal(view.status,200);
   const data=await view.json();assert.equal(data.projects.some(x=>x.title==='Primer viaje conjunto'),true);
  });
  await t.test('Solicitud de otro origen se rechaza',async()=>{
   const [r]=await (async()=>{const x=await fetch(BASE+'/api/initialize',{method:'POST',headers:{Origin:'https://otro-sitio.example','Content-Type':'application/json'},body:JSON.stringify(payload)});return [x]})();assert.equal(r.status,403);
  });
 }finally{server.kill('SIGTERM');}
});
try{rmSync(tmp,{recursive:true,force:true});}catch{}
