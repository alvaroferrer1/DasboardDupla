import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const data=mkdtempSync(join(tmpdir(),'dos-publichost-'));
const PORT=34500+Math.floor(Math.random()*1000);const BASE=`http://127.0.0.1:${PORT}`;
const PUBLIC_ORIGIN='https://dos-test.example.ts.net';
const secret='secret-'+('0123456789abcdef'.repeat(4));
const env={...process.env,DOS_DATA_DIR:data,HOST:'127.0.0.1',PORT:String(PORT),COOKIE_SECURE:'true',PUBLIC_ORIGIN,SETUP_TOKEN:secret,RAILWAY_ENVIRONMENT:''};
const proc=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env,stdio:'ignore'});
async function request(url,opts={}){const r=await fetch(BASE+url,opts);return [r,await r.json()];}
await test('Seguridad de acceso gratuito mediante proxy HTTPS',async t=>{
 try {
  let healthy=false;for(let i=0;i<70;i++){try{const [r]=await request('/api/health');if(r.status===200){healthy=true;break}}catch{}await new Promise(ok=>setTimeout(ok,60))}
  assert.ok(healthy,'server start');
  const body={setup_token:secret,email_a:'a@example.invalid',password_a:'Secure_Alvaro_2026_AAA',email_b:'b@example.invalid',password_b:'Secure_Angie_2026_BBB'};
  const api=(route,origin,content=body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(content)});
  await t.test('Prohíbe otro origen incluso con token correcto',async()=>{assert.equal((await api('/api/initialize','https://phishing.example'))[0].status,403)});
  await t.test('Acepta origen HTTPS explícito aunque el proxy conecte a localhost',async()=>{assert.equal((await api('/api/initialize',PUBLIC_ORIGIN))[0].status,201)});
  let cookieA='',cookieB='';
  await t.test('Cookies de sesión HTTPS/HttpOnly/SameSite y cuentas distintas',async()=>{
   for(const [a,pass] of [['a','Secure_Alvaro_2026_AAA'],['b','Secure_Angie_2026_BBB']]){
    const [r]=await api('/api/login',PUBLIC_ORIGIN,{email:`${a}@example.invalid`,password:pass});assert.equal(r.status,200);
    const raw=r.headers.get('set-cookie');assert.match(raw,/Secure/);assert.match(raw,/HttpOnly/);assert.match(raw,/SameSite=Strict/);
    if(a==='a')cookieA=raw.split(';')[0];else cookieB=raw.split(';')[0];
   }
   assert.notEqual(cookieA,cookieB);
  });
  await t.test('Ambos pueden gestionar varios proyectos dentro de Trabajo y Planes',async()=>{
   const create=async(title,space,authCookie)=>{const [r,data]=await request('/api/projects',{method:'POST',headers:{Origin:PUBLIC_ORIGIN,'Content-Type':'application/json',Cookie:authCookie},body:JSON.stringify({title,space})});assert.equal(r.status,201);return data.project};
   const a=await create('Tienda online','work',cookieA);
   const b=await create('Campaña digital','work',cookieB);
   const c=await create('Viaje de invierno','couple',cookieA);
   const d=await create('Cenas por planificar','couple',cookieB);
   const [rs,dashboard]=await request('/api/dashboard',{headers:{Cookie:cookieB}});
   assert.equal(rs.status,200);
   for(const item of [a,b,c,d])assert.ok(dashboard.projects.some(p=>p.id===item.id));
   assert.equal(dashboard.projects.filter(p=>p.space==='work').length,2);
   assert.equal(dashboard.projects.filter(p=>p.space==='couple').length,2);
  });
  await t.test('Ruta de datos privados inaccesible sin cookie',async()=>{assert.equal((await request('/api/dashboard'))[0].status,401)});
 }finally{proc.kill('SIGTERM')}
});
try{rmSync(data,{recursive:true,force:true})}catch{}
