import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(sql,...bindings){
  if(!bindings.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
  const rows=reader?stmt.all(...bindings):[];
  const changes=reader?0:stmt.run(...bindings).changes;
  return {toArray:()=>rows,rowsWritten:changes};
 }},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(err){db.exec('ROLLBACK');throw err;}}};
 const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64)},{getWebSockets:()=>[],waitUntil(){}});
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

test('DUPLA: dependencias, bloqueo, recurrencia, persistencia desde la otra cuenta, ciclos y conflicto de versión',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const project=await call('/api/projects','POST',{space:'work',title:'Trabajo operativo'},a);assert.equal(project.status,201);const id=project.data.project.id;
 const one=await call(`/api/projects/${id}/tasks`,'POST',{title:'Revisar requisitos'},a);assert.equal(one.status,201);const first=one.data.item.id;
 const two=await call(`/api/projects/${id}/tasks`,'POST',{title:'Publicar',blocked_by:first,recurrence:'weekly',due_date:'2026-11-05'},b);assert.equal(two.status,201,JSON.stringify(two.data));const second=two.data.item.id;
 assert.equal((await call('/api/tasks/'+second,'PATCH',{state:'done',revision:1},b)).status,409,'No completar si falta dependencia');
 assert.equal((await call('/api/tasks/'+first,'PATCH',{blocked_by:second,revision:1},a)).status,400,'Impedir ciclos');
 assert.equal((await call('/api/tasks/'+first,'PATCH',{state:'done',revision:1},a)).status,200);
 const complete=await call('/api/tasks/'+second,'PATCH',{state:'done',revision:1},b);assert.equal(complete.status,200,JSON.stringify(complete.data));assert(complete.data.next_task_id);
 const saved=(await call(`/api/projects/${id}`,'GET',undefined,a)).data.project;
 const next=saved.tasks.find(t=>t.id===complete.data.next_task_id);
 assert(next&&next.state==='todo'&&next.recurrence==='weekly'&&next.due_date==='2026-11-12');
 assert.equal((await call('/api/tasks/'+second,'PATCH',{state:'done',revision:1},a)).status,409,'Conflicto concurrente no duplica recurrencia');
 assert.equal((await call(`/api/projects/${id}`,'GET',undefined,b)).data.project.tasks.length,3);
 const deleted=await call('/api/tasks/'+first,'DELETE',undefined,a);assert.equal(deleted.status,200);assert.equal((await call(`/api/projects/${id}`,'GET',undefined,b)).data.project.tasks.find(t=>t.id===second).blocked_by,null);
 }finally{db.close();}
});

test('DUPLA: recordatorios idempotentes, privadas, persisten y se leen desde el segundo usuario',async()=>{
 const {db,app,call,initialize}=fixture();try{
 const [a,b]=await initialize();const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const project=await call('/api/projects','POST',{space:'couple',title:'Viaje de prueba'},a);const pid=project.data.project.id;
 assert.equal((await call(`/api/projects/${pid}/tasks`,'POST',{title:'Billetes pendientes',due_date:today},a)).status,201);
 const first=await call('/api/reminders/run','POST',{},b);assert.equal(first.status,200);assert.equal(first.data.sent,2);
 const again=await call('/api/reminders/run','POST',{},a);assert.equal(again.data.sent,0);
 const notices=await call('/api/notifications','GET',undefined,b);assert.equal(notices.status,200);
 assert(notices.data.items.some(n=>n.action==='recordatorio de tarea'&&n.detail.includes('Billetes pendientes')));
 assert.equal((await call('/api/reminders/run','POST',{})).status,401);
 }finally{db.close();}
});

test('DUPLA: copia/restauración completa con autorización y transacción, rechazo de ajenos y copia manipulada',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const project=await call('/api/projects','POST',{space:'work',title:'Proyecto a recuperar'},a);assert.equal(project.status,201);
 const id=project.data.project.id;
 const task=await call(`/api/projects/${id}/tasks`,'POST',{title:'Tarea a restaurar',recurrence:'monthly'},b);assert.equal(task.status,201);
 const snapshot=await call('/api/snapshot','GET',undefined,a);assert.equal(snapshot.status,200);
 const backup=snapshot.data;assert.equal(backup.format,'dos-espacios-edge-v1');assert.equal(backup.data.tasks.length,1);
 assert.equal((await call('/api/snapshot/restore','POST',{snapshot:backup,password:'incorrecto',confirmation:'RESTAURAR DUPLA'},a)).status,403);
 const damaged=structuredClone(backup);damaged.data.tasks.push({...damaged.data.tasks[0],id:'invalid-task',project_id:'missing-parent'});
 assert.notEqual((await call('/api/snapshot/restore','POST',{snapshot:damaged,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},a)).status,200);
 assert.equal((await call(`/api/projects/${id}`,'GET',undefined,b)).data.project.tasks.length,1,'Restauración inválida conserva datos');
 assert.equal((await call(`/api/projects/${id}`,'DELETE',undefined,a)).status,200);
 const restored=await call('/api/snapshot/restore','POST',{snapshot:backup,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},a);
 assert.equal(restored.status,200,JSON.stringify(restored.data));
 const after=await call(`/api/projects/${id}`,'GET',undefined,b);assert.equal(after.status,200);assert.equal(after.data.project.tasks[0].recurrence,'monthly');
 const alien=structuredClone(backup);alien.users[0].email='intruso@example.com';assert.equal((await call('/api/snapshot/restore','POST',{snapshot:alien,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},a)).status,409);
 assert.equal((await call('/api/snapshot/restore','POST',{snapshot:backup,password:'clave-super-a-1234',confirmation:'RESTAURAR DUPLA'},undefined)).status,401);
 }finally{db.close();}
});

test('DUPLA: búsqueda de conocimiento, decisiones, enlaces y adjuntos con sesión privada',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const project=(await call('/api/projects','POST',{space:'work',title:'Plan de producto'},a)).data.project;
 const pid=project.id;
 assert.equal((await call('/api/knowledge','POST',{space:'work',project_id:pid,title:'Arquitectura segura',answer:'Cifrado completo'},a)).status,201);
 assert.equal((await call(`/api/projects/${pid}/links`,'POST',{label:'Figma prototipo',url:'https://figma.com/file/test'},b)).status,201);
 assert.equal((await call(`/api/projects/${pid}/decisions`,'POST',{title:'Elegir paleta visual',choices:['Azul','Crema']},b)).status,201);
 const noAuth=await call('/api/search?q=figma');assert.equal(noAuth.status,401);
 const forA=await call('/api/search?q=figma','GET',undefined,a);assert.equal(forA.status,200,JSON.stringify(forA.data));assert.equal(forA.data.results.links.length,1);
 const forB=await call('/api/search?q=segura','GET',undefined,b);assert.equal(forB.data.results.knowledge.length,1);
 const decisions=await call('/api/search?q=paleta','GET',undefined,a);assert.equal(decisions.data.results.decisions.length,1);
 const history=await call('/api/integrations/history','GET',undefined,b);assert.equal(history.status,200);assert.deepEqual(history.data.items,[]);
 assert.equal((await call('/api/integrations/history')).status,401);
 }finally{db.close();}
});

test('DUPLA: Director General encuentra incidencias laborales reales y las convierte en tareas sin duplicar ni leer planes personales',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const w=(await call('/api/projects','POST',{space:'work',title:'Proyecto de IA'},a)).data.project;
 const c=(await call('/api/projects','POST',{space:'couple',title:'Escapada privada'},b)).data.project;
 const issues=await call('/api/guardian/insights','GET',undefined,b);
 assert.equal(issues.status,200);assert(issues.data.issues.some(x=>x.project_id===w.id&&x.type==='empty'));
 assert(!issues.data.issues.some(x=>x.project_id===c.id),'Nunca incluye Planes en común');
 const actionable=issues.data.issues.find(x=>x.project_id===w.id&&x.type==='empty');
 const create=await call('/api/guardian/insights/create-task','POST',{id:actionable.id},a);
 assert.equal(create.status,201,JSON.stringify(create.data));
 const project=await call('/api/projects/'+w.id,'GET',undefined,b);assert(project.data.project.tasks.some(x=>x.title==='Definir primeros pasos del proyecto'));
 const newIssues=await call('/api/guardian/insights','GET',undefined,a);assert(!newIssues.data.issues.some(x=>x.id===actionable.id));
 assert.equal((await call('/api/guardian/insights/create-task','POST',{id:actionable.id},a)).status,409);
 assert.equal((await call('/api/guardian/insights')).status,401);
 }finally{db.close();}
});

test('DUPLA: plan conjunto guarda hora, reserva, referencia y rechaza horarios incorrectos',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const project=(await call('/api/projects','POST',{space:'couple',title:'Budapest'},a)).data.project;
 const event=await call('/api/projects/'+project.id+'/events','POST',{title:'Crucero nocturno',event_date:'2026-12-12',event_time:'19:30',location:'Danubio',booking_status:'booked',booking_reference:'RES-123'},b);
 assert.equal(event.status,201,JSON.stringify(event.data));
 assert.equal((await call('/api/projects/'+project.id+'/events','POST',{title:'Horario inválido',event_date:'2026-12-12',event_time:'25:99'},b)).status,400);
 const after=(await call('/api/projects/'+project.id,'GET',undefined,a)).data.project;assert.equal(after.events[0].event_time,'19:30');assert.equal(after.events[0].booking_reference,'RES-123');
 assert.equal((await call('/api/events/'+after.events[0].id,'PATCH',{event_time:'20:00',booking_status:'pending',booking_reference:''},a)).status,200);
 const final=(await call('/api/projects/'+project.id,'GET',undefined,b)).data.project.events[0];assert.equal(final.event_time,'20:00');assert.equal(final.booking_status,'pending');
 }finally{db.close();}
});

test('DUPLA: migración de la base antigua preserva proyectos, usuarios, tareas y planes',async()=>{
 const {schema}=await import('../edge/schema.mjs');
 const {createDB}=await import('../edge/db.mjs');
 const db=new DatabaseSync(':memory:');db.exec(schema);db.exec('PRAGMA foreign_keys=ON');
 const uid='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',pid='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',tid='cccccccc-cccc-4ccc-cccc-cccccccccccc',eid='dddddddd-dddd-4ddd-dddd-dddddddddddd';
 db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(uid,'Álvaro','a@local.test','hash-antiguo','2026-10-01');
 db.prepare('INSERT INTO projects(id,space,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(pid,'couple','Viaje anterior','2026-10-01','2026-10-01');
 db.prepare('INSERT INTO tasks(id,project_id,title,created_at,updated_at) VALUES(?,?,?,?,?)').run(tid,pid,'Comprar billetes','2026-10-01','2026-10-01');
 db.prepare('INSERT INTO events(id,project_id,title,event_date,created_at) VALUES(?,?,?,?,?)').run(eid,pid,'Cena reservada','2026-12-12','2026-10-01');
 const storage={sql:{exec(query,...args){if(!args.length&&/;\s*\S/.test(query.trim().replace(/;\s*$/,''))){db.exec(query);return {toArray:()=>[],rowsWritten:0};}const st=db.prepare(query);const read=/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query);return read?{toArray:()=>st.all(...args),rowsWritten:0}:{toArray:()=>[],rowsWritten:st.run(...args).changes};}},transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 try{
  const store=createDB(storage);
  assert.equal(store.get('SELECT title FROM projects WHERE id=?',pid).title,'Viaje anterior');
  assert.equal(store.get('SELECT title,recurrence,blocked_by FROM tasks WHERE id=?',tid).recurrence,'none');
  assert.equal(store.get('SELECT title,event_time,booking_status FROM events WHERE id=?',eid).booking_status,'pending');
  assert.equal(store.get('SELECT email,password_hash FROM users WHERE id=?',uid).password_hash,'hash-antiguo');
  assert.equal(store.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='integration_runs'").n,1);
 }finally{db.close();}
});

test('DUPLA: las recurrencias del día 31 respetan el último día en febrero y vuelven al 31 en marzo',async()=>{
 const {db,call,initialize}=fixture();try{
 const [a,b]=await initialize();
 const project=(await call('/api/projects','POST',{space:'work',title:'Cierre mensual'},a)).data.project;
 const original=(await call(`/api/projects/${project.id}/tasks`,'POST',{title:'Cierre mensual',recurrence:'monthly',due_date:'2027-01-31'},a)).data.item;
 const feb=await call('/api/tasks/'+original.id,'PATCH',{state:'done',revision:1},a);
 assert.equal(feb.status,200,JSON.stringify(feb.data));
 const taskFeb=(await call('/api/projects/'+project.id,'GET',undefined,b)).data.project.tasks.find(t=>t.id===feb.data.next_task_id);
 assert.equal(taskFeb.due_date,'2027-02-28');
 const march=await call('/api/tasks/'+taskFeb.id,'PATCH',{state:'done',revision:1},b);
 assert.equal(march.status,200,JSON.stringify(march.data));
 const taskMarch=(await call('/api/projects/'+project.id,'GET',undefined,a)).data.project.tasks.find(t=>t.id===march.data.next_task_id);
 assert.equal(taskMarch.due_date,'2027-03-31');
 }finally{db.close();}
});
