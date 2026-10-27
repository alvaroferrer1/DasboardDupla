// DUPLA production E2E. Requires two real accounts and explicit user authorization.
// Does not access real content beyond checking a project's own test fixture.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const origin=(process.env.DUPLA_URL||'https://dos-espacios-compartido.dos-espacios-ferris.workers.dev').replace(/\/$/,'');
const url=new URL(origin);
const localHarness=process.env.DUPLA_LOCAL_HARNESS==='1' && url.hostname==='127.0.0.1';
if((url.protocol!=='https:'&&!localHarness)||url.pathname!=='/'||url.search||url.hash)throw Error('DUPLA_URL debe ser origen HTTPS sin ruta (salvo pruebas locales explícitas)');
const users=[['A',process.env.DUPLA_EMAIL_A,process.env.DUPLA_PASSWORD_A],['B',process.env.DUPLA_EMAIL_B,process.env.DUPLA_PASSWORD_B]];
for(const [who,email,pwd]of users)if(!email||!pwd)throw Error('Falta email o contraseña de '+who+' en variables privadas del proceso');
const cases=[],ids=[];
const record=(name,passed,detail='')=>{cases.push({name,passed,detail});console.log((passed?'OK  ':'FALLO  ')+name+(detail?' · '+detail:''));};
async function request(path,method='GET',body,cookie){
 const response=await fetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{'Cookie':cookie}:{}),'Origin':origin},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(16000)});
 let data;const raw=Buffer.from(await response.arrayBuffer());try{data=JSON.parse(raw.toString());}catch{}
 return {status:response.status,data,raw,cookie:response.headers.get('set-cookie')};
}
async function check(name,fn){try{await fn();record(name,true);}catch(e){record(name,false,String(e.message||e).slice(0,180));throw e;}}
let cookieA='',cookieB='';
console.log('Auditoría real de DUPLA en '+origin+' (crea y elimina SOLO sus proyectos de prueba).');
try{
 await check('Salud pública del Worker',async()=>{const r=await request('/api/health');assert.equal(r.status,200);assert.equal(r.data?.status,'ok');});
 await check('Privacidad sin iniciar sesión',async()=>{const r=await request('/api/dashboard');assert.equal(r.status,401);});
 await check('Autenticación independiente de ambas cuentas',async()=>{
  const a=await request('/api/login','POST',{email:users[0][1],password:users[0][2]});
  const b=await request('/api/login','POST',{email:users[1][1],password:users[1][2]});
  assert.equal(a.status,200);assert.equal(b.status,200);cookieA=a.cookie?.split(';')[0];cookieB=b.cookie?.split(';')[0];assert(cookieA?.startsWith('dos_session=')&&cookieB?.startsWith('dos_session='));
  assert.notEqual(cookieA,cookieB);
 });
 const title='TEST DUPLA '+randomBytes(5).toString('hex');
 await check('Creación de proyecto y lectura desde segunda cuenta',async()=>{
  const x=await request('/api/projects','POST',{space:'couple',title},cookieA);assert.equal(x.status,201,JSON.stringify(x.data));
  ids.push(x.data.project.id);const y=await request('/api/projects/'+ids[0],'GET',undefined,cookieB);assert.equal(y.status,200);assert.equal(y.data.project.title,title);
 });
 let taskId,noteId;
 await check('Nota y tarea creadas por diferentes cuentas y persistidas',async()=>{
  const p=ids[0];const note=await request(`/api/projects/${p}/sections`,'POST',{title:'Nota de ensayo',content:'Contenido verificable '+title},cookieA);assert.equal(note.status,201);noteId=note.data.item.id;
  const task=await request(`/api/projects/${p}/tasks`,'POST',{title:'Tarea E2E',priority:'high'},cookieB);assert.equal(task.status,201);taskId=task.data.item.id;
  const detail=await request('/api/projects/'+p,'GET',undefined,cookieB);assert.equal(detail.data.project.sections.find(x=>x.id===noteId).content,'Contenido verificable '+title);assert(detail.data.project.tasks.find(x=>x.id===taskId));
 });
 await check('Edición concurrente: una revisión antigua devuelve 409',async()=>{
  const update=await request(`/api/tasks/${taskId}`,'PATCH',{revision:1,state:'done'},cookieA);assert.equal(update.status,200);
  const stale=await request(`/api/tasks/${taskId}`,'PATCH',{revision:1,state:'doing'},cookieB);assert.equal(stale.status,409);
  const latest=await request('/api/projects/'+ids[0],'GET',undefined,cookieB);assert.equal(latest.data.project.tasks.find(x=>x.id===taskId).state,'done');
 });
 await check('Archivo descargado íntegro por otra cuenta',async()=>{
  const raw=randomBytes(128);const upload=await request(`/api/projects/${ids[0]}/assets`,'POST',{name:'e2e-datos.bin',mime:'application/octet-stream',base64:raw.toString('base64')},cookieA);assert.equal(upload.status,201);
  const detail=await request('/api/projects/'+ids[0],'GET',undefined,cookieB);const asset=detail.data.project.assets.find(x=>x.name==='e2e-datos.bin');assert(asset);
  const download=await request('/api/assets/'+asset.id,'GET',undefined,cookieB);assert.equal(download.status,200);assert.deepEqual(download.raw,raw);
 });
 await check('DUPLA V5: entregables y horas reales entre las dos cuentas, sin activar automatizaciones',async()=>{
  const root=await request('/api/projects','POST',{space:'work',title:'TEST trabajo '+title},cookieA);assert.equal(root.status,201,JSON.stringify(root.data));const workId=root.data.project.id;ids.push(workId);
  const route=`/api/projects/${workId}/operations`;
  const deliver=await request(route+'/deliverables','POST',{title:'Entrega de ensayo'},cookieA);assert.equal(deliver.status,201);
  const update=await request(route+'/deliverables/'+deliver.data.id,'PATCH',{status:'approved',revision:1},cookieB);assert.equal(update.status,200,JSON.stringify(update.data));
  const hours=await request(route+'/hours','POST',{minutes:45,work_date:new Date().toISOString().slice(0,10),note:'Prueba de registro'},cookieB);assert.equal(hours.status,201);
  const fromA=await request(route,'GET',undefined,cookieA);assert.equal(fromA.status,200);
  assert.equal(fromA.data.deliverables[0].status,'approved');assert.equal(fromA.data.hours[0].minutes,45);
 });
 await check('DUPLA V5: itinerario real guardado y editado desde cuentas separadas',async()=>{
  const b=`/api/projects/${ids[0]}/operations`;
  const stop=await request(b+'/itinerary','POST',{title:'Visita de prueba',visit_date:'2026-12-12',visit_time:'10:15',location:'Centro'},cookieA);assert.equal(stop.status,201,JSON.stringify(stop.data));
  const saved=await request(b+'/itinerary/'+stop.data.id,'PATCH',{booking_state:'booked',revision:1},cookieB);assert.equal(saved.status,200);
  const fromA=await request(b,'GET',undefined,cookieA);assert(fromA.data.itinerary.some(x=>x.id===stop.data.id&&x.booking_state==='booked'));
 });
 await check('DUPLA V5: estado de copias externas protegido por sesión',async()=>{const r=await request('/api/backups/status','GET',undefined,cookieA);assert.equal(r.status,200);assert.equal(typeof r.data.enabled,'boolean');assert.equal((await request('/api/backups/status')).status,401);});
 await check('DUPLA V5: integridad de base de datos y control de acceso privado',async()=>{
  const r=await request('/api/ops/health','GET',undefined,cookieA);assert.equal(r.status,200);assert.equal(r.data.database_probe,'ok');assert(['ok','not_supported'].includes(r.data.database_integrity));
  const guest=await request('/api/ops/health','GET');assert.equal(guest.status,401);
 });
 await check('Notificaciones y acciones guardadas',async()=>{
  const notifs=await request('/api/notifications','GET',undefined,cookieA);assert.equal(notifs.status,200);assert(Array.isArray(notifs.data.items));
  const read=await request('/api/notifications/read','POST',{},cookieA);assert.equal(read.status,200);
 });
} catch (e) {console.error('La batería se detuvo al detectar un fallo funcional.');}
finally{
 for(const id of ids){try{
  await request('/api/projects/'+id,'DELETE',undefined,cookieA);
  const res=await request('/api/trash/'+id+'/purge','POST',{},cookieA);
  record('Limpieza del proyecto de prueba '+id,res.status===200);
 }catch(e){record('Limpieza del proyecto de prueba '+id,false,'Revisar la papelera manualmente');}}
 const total=cases.length,passed=cases.filter(x=>x.passed).length;
 console.log('RESULTADO: '+passed+'/'+total+' comprobaciones reales, '+(total-passed)+' fallos.');
 if(passed!==total)process.exitCode=1;
}
