import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const TEST_DATA=mkdtempSync(join(tmpdir(),'dos-espacios-test-'));
const PORT=31000+Math.floor(Math.random()*2000);
const BASE=`http://127.0.0.1:${PORT}`;
const env={...process.env,DOS_DATA_DIR:TEST_DATA,HOST:'127.0.0.1',PORT:String(PORT),OPENAI_API_KEY:'',WORK_WEBHOOK_URL:''};
let server;
const testPasswordA='Test_One_2026_Secure!';const testPasswordB='Test_Two_2026_Secure!';
let cookieA='',cookieB='';
async function api(url,method='GET',body,who='a',expected=200){
 const opts={method,headers:{cookie:who==='a'?cookieA:cookieB}};
 if(body!==undefined){opts.headers['Content-Type']='application/json';opts.body=JSON.stringify(body);}
 const r=await fetch(BASE+url,opts);let data;
 try{data=await r.json();}catch{data={};}
 assert.equal(r.status,expected,`${method} ${url} expected ${expected} got ${r.status}: ${JSON.stringify(data)}`);
 return {data,response:r};
}
async function startServer(){
 const input=`a-test@example.invalid\n${testPasswordA}\nb-test@example.invalid\n${testPasswordB}\n`;
 const setup=spawnSync(process.execPath,['scripts/setup.mjs'],{cwd:ROOT,env,input,encoding:'utf8'});
 assert.equal(setup.status,0,setup.stderr);
 server=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env,stdio:'ignore'});
 for(let i=0;i<70;i++){
  if(server.exitCode!==null)throw Error('Server stopped unexpectedly');
  try{const r=await fetch(BASE+'/api/me');if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,70));
 }
 throw Error('Server did not start');
}
await test('DOS ESPACIOS 3: usuarios, ideas, proyectos, sincronización y recuperación',async t=>{
 await startServer();
 try{
  await t.test('dos usuarios privados y autenticación',async()=>{
   assert.equal((await api('/api/me')).data.configured,true);
   const a=await api('/api/login','POST',{email:'a-test@example.invalid',password:testPasswordA});
   cookieA=a.response.headers.get('set-cookie').split(';')[0];
   const b=await api('/api/login','POST',{email:'b-test@example.invalid',password:testPasswordB},'b');
   cookieB=b.response.headers.get('set-cookie').split(';')[0];
   assert.ok(cookieA!==cookieB);
   const unauthorized=await fetch(BASE+'/api/dashboard');assert.equal(unauthorized.status,401);
   assert.equal((await api('/api/dashboard')).data.users.length,2);
  });
  let projectId,ideaId,sectionId,taskId,versionId,decisionId;
  await t.test('buzón compartido y conversión en un solo proyecto',async()=>{
   const idea=(await api('/api/ideas','POST',{space:'work',title:'Web + marketing',body:'Un único proyecto profesional'},'a',201)).data.idea;
   ideaId=idea.id;
   const dash=(await api('/api/dashboard','GET',undefined,'b')).data;
   assert.equal(dash.ideas[0].id,ideaId);assert.ok(dash.unread>0);
   await api('/api/ideas/'+ideaId,'PATCH',{body:'Web y publicidad, visión de ambos',revision:1},'b');
   const converted=(await api('/api/ideas/'+ideaId+'/convert','POST',{},'a',201)).data.project;
   projectId=converted.id;assert.equal(converted.space,'work');
   await api('/api/ideas/'+ideaId+'/convert','POST',{},'b',409);
   assert.equal((await api('/api/projects/'+projectId,'GET',undefined,'b')).data.project.title,'Web + marketing');
  });
  await t.test('tareas, subtareas y cambios cruzados',async()=>{
   const task=(await api(`/api/projects/${projectId}/tasks`,'POST',{title:'Crear landing',assigned_to:null},'b',201)).data.item;
   taskId=task.id;
   await api('/api/tasks/'+taskId,'PATCH',{state:'doing',priority:'high',revision:1},'a');
   await api('/api/tasks/'+taskId,'PATCH',{title:'Edición obsoleta',revision:1},'b',409);
   await api('/api/tasks/'+taskId+'/checklist','POST',{title:'Validar boceto'},'b',201);
   const p=(await api('/api/projects/'+projectId)).data.project;
   assert.equal(p.tasks.find(t=>t.id===taskId).state,'doing');assert.equal(p.checklists.length,1);
  });
  await t.test('notas con conflictos y restauración',async()=>{
   const section=(await api(`/api/projects/${projectId}/sections`,'POST',{title:'Briefing',content:'Antes'},'a',201)).data.item;
   sectionId=section.id;
   await api('/api/sections/'+sectionId,'PATCH',{content:'Revisión Angie',revision:1},'b');
   await api('/api/sections/'+sectionId,'PATCH',{content:'Copia obsoleta',revision:1},'a',409);
   const versions=(await api(`/api/sections/${sectionId}/versions`)).data.versions;
   assert.equal(versions.length,1);versionId=versions[0].id;
   const restored=(await api(`/api/sections/${sectionId}/versions/${versionId}/restore`,'POST',{revision:2},'a')).data.item;
   assert.equal(restored.content,'Antes');assert.equal(restored.revision,3);
  });
  await t.test('decisiones y votaciones compartidas',async()=>{
   const item=(await api(`/api/projects/${projectId}/decisions`,'POST',{title:'¿Qué diseño elegimos?',choices:['Minimalista','Creativo']},'a',201)).data.item;
   decisionId=item.id;
   await api(`/api/decisions/${decisionId}/vote`,'POST',{choice_index:0},'a');
   await api(`/api/decisions/${decisionId}/vote`,'POST',{choice_index:1},'b');
   await api(`/api/decisions/${decisionId}/vote`,'POST',{choice_index:1},'a');
   const choices=(await api('/api/projects/'+projectId)).data.project.decisions[0];
   assert.equal(choices.votes.length,2);assert.equal(choices.votes.every(v=>v.choice_index===1),true);
   await api(`/api/decisions/${decisionId}/close`,'POST',{closed:true},'b');
   await api(`/api/decisions/${decisionId}/vote`,'POST',{choice_index:0},'a',409);
  });
  await t.test('eventos SSE recibidos por la otra cuenta',async()=>{
   const stream=await fetch(BASE+'/api/stream',{headers:{cookie:cookieB}});
   assert.equal(stream.status,200);
   const reader=stream.body.getReader();await reader.read();
   await api(`/api/projects/${projectId}/comments`,'POST',{content:'Cambio en directo'},'a',201);
   const chunk=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Sin evento SSE')),3000))]);
   assert.ok(new TextDecoder().decode(chunk.value).includes('event: change'));
   await reader.cancel();
  });
  await t.test('archivos y medidas de privacidad',async()=>{
   const blob=Buffer.from('archivo compartido de prueba');
   await api(`/api/projects/${projectId}/assets`,'POST',{name:'texto.txt',mime:'text/plain',base64:blob.toString('base64')},'b',201);
   const pr=(await api('/api/projects/'+projectId)).data.project;
   const asset=pr.assets.at(-1);assert.ok(asset);
   const file=await fetch(BASE+'/api/assets/'+asset.id,{headers:{cookie:cookieA}});
   assert.equal(file.status,200);assert.equal(await file.text(),blob.toString());
   const denied=await fetch(BASE+'/api/assets/'+asset.id);assert.equal(denied.status,401);
  });
  await t.test('presupuestos, hitos y modificaciones seguras',async()=>{
   const expense=(await api(`/api/projects/${projectId}/expenses`,'POST',{title:'Marketing',estimated:350,actual:75},'a',201)).data.item;
   await api('/api/expenses/'+expense.id,'PATCH',{actual:110,revision:expense.revision},'b');
   await api('/api/expenses/'+expense.id,'PATCH',{actual:90,revision:expense.revision},'a',409);
   const milestone=(await api(`/api/projects/${projectId}/milestones`,'POST',{title:'Lanzamiento',due_date:'2026-11-12'},'b',201)).data.item;
   await api('/api/milestones/'+milestone.id,'PATCH',{state:'doing',revision:milestone.revision},'a');
   const ev=(await api(`/api/projects/${projectId}/events`,'POST',{title:'Reunión',event_date:'2026-11-11'},'a',201)).data.item;
   await api('/api/events/'+ev.id,'PATCH',{location:'Online'},'b');
   const p=(await api('/api/projects/'+projectId)).data.project;
   assert.equal(p.expenses.at(-1).actual,110);assert.equal(p.milestones.at(-1).state,'doing');assert.equal(p.events.some(e=>e.id===ev.id),true);
  });
  await t.test('buscador por contenidos de las dos zonas',async()=>{
   const found=(await api('/api/search?q=landing')).data.results;
   assert.equal(found.tasks[0].project_id,projectId);
   await api('/api/search?q=a','GET',undefined,'a',400);
   const plan=(await api('/api/projects','POST',{space:'couple',title:'Viaje a Italia',template:'trip'},'b',201)).data.project;
   assert.equal((await api('/api/projects/'+plan.id)).data.project.sections.length>0,true);
   assert.equal((await api(`/api/projects/${plan.id}/ai`,'POST',{type:'ideas'},'a',403)).response.status,403);
  });
  await t.test('notificaciones por usuario y lectura',async()=>{
   const n=(await api('/api/notifications','GET',undefined,'b')).data;
   assert.ok(n.unread>0);
   await api('/api/notifications/read','POST',{},'b');
   assert.equal((await api('/api/notifications','GET',undefined,'b')).data.unread,0);
  });
  await t.test('biblioteca de conocimiento, trazabilidad y análisis con dos cuentas',async()=>{
   const item=(await api('/api/knowledge','POST',{space:'work',project_id:projectId,title:'Aprendizaje de lanzamiento',question:'¿Qué aprendimos?',answer:'Comprobar métricas de la campaña',source:'Prueba interna',tags:'marketing,web',status:'draft'},'a',201)).data.item;
   const entries=(await api('/api/knowledge','GET',undefined,'b')).data.entries;
   assert.ok(entries.some(x=>x.id===item.id));
   await api('/api/knowledge/'+item.id,'PATCH',{revision:item.revision,answer:'Revisar conversión y retención',status:'validated'},'b');
   await api('/api/knowledge/'+item.id,'PATCH',{revision:item.revision,answer:'texto obsoleto'},'a',409);
   const verified=(await api('/api/knowledge','GET',undefined,'a')).data.entries.find(x=>x.id===item.id);
   assert.equal(verified.status,'validated');assert.equal(verified.revision,2);
   const report=(await api('/api/analytics')).data;
   assert.ok(report.totals.projects>=1 && report.totals.tasks>=1 && report.totals.knowledge>=1);
   assert.ok(report.trend.some(x=>x.changes>0));
   const personal=(await api('/api/knowledge','POST',{space:'couple',title:'Plan conjunto',question:'¿Dónde cenamos?'},'b',201)).data.item;
   const work=(await api('/api/analytics?space=work')).data;
   assert.equal(work.totals.knowledge,1);
   await api('/api/knowledge/'+personal.id,'DELETE',undefined,'a');
   assert.equal((await api('/api/knowledge?space=couple')).data.entries.length,0);
   const forbidden=await fetch(BASE+'/api/knowledge');assert.equal(forbidden.status,401);
   const guardianUnauthorized=await fetch(BASE+'/api/guardian/report');assert.equal(guardianUnauthorized.status,401);
   const guardian=(await api('/api/guardian/report')).data;assert.equal(guardian.available,false);
   await api('/api/knowledge','POST',{space:'couple',project_id:projectId,title:'mal espacio'},'a',400);
  });
  await t.test('archivo reversible y recuperación de proyectos',async()=>{
   const before=(await api('/api/projects/'+projectId)).data.project;
   await api('/api/projects/'+projectId,'PATCH',{archived:true,revision:before.revision},'a');
   assert.equal((await api('/api/archives')).data.projects.some(x=>x.id===projectId),true);
   assert.equal((await api('/api/dashboard')).data.projects.find(x=>x.id===projectId).archived,1);
   await api('/api/archives/'+projectId+'/restore','POST',{},'b');
   assert.equal((await api('/api/projects/'+projectId)).data.project.archived,0);
  });
  await t.test('papelera reversible y exclusión de búsquedas',async()=>{
   await api('/api/projects/'+projectId,'DELETE',{},'a');
   assert.equal((await api('/api/trash','GET',undefined,'b')).data.projects.some(x=>x.id===projectId),true);
   await api('/api/projects/'+projectId,'GET',undefined,'b',404);
   assert.equal((await api('/api/search?q=landing')).data.results.tasks.length,0);
   await api('/api/trash/'+projectId+'/restore','POST',{},'b');
   assert.equal((await api('/api/projects/'+projectId)).data.project.title,'Web + marketing');
  });
  await t.test('exportación y privacidad de accesos',async()=>{
   const backup=(await api('/api/export')).data;
   assert.ok(backup.projects.some(x=>x.id===projectId));
   assert.equal((await api('/api/calendar.ics')).response.headers.get('content-type').startsWith('text/calendar'),true);
   await api('/api/password','POST',{current:'wrong',next:'This_is_a_new_password_123'},'b',403);
   await api('/api/projects','POST',{space:'invalid',title:'no'},'a',400);
  });
 }finally{server.kill('SIGTERM');}
});
try{rmSync(TEST_DATA,{recursive:true,force:true});}catch{}
