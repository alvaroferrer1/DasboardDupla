// DUPLA 6 · backend: preferencias, viaje, portada, tiempo y agente (IA y red simuladas, sin coste).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

const JPEG=Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(400,7)]);
function fixture(ai,extraEnv={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(sql,...b){if(!b.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}const st=db.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?st.all(...b):[];return {toArray:()=>rows,rowsWritten:reader?0:st.run(...b).changes};}},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const jobs=[];const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64),AI:ai,...extraEnv},{getWebSockets:()=>[],waitUntil(p){jobs.push(p);}});
 async function call(path,method='GET',body,cookie){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test'});if(cookie)headers.set('cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const request=new Request('https://dupla.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let consumed=false,resolve,code=200;const h=new Headers(),promise=new Promise(r=>resolve=r);
  const req={method,headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(consumed)return;consumed=true;const bytes=await request.arrayBuffer();if(bytes.byteLength)yield Buffer.from(bytes);}};
  const res={headersSent:false,writableEnded:false,writeHead(n,hs={}){code=n;this.headersSent=true;for(const[k,v]of Object.entries(hs))h.set(k,v);},end(b){this.writableEnded=true;resolve(new Response(b??null,{status:code,headers:h}));}};
  try{await app.api(req,res,new URL(request.url));}catch(e){if(!res.headersSent)res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:String(e)}));}
  const response=await promise;const type=response.headers.get('content-type')||'';const data=type.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data,type};
 }
 async function loginAs(email,password){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test','content-type':'application/json'});
  let cookie='';const res={headersSent:false,writableEnded:false,writeHead(n,hs={}){this.headersSent=true;cookie=String(hs['Set-Cookie']||hs['set-cookie']||'').split(';')[0];},end(){this.writableEnded=true;}};
  const body=Buffer.from(JSON.stringify({email,password}));
  await app.api({method:'POST',headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield body;}},res,new URL('https://dupla.test/api/login'));
  assert.match(cookie,/^dos_session=/);return cookie;
 }
 async function login(){
  assert.equal((await call('/api/initialize','POST',{setup_token:'A'.repeat(64),email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'clave-super-a-1234',password_b:'clave-super-b-2345'})).status,201);
  return loginAs('a@dupla.test','clave-super-a-1234');
 }
 return {call,login,loginAs,db,jobs};
}
function mockFetch(handler){const calls=[];const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{calls.push(String(url));return handler(new URL(String(url)),opts);};return {calls,restore(){globalThis.fetch=original;}};}
const commonsPage=(n,w,h,mime='image/jpeg',host='upload.wikimedia.org')=>({index:n,imageinfo:[{mime,width:w,height:h,thumburl:`https://${host}/wikipedia/commons/thumb/a/a${n}/Budapest_${n}.jpg/1600px-Budapest_${n}.jpg`,descriptionurl:'https://commons.wikimedia.org/wiki/File:B'+n,extmetadata:{Artist:{value:'<a href="x">Fotógrafa '+n+'</a>'},LicenseShortName:{value:'CC BY-SA 4.0'}}}]});

test('Preferencias: solo claves conocidas y valores válidos, por persona',async()=>{
 const f=fixture();const c=await f.login();
 assert.equal((await f.call('/api/prefs','PUT',{home_summary:['trip','idea'],theme:'dark',accent:'violet',notify_types:['tasks','events'],pdf_cover:false},c)).status,200);
 assert.deepEqual((await f.call('/api/prefs','GET',undefined,c)).data.prefs,{home_summary:['trip','idea'],theme:'dark',accent:'violet',notify_types:['tasks','events'],pdf_cover:false});
 assert.equal((await f.call('/api/prefs','PUT',{home_summary:['hackeo']},c)).status,400);
 assert.equal((await f.call('/api/prefs','PUT',{notify_types:['tasks','tasks']},c)).status,400,'sin repetidos');
 assert.equal((await f.call('/api/prefs','PUT',{theme:'neon'},c)).status,400);
 assert.equal((await f.call('/api/prefs','PUT',{couple_since:'2024-02-14'},c)).status,400,'es compartido, no personal');
 assert.equal((await f.call('/api/prefs/shared','PUT',{couple_since:'2024-02-14'},c)).status,200);
 assert.equal((await f.call('/api/prefs','GET',undefined,c)).data.shared.couple_since,'2024-02-14');
 assert.equal((await f.call('/api/prefs','PUT',{admin:true},c)).status,400);
 assert.equal((await f.call('/api/prefs','GET')).status,401);
});

test('Viaje: el proyecto guarda tipo, destino y fechas; fechas incoherentes se rechazan; portada automática del destino',async()=>{
 const net=mockFetch(async u=>{
  if(u.hostname==='commons.wikimedia.org')return Response.json({query:{pages:{1:commonsPage(1,800,600),2:commonsPage(2,2400,1200),3:commonsPage(3,1000,1600),4:commonsPage(4,2000,1100,'image/svg+xml')}}});
  if(u.hostname==='upload.wikimedia.org')return new Response(JPEG,{headers:{'content-type':'image/jpeg'}});
  return new Response('no',{status:404});});
 try{
  const f=fixture();const c=await f.login();
  const r=await f.call('/api/projects','POST',{space:'couple',title:'Viaje a Budapest',template:'trip',destination:'Budapest',start_date:'2026-12-10',end_date:'2026-12-14'},c);
  assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.project.kind,'trip');assert.equal(r.data.project.destination,'Budapest');assert.equal(r.data.project.start_date,'2026-12-10');
  await Promise.all(f.jobs);
  const p=f.db.prepare('SELECT cover_file,cover_credit FROM projects WHERE id=?').get(r.data.project.id);
  assert(p.cover_file,'debe descargar la portada');assert.equal(p.cover_credit,'Fotógrafa 2 · CC BY-SA 4.0','elige la primera foto apaisada, grande y JPEG/PNG/WebP');
  const cover=await f.call(`/api/projects/${r.data.project.id}/cover`,'GET',undefined,c);assert.equal(cover.status,200);assert.equal(cover.type,'image/jpeg');assert(cover.data.equals(JPEG));
  assert.equal((await f.call(`/api/projects/${r.data.project.id}/trip`,'PATCH',{start_date:'2026-12-20',end_date:'2026-12-14'},c)).status,400);
  const ok=await f.call(`/api/projects/${r.data.project.id}/trip`,'PATCH',{start_date:'2026-12-11'},c);assert.equal(ok.status,200);assert.equal(ok.data.project.start_date,'2026-12-11');assert.equal(ok.data.project.destination,'Budapest');
 }finally{net.restore();}
});

test('Fotos del destino: filtro de calidad, caché de 7 días y nada de URLs externas arbitrarias',async()=>{
 const net=mockFetch(async u=>u.hostname==='commons.wikimedia.org'?Response.json({query:{pages:{1:commonsPage(1,2400,1300),2:commonsPage(2,2400,1300,'image/jpeg','evil.example')}}}):new Response('x',{status:404}));
 try{
  const f=fixture();const c=await f.login();
  const a=await f.call('/api/places/photos?q=Budapest','GET',undefined,c);assert.equal(a.status,200);assert.equal(a.data.items.length,1);assert.match(a.data.items[0].url,/^https:\/\/upload\.wikimedia\.org\//);
  const before=net.calls.length;await f.call('/api/places/photos?q=budapest','GET',undefined,c);assert.equal(net.calls.length,before,'segunda consulta sale de caché');
  const p=(await f.call('/api/projects','POST',{space:'couple',title:'Escapada',template:'weekend'},c)).data.project;
  assert.equal((await f.call(`/api/projects/${p.id}/cover`,'POST',{url:'https://evil.example/x.jpg'},c)).status,400);
  assert.equal((await f.call(`/api/projects/${p.id}/cover`,'POST',{base64:Buffer.from('<svg/>').toString('base64')},c)).status,415);
  assert.equal((await f.call(`/api/projects/${p.id}/cover`,'POST',{base64:JPEG.toString('base64')},c)).status,200);
  assert.equal(f.db.prepare('SELECT cover_credit FROM projects WHERE id=?').get(p.id).cover_credit,'Foto vuestra');
 }finally{net.restore();}
});

test('Fotos del destino: acepta miniaturas thumb.wikimedia.org (sin utm) y ordena por relevancia, no alfabéticamente',async()=>{
 const page=(n,title,host='thumb.wikimedia.org')=>({index:n,title,imageinfo:[{mime:'image/jpeg',width:3000,height:2000,thumburl:`https://${host}/wikipedia/commons/thumb/x/x${n}/F${n}.jpg/1920px-F${n}.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo`,extmetadata:{}}]});
 const net=mockFetch(async u=>u.hostname==='es.wikipedia.org'?Response.json({query:{pages:{1:page(1,'File:Aeropuerto de Roma-Ciampino.jpg'),2:page(2,'File:Arch of Constantine (Rome).jpg'),3:page(3,'File:Panorama de Roma desde el Gianicolo.jpg'),4:page(4,'File:Capitoline she-wolf.jpg'),5:page(5,'File:Colosseo 2020.jpg'),6:page(6,'File:Roma panorama.jpg'),7:page(7,'File:Vista del Tíber al atardecer.jpg')}}}):Response.json({query:{pages:{}}}));
 try{
  const f=fixture();const c=await f.login();
  const items=(await f.call('/api/places/photos?q=Roma','GET',undefined,c)).data.items;
  assert(items.length>=6);assert(items.every(x=>!x.url.includes('?')&&x.url.startsWith('https://thumb.wikimedia.org/')));
  assert.match(items[0].url,/F[367]\.jpg$/,'primero una vista o panorámica');assert(!items.slice(0,4).some(x=>/F1\.jpg$/.test(x.url)),'el aeropuerto nunca encabeza');
  assert(net.calls.some(x=>x.includes('es.wikipedia.org')&&x.includes('generator=images')),'usa las fotos del artículo de Wikipedia');
 }finally{net.restore();}
});

test('Tiempo del destino: Open-Meteo con geocodificación cacheada',async()=>{
 const net=mockFetch(async u=>u.hostname==='geocoding-api.open-meteo.com'?Response.json({results:[{latitude:47.5,longitude:19.04,name:'Budapest',country:'Hungría'}]}):u.hostname==='api.open-meteo.com'?Response.json({current:{temperature_2m:7.6,weather_code:3,is_day:1}}):new Response('x',{status:404}));
 try{
  const f=fixture();const c=await f.login();
  const w=await f.call('/api/weather?q=Budapest','GET',undefined,c);assert.equal(w.status,200);
  assert.deepEqual(w.data.weather,{found:true,place:'Budapest',country:'Hungría',temp:8,code:3,day:true,text:'Nublado'});
  const n=net.calls.length;await f.call('/api/weather?q=Budapest','GET',undefined,c);assert.equal(net.calls.length,n);
 }finally{net.restore();}
});

function scriptedAI(steps){const seen=[];return {seen,async run(model,input){seen.push({model,messages:input.messages.map(m=>({role:m.role,content:m.content,tool_call_id:m.tool_call_id})),tools:input.tools.map(t=>t.function.name)});const s=steps.shift();if(!s)throw Error('sin más pasos');return s.calls?{choices:[{message:{content:null,tool_calls:s.calls.map((c,i)=>({id:'c'+seen.length+i,type:'function',function:{name:c[0],arguments:JSON.stringify(c[1])}}))}}],usage:{neurons:10}}:{choices:[{message:{content:s.text}}],usage:{neurons:5}};}};}

test('Agente: lee con herramientas, PROPONE cambios sin guardarlos y respeta el ámbito',async()=>{
 const ai=scriptedAI([
  {calls:[['listar_proyectos',{}]]},
  {calls:[['crear_tarea',{proyecto:'viaje a budapest',titulo:'Reservar hotel',fecha:'2026-11-03',prioridad:'high'}],['crear_idea',{espacio:'work',titulo:'Idea de trabajo'}]]},
  {text:'Te dejo propuesta la tarea para confirmar.'}]);
 const f=fixture(ai);const c=await f.login();
 const trip=(await f.call('/api/projects','POST',{space:'couple',title:'Viaje a Budapest',template:'trip'},c)).data.project;
 const tasksBefore=f.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
 const r=await f.call('/api/agent','POST',{message:'Apunta reservar hotel antes del 3 de noviembre',scope:'couple'},c);
 assert.equal(r.status,200,JSON.stringify(r.data));
 const m=r.data.message;assert.equal(m.content,'Te dejo propuesta la tarea para confirmar.');
 assert.equal(m.proposals.length,1,'la idea de Trabajo queda fuera del ámbito Nuestro espacio');
 assert.deepEqual({method:m.proposals[0].method,path:m.proposals[0].path,status:m.proposals[0].status},{method:'POST',path:`/api/projects/${trip.id}/tasks`,status:'pending'});
 assert.equal(m.proposals[0].body.due_date,'2026-11-03');assert.equal(m.proposals[0].body.priority,'high');
 assert(m.trace.some(t=>t.tool==='crear_idea'&&!t.ok&&/ámbito/.test(t.error)));
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,tasksBefore,'el agente nunca guarda sin confirmación');
 const listed=JSON.parse(ai.seen[1].messages.at(-1).content);assert(listed.some(p=>p.titulo==='Viaje a Budapest'));
 assert(ai.seen[0].messages[0].content.includes('Nuestro espacio únicamente'));
 const hist=await f.call('/api/agent','GET',undefined,c);assert.equal(hist.data.messages.length,2);assert.equal(hist.data.messages[1].proposals[0].id,'p1');
 assert.equal((await f.call(`/api/agent/messages/${m.id}/proposals/p1`,'PATCH',{status:'done'},c)).status,200);
 assert.equal((await f.call('/api/agent','GET',undefined,c)).data.messages[1].proposals[0].status,'done');
});

test('Agente: un viaje nuevo y sus tareas en el mismo turno quedan encadenados; recordar guarda memoria compartida',async()=>{
 const ai=scriptedAI([
  {calls:[['crear_proyecto',{espacio:'couple',titulo:'Roma en primavera',plantilla:'trip',destino:'Roma',fecha_inicio:'2027-04-02',fecha_fin:'2027-04-06'}],['crear_tarea',{proyecto:'Roma en primavera',titulo:'Comprar vuelos'}],['recordar',{dato:'A Angie no le gusta madrugar'}]]},
  {text:'Listo para confirmar.'}]);
 const f=fixture(ai);const c=await f.login();
 const m=(await f.call('/api/agent','POST',{message:'Organiza Roma',scope:'all'},c)).data.message;
 assert.equal(m.proposals.length,2);
 assert.equal(m.proposals[0].body.destination,'Roma');assert.equal(m.proposals[0].body.kind,'trip');assert.equal(m.proposals[0].body.template,'blank','sin tareas genéricas duplicadas');
 const created=await f.call('/api/projects','POST',m.proposals[0].body,c);assert.equal(created.status,201);assert.equal(created.data.project.kind,'trip');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE project_id=?').get(created.data.project.id).n,0);
 f.db.prepare('DELETE FROM projects').run();
 assert.equal(m.proposals[1].path,'/api/projects/{{p1}}/tasks');assert.equal(m.proposals[1].depends_on,'p1');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM projects').get().n,0);
 assert.deepEqual(f.db.prepare('SELECT fact FROM agent_memory').all().map(x=>x.fact),['A Angie no le gusta madrugar']);
 assert.equal((await f.call('/api/agent','POST',{message:'x',scope:'otro'},c)).status,400);
});

test('Agente: no duplica tareas casi iguales que ya existen («Confirmar hotel» ≈ «Confirmar el hotel»)',async()=>{
 const ai=scriptedAI([{calls:[['crear_tarea',{proyecto:'Viaje a Budapest',titulo:'Confirmar el hotel',fecha:'2026-11-15'}],['crear_tarea',{proyecto:'Viaje a Budapest',titulo:'Comprar entradas del Parlamento'}]]},{text:'Ok.'}]);
 const f=fixture(ai);const c=await f.login();
 const trip=(await f.call('/api/projects','POST',{space:'couple',title:'Viaje a Budapest',template:'blank'},c)).data.project;
 assert.equal((await f.call(`/api/projects/${trip.id}/tasks`,'POST',{title:'Confirmar hotel'},c)).status,201);
 const m=(await f.call('/api/agent','POST',{message:'x'},c)).data.message;
 assert.deepEqual(m.proposals.map(p=>p.body.title),['Comprar entradas del Parlamento']);
 assert.match(m.trace.find(t=>!t.ok).error,/Ya existe la tarea «Confirmar hotel»/);
 assert.match(JSON.parse(ai.seen[1].messages.find(x=>x.role==='tool').content).error,/No la dupliques/);
});

test('Agente: si describe una propuesta sin llamar a la herramienta se le obliga; si insiste, se avisa (nunca una falsa propuesta)',async()=>{
 const f1=fixture(scriptedAI([{text:'Propongo añadir el gasto de vuelos. ¿Confirmas?'},{calls:[['anadir_gasto',{proyecto:'Viaje a Budapest',concepto:'Vuelos',categoria:'transport',previsto:180}]]},{text:'Listo para confirmar.'}]));
 const c1=await f1.login();await f1.call('/api/projects','POST',{space:'couple',title:'Viaje a Budapest',template:'blank'},c1);
 const m1=(await f1.call('/api/agent','POST',{message:'gasto'},c1)).data.message;
 assert.equal(m1.proposals.length,1);assert.equal(m1.proposals[0].body.estimated,180);assert.equal(m1.content,'Listo para confirmar.');
 const f2=fixture(scriptedAI([{text:'Propongo añadir el gasto. ¿Confirmas?'},{text:'Propongo añadir el gasto. ¿Confirmas?'}]));
 const c2=await f2.login();const m2=(await f2.call('/api/agent','POST',{message:'gasto'},c2)).data.message;
 assert.equal(m2.proposals.length,0);assert.match(m2.content,/No he podido preparar la propuesta/);
});

test('Sesiones activas: dispositivo legible, cerrar otra sesión concreta, nunca la actual por esta vía',async()=>{
 const f=fixture();const c=await f.login();
 f.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,device,created_at) SELECT ?,user_id,expires_at,'iPhone · Safari',? FROM sessions LIMIT 1").run('b'.repeat(64),new Date().toISOString());
 const s=(await f.call('/api/sessions','GET',undefined,c)).data;
 assert.equal(s.sessions.length,2);assert.equal(s.sessions.filter(x=>x.current).length,1);assert.equal(s.push_devices,0);
 const cur=s.sessions.find(x=>x.current),other=s.sessions.find(x=>!x.current);
 assert.equal(other.device,'iPhone · Safari');assert(!('token_hash' in other),'nunca expone el hash completo');
 assert.equal((await f.call('/api/sessions/'+cur.id,'DELETE',undefined,c)).status,400);
 assert.equal((await f.call('/api/sessions/'+other.id,'DELETE',undefined,c)).status,200);
 assert.equal((await f.call('/api/sessions','GET',undefined,c)).data.sessions.length,1);
});

test('Avatar de Dupla: compartido, solo imágenes reales y de menos de 2 MB',async()=>{
 const f=fixture();const c=await f.login();
 assert.equal((await f.call('/api/agent/avatar','GET',undefined,c)).status,404);
 assert.equal((await f.call('/api/agent/avatar','POST',{base64:Buffer.from('<svg onload=x>').toString('base64')},c)).status,415);
 const up=await f.call('/api/agent/avatar','POST',{base64:JPEG.toString('base64')},c);assert.equal(up.status,200);assert(up.data.shared.dupla_avatar_v);
 const g=await f.call('/api/agent/avatar','GET',undefined,c);assert.equal(g.status,200);assert.equal(g.type,'image/jpeg');
 assert.equal((await f.call('/api/agent/avatar','DELETE',undefined,c)).status,200);assert.equal((await f.call('/api/agent/avatar','GET',undefined,c)).status,404);
});

test('Copia completa: incluye portadas, avatar, memoria y ajustes; restaurarla los recupera (y copias antiguas no dejan referencias rotas)',async()=>{
 const f=fixture();const c=await f.login();
 const p=(await f.call('/api/projects','POST',{space:'couple',title:'Lisboa',template:'blank'},c)).data.project;
 assert.equal((await f.call(`/api/projects/${p.id}/cover`,'POST',{base64:JPEG.toString('base64')},c)).status,200);
 assert.equal((await f.call('/api/agent/avatar','POST',{base64:JPEG.toString('base64')},c)).status,200);
 f.db.prepare("INSERT INTO agent_memory(id,fact,created_by,created_at) SELECT ?, 'Le encanta el mar', id, ? FROM users LIMIT 1").run(crypto.randomUUID(),new Date().toISOString());
 await f.call('/api/prefs/shared','PUT',{couple_since:'2023-05-01'},c);
 const snap=await f.call('/api/snapshot','GET',undefined,c);assert.equal(snap.status,200);
 const s=snap.data;assert.equal(s.files.length,2,'portada + avatar');assert.equal(s.data.agent_memory.length,1);
 // Cambios posteriores que la restauración debe deshacer.
 await f.call('/api/prefs/shared','PUT',{couple_since:'2020-01-01'},c);f.db.prepare('DELETE FROM agent_memory').run();
 const r=await f.call('/api/snapshot/restore','POST',{snapshot:s,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},c);
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.restored_files,2);
 assert.equal((await f.call(`/api/projects/${p.id}/cover`,'GET',undefined,c)).status,200);
 assert.equal((await f.call('/api/agent/avatar','GET',undefined,c)).status,200);
 assert.equal((await f.call('/api/prefs','GET',undefined,c)).data.shared.couple_since,'2023-05-01');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM agent_memory').get().n,1);
 // Copia «antigua» sin archivos de portada: la referencia se limpia, no queda rota.
 const old={...s,files:[],data:{...s.data}};delete old.data.shared_settings;
 const r2=await f.call('/api/snapshot/restore','POST',{snapshot:old,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},c);
 assert.equal(r2.status,200,JSON.stringify(r2.data));
 assert.equal(f.db.prepare('SELECT cover_file FROM projects WHERE id=?').get(p.id).cover_file,null);
 assert.equal((await f.call('/api/agent/avatar','GET',undefined,c)).status,404);
});

test('Conexiones (0166-0182): global, por espacio o por proyecto, con permisos; fuera de su ámbito se bloquea',async()=>{
 const f=fixture();const c=await f.login();
 const web=(await f.call('/api/projects','POST',{space:'work',title:'Web Lumen',template:'blank'},c)).data.project;
 const viaje=(await f.call('/api/projects','POST',{space:'couple',title:'Viaje',template:'blank'},c)).data.project;
 const app=(await f.call('/api/projects','POST',{space:'work',title:'App',template:'blank'},c)).data.project;
 // Figma solo para Web Lumen, con permiso de editar.
 assert.equal((await f.call('/api/connections','POST',{provider:'figma',scope_type:'project',scope_id:web.id,permission:'write'},c)).status,201);
 assert.equal((await f.call('/api/connections','POST',{provider:'figma',scope_type:'project',scope_id:web.id},c)).status,409,'sin duplicados');
 // Enlaces simples sin OAuth (0149): GitHub validado por dominio, Stitch en espacio Trabajo.
 assert.equal((await f.call('/api/connections','POST',{provider:'github',scope_type:'project',scope_id:app.id,url:'https://evil.com/x'},c)).status,400);
 assert.equal((await f.call('/api/connections','POST',{provider:'github',scope_type:'project',scope_id:app.id,url:'https://github.com/dupla/app',label:'Repo'},c)).status,201);
 assert.equal((await f.call('/api/connections','POST',{provider:'stitch',scope_type:'space',scope_id:'work',url:'https://stitch.withgoogle.com/projects/1'},c)).status,201);
 assert.equal((await f.call('/api/connections','POST',{provider:'canva',scope_type:'space',scope_id:'otro'},c)).status,400);
 const list=(await f.call('/api/connections','GET',undefined,c)).data;assert.equal(list.items.length,3);assert.equal(list.items.find(x=>x.provider==='figma').project_title,'Web Lumen');
 // Importar de Figma a un viaje personal queda bloqueado por privacidad (0172).
 const blocked=await f.call('/api/design/figma/import','POST',{project_id:viaje.id,file_key:'abc'},c);assert.equal(blocked.status,403);assert.match(blocked.data.error,/no está activado para «Viaje»/);
 // Solo lectura bloquea escribir.
 const fig=list.items.find(x=>x.provider==='figma');assert.equal((await f.call('/api/connections/'+fig.id,'PATCH',{permission:'read'},c)).status,200);
 assert.match((await f.call('/api/design/figma/import','POST',{project_id:web.id,file_key:'abc'},c)).data.error,/solo tiene permiso de lectura/);
 assert.equal((await f.call('/api/connections/'+fig.id,'DELETE',undefined,c)).status,200);
 assert.equal((await f.call('/api/connections','GET',undefined,c)).data.items.length,2);
});

test('Notificaciones R0212-R0242: push cifrado con contenido real, filtros por tipo, importante, entrega y recordatorio de viaje',async()=>{
 const {generateKeyPairSync,createECDH,randomBytes}=await import('node:crypto');
 const ece=(await import('node:module')).createRequire(import.meta.url)('http_ece');
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});
 const vapid={PUSH_VAPID_PRIVATE_JWK:JSON.stringify(privateKey.export({format:'jwk'})),PUSH_VAPID_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'),PUSH_VAPID_SUBJECT:'https://dupla.test'};
 const sent=[];const net=mockFetch(async(u,opts)=>{sent.push({url:String(u),opts});return new Response('',{status:201});});
 try{
  const f=fixture(undefined,vapid);const a=await f.login();
  // B se suscribe con claves reales de dispositivo (como un iPhone).
  const ua=createECDH('prime256v1');ua.generateKeys();const auth=randomBytes(16);
  const endpoint='https://web.push.apple.com/QH1234567890abcdef';
  const cookieB=await f.loginAs('b@dupla.test','clave-super-b-2345');
  assert.equal((await f.call('/api/push/subscribe','POST',{endpoint,keys:{p256dh:ua.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}},cookieB)).status,200);
  // B quiere avisos de Nuestro espacio en el móvil (sin correo), pero no de ideas.
  assert.equal((await f.call('/api/notifications/preferences','POST',{email_enabled:false,work_enabled:true,couple_enabled:true},cookieB)).status,200);
  assert.equal((await f.call('/api/prefs','PUT',{notify_types:['tasks','projects','events','trip_reminders']},cookieB)).status,200);
  const p=(await f.call('/api/projects','POST',{space:'couple',title:'Viaje a Budapest',template:'trip',destination:'Budapest',start_date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date())},a)).data.project;
  await f.call(`/api/projects/${p.id}/tasks`,'POST',{title:'Confirmar hotel'},a);
  await f.call('/api/ideas','POST',{space:'couple',title:'Spa termal secreto'},a);
  await Promise.all(f.jobs);await new Promise(ok=>setTimeout(ok,30));
  const pushes=sent.filter(x=>x.url===endpoint);
  assert(pushes.length>=2,'llegan al momento, sin esperar a la revisión horaria');
  const texts=pushes.map(x=>{assert.equal(x.opts.headers['Content-Encoding'],'aes128gcm');assert(!Buffer.from(x.opts.body).includes(Buffer.from('Confirmar hotel')),'nunca en claro');return JSON.parse(ece.decrypt(Buffer.from(x.opts.body),{version:'aes128gcm',privateKey:ua,authSecret:auth}).toString());});
  assert(texts.some(t=>t.title==='DUPLA · Angie'||t.title.startsWith('DUPLA · ')),'título real');
  assert(texts.some(t=>t.body.includes('«Confirmar hotel»')&&t.body.includes('Viaje a Budapest')),'contenido real de la tarea');
  assert(!texts.some(t=>t.body.includes('Spa termal')),'el tipo «ideas» desactivado no sale al móvil');
  const list=(await f.call('/api/notifications','GET',undefined,cookieB)).data.items;
  const idea=list.find(n=>n.type==='ideas');assert(idea,'dentro de DUPLA se ve todo');assert.equal(idea.push,'none');
  const task=list.find(n=>n.detail==='Confirmar hotel');assert.equal(task.type,'tasks');assert.equal(task.push,'sent','entrega verificada');
  assert.equal((await f.call('/api/notifications/important','POST',{id:task.id,important:true},cookieB)).status,200);
  assert.equal((await f.call('/api/notifications','GET',undefined,cookieB)).data.items.find(n=>n.id===task.id).important,true);
  assert.equal((await f.call('/api/notifications/important','POST',{id:task.id,important:true},a)).status,404,'no se marcan avisos ajenos');
  // Recordatorio de viaje el día de salida.
  await f.call('/api/reminders/run','POST',{},a);
  const trip=(await f.call('/api/notifications','GET',undefined,cookieB)).data.items.find(n=>n.type==='trip_reminders');
  assert(trip&&/salís hoy/.test(trip.detail)&&trip.important,'recordatorio de viaje importante');
 }finally{net.restore();}
});

test('Agente sin IA configurada responde 503 claro, no inventa',async()=>{
 const f=fixture();const c=await f.login();
 const r=await f.call('/api/agent','POST',{message:'Hola'},c);assert.equal(r.status,503);assert.match(r.data.error,/IA no está disponible/);
});

test('Calendario R0261-R0264: evento sin vincular → vinculado a proyecto → completado; DUPLA y compartido; queda en actividad',async()=>{
 const f=fixture({},{INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64')});const c=await f.login();
 const p=(await f.call('/api/projects','POST',{title:'Cena de aniversario',space:'couple'},c)).data.project;
 const ev=await f.call('/api/projects/'+p.id+'/events','POST',{title:'Reserva restaurante',event_date:'2026-11-03'},c);assert.equal(ev.status,201);
 const evId=(await f.call('/api/projects/'+p.id,'GET',undefined,c)).data.project.events[0].id;
 assert.deepEqual((await f.call('/api/calendar/marks','GET',undefined,c)).data.items,[]);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'google',id:'abc_123',project_id:p.id,title:'Cena'},c)).status,200);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'google',id:'abc_123',done:true,title:'Cena'},c)).status,200);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'dupla',id:evId,done:true,title:'Reserva'},c)).status,200);
 const items=(await f.call('/api/calendar/marks','GET',undefined,c)).data.items;
 const g=items.find(x=>x.source==='google');assert.equal(g.project_id,p.id);assert.equal(g.done,1);assert.equal(g.project_title,'Cena de aniversario');
 assert.equal(items.find(x=>x.source==='dupla').done,1);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'google',id:'abc_123',project_id:null},c)).status,200);
 assert.equal((await f.call('/api/calendar/marks','GET',undefined,c)).data.items.find(x=>x.source==='google').project_id,null);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'google',id:'../x',done:true},c)).status,400);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'dupla',id:'noexiste',done:true},c)).status,404);
 assert.equal((await f.call('/api/calendar/marks','POST',{source:'google',id:'x1',project_id:'noexiste'},c)).status,404);
 assert.equal((await f.call('/api/calendar/marks','GET')).status,401);
 const acts=f.db.prepare('SELECT action FROM activities WHERE project_id=?').all(p.id).map(r=>r.action);
 assert.ok(acts.includes('vinculó el evento')&&acts.includes('completó el evento'));
});

test('Buscador R0191-R0208: grupos (viajes, actividad…), filtro por espacio y por proyecto',async()=>{
 const f=fixture();const c=await f.login();
 const trip=(await f.call('/api/projects','POST',{title:'Escapada',space:'couple',kind:'trip',destination:'Lisboa'},c)).data.project;
 const web=(await f.call('/api/projects','POST',{title:'Web Lisboa Studio',space:'work'},c)).data.project;
 await f.call('/api/projects/'+web.id+'/tasks','POST',{title:'Maqueta Lisboa'},c);
 const r=(await f.call('/api/search?q=lisboa','GET',undefined,c)).data.results;
 assert.deepEqual(r.trips.map(x=>x.title),['Escapada']);assert.deepEqual(r.projects.map(x=>x.title),['Web Lisboa Studio']);
 assert.equal(r.tasks.length,1);assert.ok(r.activity.length>=1&&r.activity.every(x=>x.type==='activity'));
 const w=(await f.call('/api/search?q=lisboa&space=work','GET',undefined,c)).data.results;assert.equal(w.trips.length,0);assert.equal(w.projects.length,1);
 const inP=(await f.call('/api/search?q=lisboa&project='+trip.id,'GET',undefined,c)).data.results;assert.equal(inP.tasks.length,0);assert.equal(inP.trips.length,1);assert.equal(inP.projects.length,0);
 assert.equal((await f.call('/api/search?q=lisboa&project=noexiste','GET',undefined,c)).status,404);
});

test('Búsqueda semántica (R0205): solo con IA activa, devuelve relacionados que no coinciden literalmente y cachea',async()=>{
 const off=fixture();const c0=await off.login();assert.deepEqual((await off.call('/api/search/semantic?q=playa','GET',undefined,c0)).data,{available:false,items:[]});
 let calls=0;const ai={async run(model,{text}){calls++;assert.equal(model,'@cf/baai/bge-m3');return {data:text.map(t=>/playa|costa|mar/i.test(t)?[1,0.1,0]:[0,1,0])};}};
 const f=fixture(ai);const c=await f.login();
 await f.call('/api/projects','POST',{title:'Vacaciones en la costa',space:'couple'},c);await f.call('/api/projects','POST',{title:'Factura cliente',space:'work'},c);
 const r=(await f.call('/api/search/semantic?q=playa','GET',undefined,c)).data;assert.equal(r.available,true);assert.deepEqual(r.items.map(x=>x.title),['Vacaciones en la costa']);
 const n=calls;await f.call('/api/search/semantic?q=playa','GET',undefined,c);assert.equal(calls,n+1);
 assert.equal((await f.call('/api/search/semantic?q=playa&space=work','GET',undefined,c)).data.items.length,0);
});

test('Viajes R0284-R0295: día completado, actividad hecha/cancelada/reagendada/movida, reserva utilizada; en actividad',async()=>{
 const f=fixture();const c=await f.login();
 const t=(await f.call('/api/projects','POST',{title:'Lisboa',space:'couple',kind:'trip',destination:'Lisboa',start_date:'2026-11-10',end_date:'2026-11-12'},c)).data.project;
 const base='/api/projects/'+t.id+'/operations';
 const id=(await f.call(base+'/itinerary','POST',{title:'Tranvía 28',visit_date:'2026-11-10',booking_state:'booked'},c)).data.id;
 assert.equal((await f.call(base+'/days','POST',{date:'2026-11-10',done:true},c)).status,200);
 let it=(await f.call(base+'/itinerary/'+id,'PATCH',{state:'done',booking_used:true,revision:1},c));assert.equal(it.status,200);assert.equal(it.data.item.state,'done');assert.equal(it.data.item.booking_used,1);
 it=await f.call(base+'/itinerary/'+id,'PATCH',{visit_date:'2026-11-11',sort_order:3,state:'cancelled',revision:2},c);assert.equal(it.data.item.visit_date,'2026-11-11');assert.equal(it.data.item.sort_order,3);assert.equal(it.data.item.state,'cancelled');
 assert.equal((await f.call(base+'/itinerary/'+id,'PATCH',{state:'raro',revision:3},c)).status,400);
 const all=(await f.call(base,'GET',undefined,c)).data;assert.deepEqual(all.trip_days,[{day_date:'2026-11-10',done:1}]);
 const acts=f.db.prepare('SELECT action FROM activities WHERE project_id=?').all(t.id).map(r=>r.action);
 for(const a of ['completó un día del viaje','completó la actividad','canceló la actividad'])assert.ok(acts.includes(a),a);
 const w=(await f.call('/api/projects','POST',{title:'Web',space:'work'},c)).data.project;assert.equal((await f.call('/api/projects/'+w.id+'/operations/days','POST',{date:'2026-11-10',done:true},c)).status,403);
});

test('Actividad R0349-R0363: filtros por persona, espacio y proyecto, con proyecto afectado y paginación',async()=>{
 const f=fixture();const c=await f.login();const cb=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const w=(await f.call('/api/projects','POST',{title:'Web',space:'work'},c)).data.project;const t=(await f.call('/api/projects','POST',{title:'Roma',space:'couple'},cb)).data.project;
 const all=(await f.call('/api/activity','GET',undefined,c)).data;assert.ok(all.items.length>=2);assert.equal(all.more,false);assert.ok(all.items.every(a=>'author' in a&&'project_title' in a&&'created_at' in a));
 const me=f.db.prepare("SELECT id FROM users WHERE email='a@dupla.test'").get().id;
 assert.ok((await f.call('/api/activity?user='+me,'GET',undefined,c)).data.items.every(a=>a.user_id===me));
 assert.ok((await f.call('/api/activity?space=couple','GET',undefined,c)).data.items.every(a=>a.space==='couple'));
 const pr=(await f.call('/api/activity?project='+t.id,'GET',undefined,c)).data.items;assert.ok(pr.length&&pr.every(a=>a.project_id===t.id&&a.project_title==='Roma'));
 const last=all.items[all.items.length-1].created_at;assert.ok((await f.call('/api/activity?before='+encodeURIComponent(last),'GET',undefined,c)).data.items.every(a=>a.created_at<last));
 for(const bad of ['user=x','space=otro','project=x','before=ayer'])assert.notEqual((await f.call('/api/activity?'+bad,'GET',undefined,c)).status,200);
 assert.equal((await f.call('/api/activity','GET')).status,401);void w;
});

test('Ideas R0329-R0341: archivar, convertir en trabajo/plan/viaje/deseo una sola vez, expandir con IA sin guardar',async()=>{
 const ai={async run(model,input){return {choices:[{message:{content:'Objetivo: probar.\n- Paso 1'}}]};}};
 const f=fixture(ai);const c=await f.login();
 const mk=async t=>(await f.call('/api/ideas','POST',{title:t,space:'couple'},c)).data.idea;
 const a=await mk('Ir a Oporto'),b=await mk('Cámara instantánea'),d=await mk('Web portfolio'),g=await mk('Cena japonesa');
 let r=await f.call('/api/ideas/'+a.id+'/convert','POST',{target:'trip',destination:'Oporto'},c);assert.equal(r.status,201);assert.equal(r.data.project.kind,'trip');assert.equal(r.data.project.destination,'Oporto');assert.equal(r.data.project.space,'couple');
 assert.equal((await f.call('/api/ideas/'+a.id+'/convert','POST',{target:'wish'},c)).status,409);
 r=await f.call('/api/ideas/'+b.id+'/convert','POST',{target:'wish'},c);assert.equal(r.status,201);assert.equal(r.data.wish.kind,'wish');
 r=await f.call('/api/ideas/'+d.id+'/convert','POST',{target:'work'},c);assert.equal(r.data.project.space,'work');
 r=await f.call('/api/ideas/'+g.id+'/convert','POST',{target:'plan'},c);assert.equal(r.data.project.space,'couple');assert.equal(r.data.project.kind,'blank');
 const e=await mk('Pintar el salón');const ar=await f.call('/api/ideas/'+e.id,'PATCH',{archived:true,revision:e.revision},c);assert.ok(ar.data.idea.archived_at);
 const un=await f.call('/api/ideas/'+e.id,'PATCH',{archived:false,revision:ar.data.idea.revision},c);assert.equal(un.data.idea.archived_at,null);
 const x=await f.call('/api/ideas/'+e.id+'/expand','POST',{},c);assert.equal(x.status,200);assert.equal(x.data.generated,true);assert.match(x.data.text,/Objetivo/);
 assert.equal(f.db.prepare('SELECT body FROM ideas WHERE id=?').get(e.id).body,'');
 const off=fixture();const c0=await off.login();const i0=(await off.call('/api/ideas','POST',{title:'X',space:'work'},c0)).data.idea;assert.equal((await off.call('/api/ideas/'+i0.id+'/expand','POST',{},c0)).status,503);
});

test('Nuestro espacio R0443-R0453: deseos, regalos, metas, casa y recuerdos con foto validada; en actividad',async()=>{
 const f=fixture();const c=await f.login();
 const mk=async b=>(await f.call('/api/couple-items','POST',b,c));
 assert.equal((await mk({kind:'wish',title:'Cafetera',price:'120',url:'https://tienda.test/x'})).status,201);
 assert.equal((await mk({kind:'gift',title:'Libro',person:'Angie',item_date:'2026-12-25'})).status,201);
 const goal=(await mk({kind:'goal',title:'Ahorrar viaje',progress:30})).data.item;assert.equal(goal.progress,30);
 const mem=(await mk({kind:'memory',title:'Primer viaje',item_date:'2024-05-01'})).data.item;
 assert.equal((await mk({kind:'raro',title:'x'})).status,400);assert.equal((await mk({kind:'wish',title:'x',url:'javascript:alert(1)'})).status,400);
 assert.equal((await f.call('/api/couple-items/'+goal.id,'PATCH',{done:true,progress:100},c)).data.item.done,1);
 assert.equal((await f.call('/api/couple-items/'+mem.id+'/photo','POST',{base64:Buffer.from('<svg/>').toString('base64')},c)).status,415);
 assert.equal((await f.call('/api/couple-items/'+mem.id+'/photo','POST',{base64:JPEG.toString('base64')},c)).status,200);
 const ph=await f.call('/api/couple-items/'+mem.id+'/photo','GET',undefined,c);assert.equal(ph.status,200);assert.equal(ph.type,'image/jpeg');
 assert.equal((await f.call('/api/couple-items','GET',undefined,c)).data.items.length,4);
 assert.equal((await f.call('/api/couple-items/'+mem.id,'DELETE',undefined,c)).status,200);
 assert.ok(f.db.prepare("SELECT COUNT(*) AS n FROM activities WHERE action LIKE 'añadió%'").get().n>=4);
 assert.equal((await f.call('/api/couple-items','GET')).status,401);
});

test('Presupuestos R0414-R0440: categorías de viaje y presupuesto freelance solo en Trabajo, validado y guardado',async()=>{
 const f=fixture();const c=await f.login();
 const t=(await f.call('/api/projects','POST',{title:'Roma',space:'couple'},c)).data.project,w=(await f.call('/api/projects','POST',{title:'Web cliente',space:'work'},c)).data.project;
 for(const cat of ['flights','stay','transport','food','activities','shopping','extras'])assert.equal((await f.call('/api/projects/'+t.id+'/expenses','POST',{title:cat,category:cat,estimated:10,actual:5},c)).status,201,cat);
 assert.equal((await f.call('/api/projects/'+t.id+'/quote','GET',undefined,c)).status,403);
 assert.equal((await f.call('/api/projects/'+w.id+'/quote','GET',undefined,c)).data.quote,null);
 const q=await f.call('/api/projects/'+w.id+'/quote','PUT',{hours:40,rate:35,difficulty:3,complexity:'high',urgency:'urgent',demand:'demanding',revisions:3,extras:120,client:'Lumen',irpf:'7',vat:true},c);assert.equal(q.status,200);assert.equal(q.data.quote.irpf,'7');
 assert.equal((await f.call('/api/projects/'+w.id+'/quote','GET',undefined,c)).data.quote.client,'Lumen');
 assert.equal((await f.call('/api/projects/'+w.id+'/quote','PUT',{hours:-1},c)).status,400);
 assert.equal((await f.call('/api/projects/'+w.id+'/quote','PUT',{urgency:'ya'},c)).status,400);
});

test('Reuniones R0301-R0323: vinculada, señalización entre los dos, transcripción fiel por persona y resumen APARTE',async()=>{
 const seen=[];const ai={async run(model,input){seen.push(model);if(model.includes('whisper'))return {text:'  Reservamos   el hotel el viernes.  '};return {choices:[{message:{content:'{"summary":"Hablan del hotel.","tasks":[{"title":"Reservar hotel","who":"Angie"}],"decisions":["Ir el viernes"]}'}}]};}};
 const f=fixture(ai);const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const t=(await f.call('/api/projects','POST',{title:'Lisboa',space:'couple',kind:'trip'},a)).data.project;
 const m=(await f.call('/api/meetings','POST',{title:'Planear Lisboa',project_id:t.id},a)).data.meeting;
 assert.equal((await f.call('/api/meetings/'+m.id+'/start','POST',{},a)).data.meeting.status,'live');
 await f.call('/api/meetings/'+m.id+'/signal','POST',{data:{type:'offer',sdp:'x'}},a);
 const sb=(await f.call('/api/meetings/'+m.id+'/signal?after=0','GET',undefined,b)).data;assert.equal(sb.items.length,1);assert.equal(sb.items[0].data.type,'offer');
 assert.equal((await f.call('/api/meetings/'+m.id+'/signal?after=0','GET',undefined,a)).data.items.length,0);
 const audio=Buffer.alloc(400,1).toString('base64');
 const seg=await f.call('/api/meetings/'+m.id+'/audio','POST',{t_start:65000,base64:audio},b);assert.equal(seg.status,201,JSON.stringify(seg.data));assert.equal(seg.data.segment.text,'Reservamos el hotel el viernes.');
 assert.equal((await f.call('/api/meetings/'+m.id+'/audio','POST',{t_start:-1,base64:audio},b)).status,400);
 const sum=await f.call('/api/meetings/'+m.id+'/summarize','POST',{},a);assert.equal(sum.status,200);assert.deepEqual(sum.data.tasks,[{title:'Reservar hotel',who:'Angie'}]);
 const full=(await f.call('/api/meetings/'+m.id,'GET',undefined,a)).data;assert.equal(full.segments[0].text,'Reservamos el hotel el viernes.');assert.equal(full.segments[0].speaker!=null,true);assert.equal(full.meeting.summary,'Hablan del hotel.');assert.equal(full.meeting.project_title,'Lisboa');
 assert.ok(!full.segments.some(s=>s.text.includes('Hablan del hotel')));
 await f.call('/api/meetings/'+m.id+'/end','POST',{},a);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM meeting_signals').get().n,0);
 assert.equal((await f.call('/api/meetings','GET',undefined,b)).data.items[0].segments,1);
 const off=fixture();const c0=await off.login();const m0=(await off.call('/api/meetings','POST',{title:'X'},c0)).data.meeting;assert.equal((await off.call('/api/meetings/'+m0.id+'/audio','POST',{t_start:0,base64:audio},c0)).status,503);
});

test('Director General R0364-R0385: sugerencias reales por espacio y flujo propuesta→revisión→aprobada→ejecutada / descartada',async()=>{
 const f=fixture();const c=await f.login();const t0=new Date(),d=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
 const w=(await f.call('/api/projects','POST',{title:'Web',space:'work'},c)).data.project;await f.call('/api/projects/'+w.id+'/tasks','POST',{title:'Entregar',due_date:d(-3)},c);
 const trip=(await f.call('/api/projects','POST',{title:'Lisboa',space:'couple',kind:'trip',destination:'Lisboa',start_date:d(10),end_date:d(12)},c)).data.project;
 await f.call('/api/projects/'+trip.id+'/operations/itinerary','POST',{title:'Fado',visit_date:d(10),booking_state:'pending'},c);
 const work=(await f.call('/api/director?space=work','GET',undefined,c)).data.items,pers=(await f.call('/api/director?space=couple','GET',undefined,c)).data.items;
 assert.ok(work.some(x=>x.area==='retrasos'&&x.project_id===w.id));assert.ok(!work.some(x=>x.project_id===trip.id));
 for(const a of ['viaje','presupuesto'])assert.ok(pers.some(x=>x.area===a&&x.project_id===trip.id),a);
 const s=pers.find(x=>x.area==='viaje'&&x.id.startsWith('viaje-book'));assert.equal(s.status,'proposal');
 const url='/api/director/couple/'+s.id;
 assert.equal((await f.call(url,'POST',{status:'executed'},c)).status,403);
 assert.equal((await f.call(url,'POST',{status:'review'},c)).data.status,'review');
 assert.equal((await f.call(url,'POST',{status:'approved'},c)).data.status,'approved');
 const ex=await f.call(url,'POST',{status:'executed'},c);assert.equal(ex.status,200);assert.ok(ex.data.task_id);
 assert.equal(f.db.prepare('SELECT title FROM tasks WHERE id=?').get(ex.data.task_id).title,'Hacer reservas pendientes de Lisboa');
 assert.equal((await f.call(url,'POST',{status:'discarded'},c)).status,409);
 const other=work[0];assert.equal((await f.call('/api/director/work/'+other.id,'POST',{status:'discarded'},c)).data.status,'discarded');
 assert.equal((await f.call('/api/director?space=work','GET',undefined,c)).data.items.find(x=>x.id===other.id).status,'discarded');
 assert.equal((await f.call('/api/director/work/viaje-noexiste','POST',{status:'review'},c)).status,409);void t0;
});

test('Agente nuevas capacidades: PDF, Director, evento en Google y deshacer lo último confirmado',async()=>{
 const ai=scriptedAI([{calls:[['revisar_director',{espacio:'work'}],['preparar_pdf',{proyecto:'Web',tipo:'presupuesto'}],['preparar_pdf',{proyecto:'Lisboa',tipo:'itinerario'}]]},{text:'Te dejo los PDF para confirmar.'},
  {calls:[['crear_tarea',{proyecto:'Web',titulo:'Maquetar portada'}]]},{text:'Propuesta lista.'},
  {calls:[['deshacer',{}]]},{text:'Te propongo deshacerlo.'},
  {calls:[['crear_evento_calendario',{titulo:'Cena',fecha:'2026-12-01'}]]},{text:'x'}]);
 const f=fixture(ai);const c=await f.login();
 const w=(await f.call('/api/projects','POST',{title:'Web',space:'work'},c)).data.project;await f.call('/api/projects','POST',{title:'Lisboa',space:'couple',kind:'trip',destination:'Lisboa'},c);
 let m=(await f.call('/api/agent','POST',{message:'pdfs',scope:'all'},c)).data.message;
 assert.deepEqual(m.proposals.map(p=>[p.method,p.body.kind]),[['PDF','quote'],['PDF','trip']]);
 m=(await f.call('/api/agent','POST',{message:'tarea',scope:'all'},c)).data.message;const p=m.proposals[0];
 const created=(await f.call(p.path,p.method,p.body,c)).data.item;
 assert.equal((await f.call(`/api/agent/messages/${m.id}/proposals/${p.id}`,'PATCH',{status:'done',result_id:created.id},c)).status,200);
 const u=(await f.call('/api/agent','POST',{message:'deshaz lo que acabas de crear',scope:'all'},c)).data.message;
 assert.equal(u.proposals[0].method,'UNDO');assert.equal(u.proposals[0].body.message_id,m.id);assert.match(u.proposals[0].summary,/Maquetar portada/);
 const g=(await f.call('/api/agent','POST',{message:'cena en el calendario',scope:'all'},c)).data.message;
 assert.equal(g.proposals.length,0,'Sin calendario vinculado no se propone');
 assert.equal((await f.call(`/api/agent/messages/${m.id}/proposals/${p.id}`,'PATCH',{status:'undone'},c)).status,200);void w;
});

test('Memoria de Dupla editable y voz con Whisper',async()=>{
 const ai={async run(model){if(model.includes('whisper'))return {text:'  apunta comprar   flores '};throw Error('x');}};
 const f=fixture(ai);const c=await f.login();
 const id=(await f.call('/api/agent/memory','POST',{fact:'Angie es alérgica al marisco'},c)).data.id;
 assert.equal((await f.call('/api/agent/memory/'+id,'PATCH',{fact:'Angie es alérgica al marisco y al kiwi'},c)).status,200);
 assert.equal(f.db.prepare('SELECT fact FROM agent_memory WHERE id=?').get(id).fact,'Angie es alérgica al marisco y al kiwi');
 assert.equal((await f.call('/api/agent/memory/'+id,'PATCH',{fact:''},c)).status,400);
 const v=await f.call('/api/agent/voice','POST',{base64:Buffer.alloc(400,1).toString('base64')},c);assert.equal(v.data.text,'apunta comprar flores');
 assert.equal((await f.call('/api/agent/voice','POST',{base64:'x'},c)).status,400);
});

test('Dupla proactiva: resumen del día (aviso + evento en el calendario conjunto) una vez al día y avisos inteligentes sin repetir',async()=>{
 const CAL='1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com';
 const f=fixture(undefined,{GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'s',PUBLIC_ORIGIN:'https://dupla.test',INTEGRATION_ENCRYPTION_KEY:'K'.repeat(64)});const c=await f.login();
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date()),d=n=>new Date(Date.parse(today+'T12:00:00Z')+n*864e5).toISOString().slice(0,10);
 const w=(await f.call('/api/projects','POST',{title:'Web',space:'work'},c)).data.project;await f.call('/api/projects/'+w.id+'/tasks','POST',{title:'Entregar logo',due_date:today},c);
 const t=(await f.call('/api/projects','POST',{title:'Roma',space:'couple',kind:'trip',destination:'Roma',start_date:d(5),end_date:d(7)},c)).data.project;
 await f.call('/api/projects/'+t.id+'/operations/itinerary','POST',{title:'Coliseo',visit_date:d(5),booking_state:'pending'},c);
 const {encryptToken}=await import('../edge/google-calendar.mjs');const env={INTEGRATION_ENCRYPTION_KEY:'K'.repeat(64)};
 const uid0=f.db.prepare('SELECT id FROM users LIMIT 1').get().id;
 f.db.prepare('INSERT INTO google_connections(user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?)').run(uid0,await encryptToken(env,{access_token:'tok',refresh_token:'r'}),Date.now()+3600e3,new Date().toISOString());
 f.db.prepare("INSERT INTO google_shared_calendar(singleton,calendar_id,owner_user_id,title,member_email_a,member_email_b,share_status,created_at) VALUES('main',?,?,?,?,?,?,?)").run(CAL,uid0,'DUPLA · Nuestro calendario','','','shared',new Date().toISOString());
 const posted=[];const net=mockFetch(async(u,o)=>{if(o?.method==='POST'&&u.pathname.endsWith('/events')){posted.push(JSON.parse(o.body));return Response.json({id:'x'});}if(u.pathname.endsWith('/events'))return Response.json({items:[{id:'g1',summary:'Dentista',start:{dateTime:today+'T10:00:00+02:00'}}]});return new Response('{}',{status:404});});
 try{
  const r=(await f.call('/api/daily-brief/run','POST',{},c)).data;assert.equal(r.sent,2);assert.equal(r.calendar,true);
  assert.match(r.brief,/10:00 Dentista/);assert.match(r.brief,/Vence hoy: Entregar logo/);assert.match(r.brief,/Roma: faltan 5 días · 1 reserva pendiente/);
  assert.equal(posted.length,1);assert.match(posted[0].id,/^duplaresumen\d{8}$/);assert.deepEqual(posted[0].reminders.overrides,[{method:'popup',minutes:0}]);
  assert.ok(posted[0].description.includes('Entregar logo'));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE action='Resumen del día'").get().n,2);
 }finally{net.restore();}
});

test('Lo que edita uno lo ve el otro: resumen del Inicio compartido, proyectos, tareas, ideas, deseos y marcas de calendario',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 assert.equal((await f.call('/api/prefs/shared','PUT',{home_summary:['trip','date','task']},a)).status,200);
 assert.deepEqual((await f.call('/api/prefs','GET',undefined,b)).data.shared.home_summary,['trip','date','task'],'Ella ve el resumen que configuró él');
 assert.equal((await f.call('/api/prefs/shared','PUT',{home_summary:['raro']},b)).status,400);
 const p=(await f.call('/api/projects','POST',{title:'Plan de los dos',space:'couple'},b)).data.project;
 const t=(await f.call('/api/projects/'+p.id+'/tasks','POST',{title:'Comprar entradas'},b)).data.item;
 assert.equal((await f.call('/api/tasks/'+t.id,'PATCH',{state:'done',revision:t.revision},a)).status,200);
 const seen=(await f.call('/api/projects/'+p.id,'GET',undefined,b)).data.project;assert.equal(seen.tasks[0].state,'done','Ella ve la tarea que él completó');
 await f.call('/api/ideas','POST',{title:'Idea de ella',space:'couple'},b);assert.ok((await f.call('/api/dashboard','GET',undefined,a)).data.ideas.some(i=>i.title==='Idea de ella'));
 await f.call('/api/couple-items','POST',{kind:'wish',title:'Deseo de él'},a);assert.ok((await f.call('/api/couple-items','GET',undefined,b)).data.items.some(i=>i.title==='Deseo de él'));
 await f.call('/api/calendar/marks','POST',{source:'google',id:'ev1',project_id:p.id},b);assert.equal((await f.call('/api/calendar/marks','GET',undefined,a)).data.items[0].project_id,p.id);
});

test('Videollamada: la web publicada permite cámara y micrófono solo a DUPLA',async()=>{
 const {readFileSync}=await import('node:fs');const w=readFileSync(new URL('../edge/worker.mjs',import.meta.url),'utf8');
 assert.match(w,/'Permissions-Policy':'camera=\(self\), microphone=\(self\)/);assert.ok(!/camera=\(\)/.test(w));
});

test('Calendarios personales fusionados (solo lectura), Meet en eventos, choques en el resumen y reunión ligada al evento',async()=>{
 const CAL='1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com';
 const env={GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'s',PUBLIC_ORIGIN:'https://dupla.test',INTEGRATION_ENCRYPTION_KEY:'K'.repeat(64)};
 const f=fixture({async run(m){return {text:'x'};}},env);const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(new Date());
 const st=await f.call('/api/google/start','POST',{kind:'personal'},b);const au=new URL(st.data.url);
 assert.ok(au.searchParams.get('scope').split(' ').includes('https://www.googleapis.com/auth/calendar.events'));assert.ok(!au.searchParams.get('scope').includes('events.owned'));
 const state=au.searchParams.get('state');
 const {encryptToken}=await import('../edge/google-calendar.mjs');const uA=f.db.prepare("SELECT id FROM users WHERE email='a@dupla.test'").get().id;
 f.db.prepare('INSERT INTO google_connections(user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?)').run(uA,await encryptToken(env,{access_token:'own',refresh_token:'r'}),Date.now()+3600e3,new Date().toISOString());
 f.db.prepare("INSERT INTO google_shared_calendar(singleton,calendar_id,owner_user_id,title,member_email_a,member_email_b,share_status,created_at) VALUES('main',?,?,?,?,?,?,?)").run(CAL,uA,'DUPLA · Nuestro calendario','','','shared',new Date().toISOString());
 const posted=[];
 const net=mockFetch(async(u,o)=>{
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'angie-tok',refresh_token:'rr',expires_in:3600,scope:'x'});
  if(u.pathname.endsWith('/users/me/calendarList'))return Response.json({items:[{id:'angie@gmail.com',summary:'Angie',primary:true},{id:'trabajo@group.calendar.google.com',summary:'Trabajo Angie'},{id:CAL,summary:'DUPLA'},{id:'es.spain#holiday@group.v.calendar.google.com',summary:'Festivos'}]});
  if(u.pathname.includes('/calendars/angie%40gmail.com/events'))return Response.json({items:[{id:'m1',summary:'Médico',start:{dateTime:today+'T10:00:00+02:00'},end:{dateTime:today+'T11:00:00+02:00'}}]});
  if(u.pathname.includes('/calendars/trabajo%40group.calendar.google.com/events'))return Response.json({items:[]});
  if(u.pathname.includes(encodeURIComponent(CAL)+'/events')&&o?.method==='POST'){const body=JSON.parse(o.body);posted.push({url:u.toString(),body});return Response.json({id:body.id||'n1',...body,hangoutLink:body.conferenceData?'https://meet.google.com/abc-defg-hij':undefined});}
  if(u.pathname.includes(encodeURIComponent(CAL)+'/events'))return Response.json({items:[{id:'g1',summary:'Cena',start:{dateTime:today+'T10:30:00+02:00'},end:{dateTime:today+'T11:30:00+02:00'},description:'Únete https://meet.google.com/xyz-abcd-efg'}]});
  return new Response('{}',{status:404});});
 try{
  const cb=await f.call('/api/google/callback?state='+state+'&code=c1','GET');assert.equal(cb.status,302,JSON.stringify(cb.data));
  const mine=(await f.call('/api/google/personal','GET',undefined,b)).data;assert.equal(mine.connected,true);assert.equal(mine.email,'angie@gmail.com');
  assert.deepEqual(mine.calendars.map(c=>[c.name,c.include]),[['Angie',true],['Trabajo Angie',true],['Festivos',false]],'El calendario conjunto no se duplica y los festivos no se fusionan por defecto');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM google_connections WHERE user_id!=?').get(uA).n,0,'No sustituye la conexión del calendario conjunto');
  const merged=(await f.call(`/api/calendar/merged?from=${today}&to=${today}`,'GET',undefined,a)).data;
  assert.equal(merged.items.length,1);assert.equal(merged.items[0].title,'Médico');assert.equal(merged.items[0].owner_name!=null,true);assert.equal(merged.items[0].end,'11:00');
  const sh=(await f.call(`/api/google/shared/events?from=${today}&to=${today}`,'GET',undefined,a)).data.items[0];assert.equal(sh.meet,'https://meet.google.com/xyz-abcd-efg');assert.equal(sh.end,'11:30');
  const r=(await f.call('/api/daily-brief/run','POST',{},a)).data;assert.match(r.brief,/Choques: Cena \(10:30\) y Médico \(10:00\)|Choques: Médico \(10:00\) y Cena \(10:30\)/);
  const ev=await f.call('/api/google/shared/events','POST',{title:'Reunión web',date:today,time:'18:00',end_time:'19:30',meet:true,request_id:'11111111-2222-4333-8444-555555555555'},a);
  assert.equal(ev.data.meet,'https://meet.google.com/abc-defg-hij');const pe=posted.find(x=>x.body.summary==='Reunión web');assert.match(pe.url,/conferenceDataVersion=1/);assert.equal(pe.body.conferenceData.createRequest.conferenceSolutionKey.type,'hangoutsMeet');assert.match(pe.body.end.dateTime,/T19:30:00$/);
  const m1=(await f.call('/api/meetings','POST',{title:'Reunión web',meet_url:ev.data.meet,google_event_id:ev.data.id},a)).data.meeting;
  const m2=(await f.call('/api/meetings','POST',{title:'Reunión web',meet_url:ev.data.meet,google_event_id:ev.data.id},b)).data.meeting;assert.equal(m1.id,m2.id,'Un evento = una sala');assert.equal(m1.meet_url,'https://meet.google.com/abc-defg-hij');
  assert.equal((await f.call('/api/meetings','POST',{title:'x',meet_url:'https://evil.test/x'},a)).status,400);
  assert.equal((await f.call('/api/google/personal','PUT',{include:['angie@gmail.com']},b)).data.calendars.filter(c=>c.include).length,1);
  assert.equal((await f.call('/api/google/personal','DELETE',undefined,b)).status,200);assert.equal((await f.call('/api/google/personal','GET',undefined,b)).data.connected,false);
 }finally{net.restore();}
});

test('Tablero de tareas: estados, prioridad, persona, orden y tarea padre que bloquea el cierre',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const uB=f.db.prepare("SELECT id FROM users WHERE email='b@dupla.test'").get().id;
 const padre=(await f.call('/api/board','POST',{title:'Reservar hotel',priority:'urgent',assignee:uB},a)).data.item;assert.equal(padre.status,'todo');
 const hija=(await f.call('/api/board','POST',{title:'Pagar la señal',parent_id:padre.id},a)).data.item;
 const no=await f.call('/api/board/'+hija.id,'PATCH',{status:'done'},b);assert.equal(no.status,409);assert.match(no.data.error,/Reservar hotel/);
 assert.equal((await f.call('/api/board/'+padre.id,'PATCH',{status:'doing'},b)).data.item.status,'doing');
 assert.equal((await f.call('/api/board/'+padre.id,'PATCH',{status:'done'},b)).data.item.status,'done');
 const ok=(await f.call('/api/board/'+hija.id,'PATCH',{status:'done',sort:5},a)).data.item;assert.equal(ok.status,'done');assert.ok(ok.done_at);
 assert.equal((await f.call('/api/board/'+padre.id,'PATCH',{parent_id:hija.id},a)).status,400,'Sin círculos');
 assert.equal((await f.call('/api/board','POST',{title:'x',priority:'mega'},a)).status,400);
 const list=(await f.call('/api/board','GET',undefined,b)).data.items;assert.equal(list.length,2);assert.equal(list.find(x=>x.id===padre.id).assignee_name!=null,true);
 assert.ok(f.db.prepare("SELECT COUNT(*) AS n FROM activities WHERE action LIKE 'movió una tarea%'").get().n>=2);
 assert.equal((await f.call('/api/board/'+padre.id,'DELETE',undefined,a)).status,200);assert.equal(f.db.prepare('SELECT parent_id FROM board_tasks WHERE id=?').get(hija.id).parent_id,null);
});

test('Historial de presupuestos por destino y previsión del próximo viaje con festivos, puentes y rangos',async()=>{
 const f=fixture();const c=await f.login();
 const mk=async(st,en,stay,food,out,tic,booked)=>{const p=(await f.call('/api/projects','POST',{title:'Zaragoza '+st,space:'couple',kind:'trip',destination:'Zaragoza',start_date:st,end_date:en},c)).data.project;
  for(const [cat,v,bk] of [['stay',stay,booked],['food',food],['outings',out],['transport',tic,booked]])assert.equal((await f.call('/api/projects/'+p.id+'/expenses','POST',{title:cat,category:cat,estimated:v,actual:v,booked_at:bk||''},c)).status,201);};
 await mk('2025-03-07','2025-03-09',180,90,60,70,'2025-01-20');await mk('2025-11-14','2025-11-16',220,120,40,80,'2025-10-30');
 const h=(await f.call('/api/budget/history','GET',undefined,c)).data.destinations[0];
 assert.equal(h.destination,'Zaragoza');assert.equal(h.stats.trips,2);assert.deepEqual(h.stats.stay_per_night,{min:90,max:110,avg:100});assert.deepEqual(h.stats.food_per_day,{min:50,max:53,avg:52});assert.equal(h.stats.lead_stay.max,46);
 const net=mockFetch(async u=>u.hostname==='geocoding-api.open-meteo.com'?Response.json({results:[{name:'Zaragoza',country_code:'ES',admin1:'Aragón'}]}):u.hostname==='date.nager.at'?Response.json([{date:'2026-10-12',localName:'Fiesta Nacional de España',global:true}]):new Response('[]',{status:404}));
 try{const fc=(await f.call('/api/budget/forecast?destination=zaragoza&start=2026-10-10&end=2026-10-12','GET',undefined,c)).data;
  assert.equal(fc.region,'ES-AR');assert.deepEqual(fc.estimate.stay,{min:180,max:220});assert.deepEqual(fc.estimate.food,{min:150,max:159});assert.ok(fc.estimate.total.min>0);
  assert.ok(fc.alerts.some(x=>/Fiesta Nacional/.test(x.text)&&x.level==='high'));assert.ok(fc.alerts.some(x=>/Pilar/.test(x.text)));assert.ok(fc.alerts.some(x=>/Congresos, ferias, huelgas/.test(x.text)));
 }finally{net.restore();}
 assert.equal((await f.call('/api/budget/forecast?destination=x&start=2026-10-12&end=2026-10-10','GET',undefined,c)).status,400);
});

test('Reuniones: se graba cada tramo, se descarga la transcripción y al terminar se resume solo',async()=>{
 const ai={async run(model){return model.includes('whisper')?{text:'Vamos a Zaragoza en noviembre.'}:{choices:[{message:{content:'{"summary":"Deciden ir a Zaragoza.","tasks":[{"title":"Buscar hotel","who":"Angie"}],"decisions":["Ir en noviembre"]}'}}]};}};
 const f=fixture(ai);const a=await f.login();const m=(await f.call('/api/meetings','POST',{title:'Planear Zaragoza'},a)).data.meeting;
 await f.call('/api/meetings/'+m.id+'/start','POST',{},a);
 const seg=(await f.call('/api/meetings/'+m.id+'/audio','POST',{t_start:1000,base64:Buffer.alloc(600,7).toString('base64'),mime:'audio/webm;codecs=opus'},a)).data.segment;
 const au=await f.call('/api/meetings/'+m.id+'/audio/'+seg.id,'GET',undefined,a);assert.equal(au.status,200);assert.equal(au.type,'audio/webm');assert.equal(au.data.length,600);
 const end=(await f.call('/api/meetings/'+m.id+'/end','POST',{},a)).data;assert.equal(end.summary,true);
 const full=(await f.call('/api/meetings/'+m.id,'GET',undefined,a)).data;assert.equal(full.meeting.summary,'Deciden ir a Zaragoza.');assert.equal(full.segments[0].has_audio,1);
 const tx=await f.call('/api/meetings/'+m.id+'/transcript','GET',undefined,a);const t=tx.data.toString();assert.match(t,/\[0:01\] .*: Vamos a Zaragoza en noviembre\./);assert.match(t,/RESUMEN \(generado por IA, no es la transcripción\)/);
 await f.call('/api/meetings/'+m.id,'DELETE',undefined,a);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM meeting_segments').get().n,0);
});

test('Destinos: vuestros avisos por mes, eventos recurrentes según la IA y aviso push antes del viaje (una vez por fase)',async()=>{
 const ai={async run(){return {choices:[{message:{content:'{"events":[{"name":"Fiestas de San Isidro","when":"mediados de mayo","impact":"hoteles más caros","tip":"reservad en Tres Cantos"}],"tips":["Reservad con 6 semanas"]}'}}]};}};
 const f=fixture(ai);const c=await f.login();
 assert.equal((await f.call('/api/budget/notes','POST',{destination:'Madrid',month:5,text:'Mutua Madrid Open: suben los hoteles'},c)).status,201);
 assert.equal((await f.call('/api/budget/notes','POST',{destination:'Madrid',month:13,text:'x'},c)).status,400);
 const net=mockFetch(async u=>u.hostname==='geocoding-api.open-meteo.com'?Response.json({results:[{name:'Madrid',country_code:'ES',admin1:'Comunidad de Madrid'}]}):u.hostname==='date.nager.at'?Response.json([]):new Response('[]',{status:404}));
 try{
  const fc=(await f.call('/api/budget/forecast?destination=madrid&start=2027-05-12&end=2027-05-14','GET',undefined,c)).data;
  assert.ok(fc.alerts.some(a=>a.text==='Vuestro aviso: Mutua Madrid Open: suben los hoteles'));assert.equal(fc.insights.events[0].name,'Fiestas de San Isidro');assert.equal(fc.insights.tips[0],'Reservad con 6 semanas');
  const oct=(await f.call('/api/budget/forecast?destination=madrid&start=2027-10-12&end=2027-10-14','GET',undefined,c)).data;assert.ok(!oct.alerts.some(a=>/Mutua/.test(a.text)),'El aviso de mayo no sale en octubre');
 }finally{net.restore();}
 const n=(await f.call('/api/budget/notes?destination=MADRID','GET',undefined,c)).data.items;assert.equal(n.length,1);
 assert.equal((await f.call('/api/budget/notes/'+n[0].id,'DELETE',undefined,c)).status,200);
});

test('Avisos: al activar se guardan las claves de cifrado del dispositivo; Dupla consulta los avisos del destino',async()=>{
 const {readFileSync}=await import('node:fs');const app=readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8');
 assert.match(app,/api\('\/api\/push\/subscribe','POST',\{endpoint:subscription\.endpoint,keys:sj\.keys\}\)/,'El navegador manda p256dh y auth');
 assert.match(app,/case 'meet-guide':/);
 const ai=scriptedAI([{calls:[['avisos_destino',{destino:'Zaragoza',fecha_inicio:'2027-10-10',fecha_fin:'2027-10-12'}]]},{text:'Ojo con el Pilar.'}]);
 const net=mockFetch(async u=>u.hostname==='geocoding-api.open-meteo.com'?Response.json({results:[{name:'Zaragoza',country_code:'ES',admin1:'Comunidad Autónoma de Aragón'}]}):u.hostname==='date.nager.at'?Response.json([]):new Response('[]',{status:404}));
 try{const f=fixture(ai);const c=await f.login();const r=await f.call('/api/agent','POST',{message:'Viaje a Zaragoza del 10 al 12 de octubre',scope:'all'},c);assert.equal(r.status,200);
  const toolMsg=ai.seen[1].messages.find(m=>m.role==='tool');assert.match(toolMsg.content,/Pilar/,'La herramienta devuelve los avisos reales, no un objeto vacío');}finally{net.restore();}
});
