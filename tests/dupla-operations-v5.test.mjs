import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

function fixture(extraEnv={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const metadata=new Map();const storage={async get(key){return metadata.get(key)||null;},async put(key,value){metadata.set(key,value);},sql:{exec(sql,...bindings){
  if(!bindings.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
  const rows=reader?stmt.all(...bindings):[];
  const changes=reader?0:stmt.run(...bindings).changes;
  return {toArray:()=>rows,rowsWritten:changes};
 }},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(err){db.exec('ROLLBACK');throw err;}}};
 const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64),...extraEnv},{getWebSockets:()=>[],waitUntil(){}});
 async function call(path,method='GET',body,cookie){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test'});
  if(cookie)headers.set('cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const request=new Request('https://dupla.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let consumed=false,resolve,code=200;const h=new Headers(),promise=new Promise(r=>resolve=r);
  const req={method,headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(consumed)return;consumed=true;const bytes=await request.arrayBuffer();if(bytes.byteLength)yield Buffer.from(bytes);}};
  const res={headersSent:false,writableEnded:false,writeHead(n,headers={}){code=n;this.headersSent=true;for(const[k,v]of Object.entries(headers))h.set(k,v);},end(body){this.writableEnded=true;resolve(new Response(body??null,{status:code,headers:h}));}};
  try{await app.api(req,res,new URL(request.url));}catch(e){if(!res.headersSent)res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:String(e)}));}
  const response=await promise;let data;try{data=await response.clone().json();}catch{}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
 }
 async function initialize(){
  const init=await call('/api/initialize','POST',{setup_token:'A'.repeat(64),email_a:'a@local.test',email_b:'b@local.test',password_a:'clave-super-a-1234',password_b:'clave-super-b-2345'});assert.equal(init.status,201,JSON.stringify(init.data));
  const a=await call('/api/login','POST',{email:'a@local.test',password:'clave-super-a-1234'});assert.equal(a.status,200,JSON.stringify(a.data));
  const b=await call('/api/login','POST',{email:'b@local.test',password:'clave-super-b-2345'});assert.equal(b.status,200);
  return [a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,app,call,initialize};
}


test('DUPLA V5: dos usuarios guardan entregables, horas y revisiones con autorización',async()=>{
 const {db,call,initialize}=fixture();try{
  const [a,b]=await initialize(),root=await call('/api/projects','POST',{space:'work',title:'Proyecto verificable'},a);
  const id=root.data.project.id,base=`/api/projects/${id}/operations`;
  assert.equal((await call(base,'GET',undefined)).status,401);
  const created=await call(base+'/deliverables','POST',{title:'Entrega uno',description:'Alcance',due_date:'2026-12-10'},a);
  assert.equal(created.status,201,JSON.stringify(created.data));const did=created.data.id;
  const fromB=await call(base,'GET',undefined,b);assert.equal(fromB.status,200);assert.equal(fromB.data.deliverables[0].title,'Entrega uno');
  const approved=await call(base+'/deliverables/'+did,'PATCH',{status:'approved',revision:1},b);assert.equal(approved.status,200,JSON.stringify(approved.data));
  assert.equal((await call(base+'/deliverables/'+did,'PATCH',{status:'draft',revision:1},a)).status,409);
  const h=await call(base+'/hours','POST',{minutes:85,work_date:'2026-10-19',note:'Investigación'},a);assert.equal(h.status,201,JSON.stringify(h.data));
  assert.equal((await call(base+'/hours/'+h.data.id,'DELETE',undefined,b)).status,403);
  assert.equal((await call(base,'GET',undefined,b)).data.hours[0].minutes,85);
  assert.equal((await call(base+'/hours/'+h.data.id,'DELETE',undefined,a)).status,200);
  assert.equal((await call(base,'GET',undefined,b)).data.hours.length,0);
 }finally{db.close();}
});
test('DUPLA V5: itinerarios, estados de reserva, validación y separación de espacios',async()=>{
 const {db,call,initialize}=fixture();try{
  const [a,b]=await initialize();const c=await call('/api/projects','POST',{space:'couple',title:'Viaje para dos'},a),id=c.data.project.id,base=`/api/projects/${id}/operations`;
  const stop=await call(base+'/itinerary','POST',{title:'Parlamento',visit_date:'2026-12-11',visit_time:'16:30',location:'Budapest'},a);assert.equal(stop.status,201,JSON.stringify(stop.data));
  assert.equal((await call(base+'/itinerary','POST',{title:'Fecha imposible',visit_date:'2026-02-30'},b)).status,400);
  assert.equal((await call(base+'/deliverables','POST',{title:'No permitido'},a)).status,403);
  const update=await call(base+'/itinerary/'+stop.data.id,'PATCH',{booking_state:'booked',reference:'Reserva123',revision:1},b);assert.equal(update.status,200,JSON.stringify(update.data));
  const shared=(await call(base,'GET',undefined,a)).data.itinerary;assert.equal(shared[0].booking_state,'booked');assert.equal(shared[0].reference,'Reserva123');
  assert.equal((await call(base+'/itinerary/'+stop.data.id,'PATCH',{booking_state:'cancelled',revision:1},a)).status,409);
  assert.equal((await call(base+'/itinerary/'+stop.data.id,'DELETE',undefined,b)).status,200);
  assert.equal((await call(base,'GET',undefined,a)).data.itinerary.length,0);
 }finally{db.close();}
});
test('DUPLA V5: reglas automáticas crean tareas persistentes una vez por día, registran historial y protegen espacio personal',async()=>{
 const {db,app,call,initialize}=fixture();try{
  const [a,b]=await initialize();const work=await call('/api/projects','POST',{space:'work',title:'Operaciones'},a),pid=work.data.project.id,base=`/api/projects/${pid}/operations`;
  const rule=await call(base+'/automations','POST',{title:'Recordatorio diario',trigger_type:'daily',action_type:'task',payload:'Control de calidad'},a);assert.equal(rule.status,201,JSON.stringify(rule.data));const id=rule.data.id;
  assert.equal(app.processAutomationRules().executed,0,'Las reglas nacen desactivadas');
  assert.equal((await call(base+'/automations/'+id,'PATCH',{active:true},b)).status,200);
  assert.equal(app.processAutomationRules().executed,1);assert.equal(app.processAutomationRules().executed,0);
  const after=await call(base,'GET',undefined,b);assert.equal(after.status,200);assert.equal(after.data.executions.length,1);
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,b)).data.project.tasks.filter(x=>x.title==='Control de calidad').length,1);
  assert.equal((await call('/api/ops/health','GET',undefined,a)).data.database_integrity,'ok');
  assert.equal((await call('/api/ops/health','GET')).status,401);
  const couple=await call('/api/projects','POST',{space:'couple',title:'Privacidad de planes'},a);
  assert.equal((await call(`/api/projects/${couple.data.project.id}/operations/automations`,'POST',{title:'No',trigger_type:'daily',action_type:'task',payload:'No'},b)).status,403);
 }finally{db.close();}
});
test('DUPLA V5: copia restaura las tablas nuevas, rechaza manipulación y conserva las cuentas',async()=>{
 const {db,call,initialize}=fixture();try{
  const [a,b]=await initialize();const proj=await call('/api/projects','POST',{space:'work',title:'Para copia'},a),pid=proj.data.project.id,base=`/api/projects/${pid}/operations`;
  const deliver=await call(base+'/deliverables','POST',{title:'Entrega de referencia'},b);assert.equal(deliver.status,201);
  const auto=await call(base+'/automations','POST',{title:'Diaria',trigger_type:'daily',action_type:'notify',payload:'Revisión'},a);assert.equal(auto.status,201);
  const snapshot=await call('/api/snapshot','GET',undefined,a);assert.equal(snapshot.status,200,JSON.stringify(snapshot.data));assert.equal(snapshot.data.data.work_deliverables.length,1);assert.equal(snapshot.data.data.automation_rules.length,1);
  assert.equal((await call(base+'/deliverables/'+deliver.data.id,'DELETE',undefined,a)).status,200);
  const wrong=structuredClone(snapshot.data);wrong.data.work_deliverables[0].project_id='00000000-0000-4000-8000-000000000000';
  const req={confirmation:'RESTAURAR DUPLA',password:'clave-super-a-1234',snapshot:wrong};
  const invalid=await call('/api/snapshot/restore','POST',req,a);assert.equal(invalid.status,409,JSON.stringify(invalid.data));
  const restored=await call('/api/snapshot/restore','POST',{...req,snapshot:snapshot.data},a);assert.equal(restored.status,200,JSON.stringify(restored.data));
  assert.equal((await call(base,'GET',undefined,b)).data.deliverables.length,1);
  assert.equal((await call('/api/me','GET',undefined,a)).data.user.email,'a@local.test');
 }finally{db.close();}
});

test('DUPLA V5: copia diaria externa R2 real contra bucket simulado, privada, recuperable y sin repetición',async()=>{
 const objects=new Map(),bucket={async put(key,value){objects.set(key,Buffer.from(value));},async get(key){const value=objects.get(key);return value?{async arrayBuffer(){return value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength);}}:null;},async list(){return {objects:[...objects].map(([key,value])=>({key,size:value.length}))};}};
 const {db,app,call,initialize}=fixture({BACKUP_BUCKET:bucket});try{
  const [a,b]=await initialize();const p=await call('/api/projects','POST',{space:'couple',title:'Copia externa'},a);assert.equal(p.status,201);
  assert.equal((await call('/api/backups/status','GET')).status,401);
  const first=await app.processScheduledBackup();assert.equal(first.created,true);
  const again=await app.processScheduledBackup();assert.equal(again.created,false);
  const status=await call('/api/backups/status','GET',undefined,b);assert.equal(status.data.enabled,true);
  const list=await call('/api/backups/list','GET',undefined,a);assert.equal(list.status,200);assert.equal(list.data.objects.length,1);
  const actual=JSON.parse([...objects.values()][0].toString());assert.equal(actual.format,'dos-espacios-edge-v1');assert(actual.data.projects.some(x=>x.title==='Copia externa'));assert(!JSON.stringify(actual).includes('clave-super-a-1234'));
 }finally{db.close();}
});

test('DUPLA V5: briefing previsualizado, guardado atómico, idempotente y compartido',async()=>{
 const {db,call,initialize}=fixture();try{
  const [a,b]=await initialize();const proj=await call('/api/projects','POST',{space:'work',title:'Briefing funcional'},a),pid=proj.data.project.id;
  const brief='- Definir requisitos\n- Diseñar prototipo\n- Implementar aplicación';const path=`/api/projects/${pid}/operations/brief`;
  const preview=await call(path,'POST',{brief,confirm:false},a);assert.equal(preview.status,200);assert.equal(preview.data.tasks.length,3);
  assert.equal((await call('/api/projects/'+pid,'GET',undefined,b)).data.project.tasks.length,0);
  const created=await call(path,'POST',{brief,confirm:true},b);assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.task_ids.length,3);
  const replay=await call(path,'POST',{brief,confirm:true},a);assert.equal(replay.status,200);assert.equal(replay.data.created,false);
  const project=(await call('/api/projects/'+pid,'GET',undefined,a)).data.project;assert.equal(project.tasks.length,3);assert(project.sections.some(x=>x.content===brief));
  const backup=(await call('/api/snapshot','GET',undefined,a)).data;assert.equal(backup.data.brief_imports.length,1);
 }finally{db.close();}
});
