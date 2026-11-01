import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startReserva } from '../servidor-reserva.mjs';
import { createProxy } from '../firebase/functions/proxy.js';

const A='a0000000-0000-4000-8000-000000000001',B='b0000000-0000-4000-8000-000000000002',P='c0000000-0000-4000-8000-000000000003',F='d0000000-0000-4000-8000-000000000004';
const t0='2026-10-01T10:00:00.000Z';
const snapshot=(title='Viaje a Lisboa')=>({format:'dos-espacios-edge-v1',exported_at:t0,users:[{id:A,name:'Álvaro Prueba',email:'alvaro@reserva.test',created_at:t0},{id:B,name:'Angie Prueba',email:'angie@reserva.test',created_at:t0}],
 data:{projects:[{id:P,space:'couple',title,description:'',status:'planning',created_by:A,created_at:t0,updated_at:t0}],fin_groups:[{id:F,title:'Lisboa',icon:'plane',color:'#2f6fd8',created_by:A,created_at:t0,updated_at:t0}],
  fin_moves:[{id:'e0000000-0000-4000-8000-000000000005',kind:'out',amount:40,category:'comida',title:'Cena',date:'2026-10-02',paid_by:A,group_id:F,split:'half',created_by:A,created_at:t0,updated_at:t0}]},files:[]});

async function withReserva(fn){
 const dir=mkdtempSync(join(tmpdir(),'dupla-reserva-')),logs=[];
 // Origen falso que sirve la copia como si fuera Cloudflare.
 let snap=snapshot();const cloud=createServer(async(req,res)=>{if(req.url==='/api/login'){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'dos_session=x; Path=/'});res.end('{}');return;}if(req.url==='/api/snapshot'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(snap));return;}res.writeHead(200);res.end('{}');});
 await new Promise(ok=>cloud.listen(0,'127.0.0.1',ok));
 const r=await startReserva({port:0,dataFile:join(dir,'dupla.sqlite'),log:m=>logs.push(m),env:{RESERVA_ORIGEN:`http://127.0.0.1:${cloud.address().port}`,RESERVA_EMAIL:'alvaro@reserva.test',RESERVA_CLAVE:'Clave-Reserva-2026!'}});
 try{await fn({r,logs,setSnap:s=>{snap=s;}});}finally{await r.close();cloud.close();rmSync(dir,{recursive:true,force:true});}
}
const login=async(base,email,password,origin=base)=>{const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email,password})});return {res,cookie:(res.headers.getSetCookie()||[]).map(c=>c.split(';')[0]).join('; ')};};

test('Servidor de reserva: copia de Cloudflare, mismas cuentas, web y API iguales, tiempo real y no pisa cambios hechos en la reserva',async()=>{
 await withReserva(async({r,logs,setSnap})=>{
  const base=r.url.replace('localhost','localhost');
  assert.ok(logs.some(m=>/Datos copiados/.test(m)),logs.join('\n'));
  const h=await (await fetch(base+'/api/health')).json();assert.equal(h.reserva,true);assert.ok(h.sync.at);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/app\.js/);assert.match(page.headers.get('content-security-policy'),/connect-src 'self' ws: wss:/);
  assert.equal((await fetch(base+'/../package.json')).status,404);
  // Álvaro entra con su contraseña; Angie aún no tiene contraseña en la reserva.
  assert.equal((await login(base,'angie@reserva.test','Clave-Reserva-2026!')).res.status,401);
  const {res,cookie}=await login(base,'alvaro@reserva.test','Clave-Reserva-2026!');assert.equal(res.status,200);
  const projects=await (await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).json();assert.ok(JSON.stringify(projects).includes('Viaje a Lisboa'));
  const g=await (await fetch(base+'/api/finance/groups/'+F,{headers:{Cookie:cookie}})).json();assert.deepEqual(g.stats.owes,{from:B,to:A,amount:20});
  assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://evil.test'},body:'{}'})).status,403,'CSRF igual que en la web');
  // Tiempo real por WebSocket con la sesión.
  const ws=new WebSocket(base.replace('http','ws')+'/api/ws',{headers:{Cookie:cookie,Origin:base}});
  const got=[];await new Promise((ok,ko)=>{ws.onopen=()=>ws.send('ping');ws.onmessage=e=>{got.push(String(e.data));if(got.length===2)ok();};ws.onerror=()=>ko(Error('ws'));
   setTimeout(()=>fetch(base+'/api/ideas',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:base},body:JSON.stringify({title:'Idea en la reserva',space:'couple'})}),150);setTimeout(()=>ko(Error('sin mensajes: '+got)),4000);});
  ws.close();assert.equal(got[0],'pong');assert.match(got[1],/"at"/);
  // Hubo un cambio en la reserva: la copia horaria no lo pisa…
  setSnap(snapshot('Título cambiado en Cloudflare'));
  assert.equal((await r.syncNow()).skipped,true);assert.ok(logs.some(m=>/cambios hechos en la reserva/.test(m)));
  assert.ok(!JSON.stringify(await (await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).json()).includes('Título cambiado'));
  // …salvo que se fuerce; la sesión de Álvaro y su contraseña siguen valiendo.
  assert.ok((await r.syncNow(true)).rows>0);
  assert.ok(JSON.stringify(await (await fetch(base+'/api/dashboard',{headers:{Cookie:cookie}})).json()).includes('Título cambiado'));
 });
});

test('Entrada alternativa (Firebase): reenvía web y API con la misma sesión, reescribe el origen solo si viene de ella y rechaza otros',async()=>{
 await withReserva(async({r})=>{
  const proxy=createServer(createProxy(r.url));await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));const pb=`http://127.0.0.1:${proxy.address().port}`;
  try{
   const page=await fetch(pb+'/');assert.equal(page.status,200);assert.match(await page.text(),/app\.js/);assert.equal(page.headers.get('x-dupla-entrada'),'google');
   const {res,cookie}=await login(pb,'alvaro@reserva.test','Clave-Reserva-2026!',pb);assert.equal(res.status,200);assert.match(cookie,/dos_session=/);
   assert.ok(JSON.stringify(await (await fetch(pb+'/api/dashboard',{headers:{Cookie:cookie}})).json()).includes('Viaje a Lisboa'));
   const ok=await fetch(pb+'/api/ideas',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:pb},body:JSON.stringify({title:'Desde la entrada de Google',space:'couple'})});assert.ok(ok.status<300,String(ok.status));
   assert.equal((await fetch(pb+'/api/ideas',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',Origin:'https://evil.test'},body:'{"title":"x"}'})).status,403);
   assert.equal((await fetch(pb+'/api/ws')).status,503);
   const upload=await fetch(pb+'/api/projects/'+P,{headers:{Cookie:cookie}});assert.equal(upload.status,200);
  }finally{proxy.close();}
 });
});
