import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

const js=readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../edge/public/style.css',import.meta.url),'utf8');

test('Incidencia iPhone: pulsar enviar no es interceptado por el fondo del modal',async()=>{
 const listeners=new Map();
 const document={addEventListener:(type,cb)=>listeners.set(type,cb),querySelector:()=>null};
 // Evaluate the real JS and register listeners, with no browser/remote services.
 const script=js.replace(/\bstart\(\);\s*$/,'globalThis.__attachDuplaEvents=attachEvents;');
 const context=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},console,setTimeout,clearTimeout,WebSocket:{OPEN:1}});
 vm.runInContext(script,context);
 vm.runInContext('__attachDuplaEvents()',context);
 const backdrop={classList:{contains:name=>name==='modal-overlay'}};
 const formButton={closest(selector){if(selector==='[data-action]')return backdrop;return null;}};
 let prevented=false;
 await listeners.get('click')({target:formButton,preventDefault(){prevented=true;}});
 assert.equal(prevented,false,'No cancelar la acción nativa de enviar dentro del modal');
});

test('Formulario de proyectos: comunica errores visibles, estado de guardado y evita doble envío',()=>{
 assert.match(js,/id=\\?"modal-feedback\\?"/);
 assert.match(js,/function showModalFeedback\(/);
 assert.match(js,/if\(form\.dataset\.saving==='1'\)return/);
 assert.match(js,/submit\.textContent='Guardando…'/);
 assert.match(js,/const v=await api\('\/api\/projects','POST',data\)/);
 assert.match(js,/await loadDash\(\)/);
 assert.match(js,/toast\('Proyecto creado y guardado para los dos\.'/);
});

test('Responsive: anchuras estrechas, modales con teclado iOS y avisos accesibles',()=>{
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(css,/max-height:calc\(100dvh - 16px\)/);
 assert.match(css,/\.modal-actions\{position:sticky;bottom:0/);
 assert.match(css,/\.modal-feedback:not\(\[hidden\]\)/);
 assert.match(css,/font-size:16px;/);
 assert.match(css,/overflow-wrap:anywhere/);
});

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(sql,...args){if(!args.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}const s=db.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);return reader?{toArray:()=>s.all(...args),rowsWritten:0}:{toArray:()=>[],rowsWritten:s.run(...args).changes};}},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(ex){db.exec('ROLLBACK');throw ex;}}};
 const app=createApi(storage,{SETUP_TOKEN:'Z'.repeat(64),PUBLIC_ORIGIN:'https://dupla.test'},{getWebSockets:()=>[]});
 async function call(path,method='GET',body,cookie){
  const headers={origin:'https://dupla.test',host:'dupla.test',...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})};
  let done;const promise=new Promise(r=>done=r);let status=200;const h=new Headers();
  const req={method,headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(body)yield Buffer.from(JSON.stringify(body));}};
  const res={headersSent:false,writableEnded:false,writeHead(n,v={}){status=n;this.headersSent=true;for(const[k,x]of Object.entries(v))h.set(k,x);},end(t){this.writableEnded=true;done(new Response(t??null,{status,headers:h}));}};
  try{await app.api(req,res,new URL('https://dupla.test'+path));}catch(ex){res.writeHead(ex.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:ex.status?ex.message:String(ex)}));}
  const r=await promise;return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
 }
 return {call,db};
}

test('Crear proyecto de verdad: trabajo y planes, plantillas, persistencia visible para las dos cuentas',async()=>{
 const {call,db}=fixture();
 try{
  const reg=await call('/api/initialize','POST',{setup_token:'Z'.repeat(64),email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'password-A-long-123456',password_b:'password-B-long-123456'});
  assert.equal(reg.status,201,JSON.stringify(reg.body));
  const a=await call('/api/login','POST',{email:'a@dupla.test',password:'password-A-long-123456'});
  const b=await call('/api/login','POST',{email:'b@dupla.test',password:'password-B-long-123456'});
  assert.equal(a.status,200);assert.equal(b.status,200);
  const cookieA=a.cookie.split(';')[0],cookieB=b.cookie.split(';')[0];
  for(const [space,template] of [['work','app'],['couple','trip']]){
   const title='Proyecto móvil de '+space;
   const created=await call('/api/projects','POST',{title,space,template,description:'Guardado con dos usuarios',status:'idea',color:'indigo'},cookieA);
   assert.equal(created.status,201,JSON.stringify(created.body));
   const id=created.body.project.id;
   const readB=await call('/api/projects/'+id,'GET',undefined,cookieB);
   assert.equal(readB.status,200);
   assert.equal(readB.body.project.title,title);
   assert.ok(readB.body.project.tasks.length>0,'Las plantillas deben crear tareas reales');
   const dashB=await call('/api/dashboard','GET',undefined,cookieB);
   assert.ok(dashB.body.projects.some(p=>p.id===id),'Aparece en la lista de la segunda cuenta');
  }
 }finally{db.close();}
});
