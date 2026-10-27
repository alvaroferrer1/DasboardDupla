import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApi } from '../edge/api.mjs';
import { decryptToken, encryptToken, toGoogleEvent } from '../edge/google-calendar.mjs';

const env={SETUP_TOKEN:'S'.repeat(64),PUBLIC_ORIGIN:'https://dupla.test',GOOGLE_CLIENT_ID:'test-client-id',GOOGLE_CLIENT_SECRET:'test-client-secret',INTEGRATION_ENCRYPTION_KEY:'integration-master-key-for-tests-not-production',RESEND_API_KEY:'test-resend',NOTIFY_FROM_EMAIL:'avisos@dupla.test'};
function harness(file=':memory:',override={}){
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');const websockets=[];
 const storage={sql:{exec(sql,...args){if(!args.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?stmt.all(...args):[];const changes=reader?0:stmt.run(...args).changes;return {toArray:()=>rows,rowsWritten:changes};}},transactionSync(fn){db.exec('BEGIN');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const ctx={getWebSockets:()=>websockets};const app=createApi(storage,{...env,...override},ctx);
 async function call(url,method='GET',body,cookie,headersOverride={}){
  const headers=new Headers({host:'dupla.test',origin:'https://dupla.test',...headersOverride});if(cookie)headers.set('cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const raw=new Request('https://dupla.test'+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let resolve;const promise=new Promise(r=>resolve=r);let code=200,consumed=false;const responseHeaders=new Headers();
  const req={method,headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(consumed)return;consumed=true;const bytes=await raw.arrayBuffer();if(bytes.byteLength)yield Buffer.from(bytes);}};
  const res={headersSent:false,writableEnded:false,writeHead(n,h={}){this.headersSent=true;code=n;for(const[k,v]of Object.entries(h))responseHeaders.set(k,v);},end(value){this.writableEnded=true;resolve(new Response(value??null,{status:code,headers:responseHeaders}));}};
  try{await app.api(req,res,new URL(raw.url));}catch(ex){if(!res.headersSent)res.writeHead(ex.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:ex.status?ex.message:'Error interno del servidor'}));}
  const result=await promise;let data;try{data=await result.clone().json();}catch{};return {status:result.status,data,cookie:result.headers.get('set-cookie'),headers:result.headers,raw:result};
 }
 async function accounts(){
  const r=await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'A-contraseña-segura-2026',password_b:'B-contraseña-segura-2026'});assert.equal(r.status,201,JSON.stringify(r.data));
  const a=await call('/api/login','POST',{email:'a@dupla.test',password:'A-contraseña-segura-2026'});const b=await call('/api/login','POST',{email:'b@dupla.test',password:'B-contraseña-segura-2026'});
  assert.equal(a.status,200);assert.equal(b.status,200);return [a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,ctx,app,call,accounts,websockets};
}

test('PERSISTENCIA REAL: SQLite sobreviviendo reinicios del servidor, sesión, cambios de ambas cuentas y archivos',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dupla-persist-'));const file=join(folder,'storage.sqlite');try{
  let t=harness(file),[a,b]=await t.accounts();
  const project=await t.call('/api/projects','POST',{space:'couple',title:'Plan compartido'},a);assert.equal(project.status,201,JSON.stringify(project.data));const id=project.data.project.id;
  const note=await t.call(`/api/projects/${id}/sections`,'POST',{title:'Billetes',content:'Plan de prueba'},a);assert.equal(note.status,201);
  const task=await t.call(`/api/projects/${id}/tasks`,'POST',{title:'Comprar billetes'},b);assert.equal(task.status,201);
  const bytes=Buffer.from('Archivo guardado dentro del Durable Object SQLite, no en el navegador.');
  const upload=await t.call(`/api/projects/${id}/assets`,'POST',{name:'datos.txt',mime:'text/plain',base64:bytes.toString('base64')},a);assert.equal(upload.status,201,JSON.stringify(upload.data));
  const snapshot=await t.call('/api/snapshot','GET',undefined,a);assert.equal(snapshot.status,200);assert.equal(snapshot.data.files.length,1);
  // New object + new DB connection: neither memory cache nor browser localStorage participates.
  t.db.close();t=harness(file);
  const restored=await t.call(`/api/projects/${id}`,'GET',undefined,b);assert.equal(restored.status,200);assert.equal(restored.data.project.tasks[0].title,'Comprar billetes');assert.equal(restored.data.project.sections[0].content,'Plan de prueba');
  const asset=restored.data.project.assets[0];const downloaded=await t.call(`/api/assets/${asset.id}`,'GET',undefined,b);assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.raw.arrayBuffer()),bytes);
  await t.call(`/api/tasks/${task.data.item.id}`,'PATCH',{revision:1,state:'done'},a);
  t.db.close();t=harness(file);const again=await t.call(`/api/projects/${id}`,'GET',undefined,b);assert.equal(again.data.project.tasks[0].state,'done');
  assert.equal((await t.call('/api/snapshot/restore','POST',{confirmation:'RESTAURAR DUPLA',password:'B-contraseña-segura-2026',snapshot:snapshot.data},b)).status,200);
  assert.equal((await t.call(`/api/projects/${id}`,'GET',undefined,a)).data.project.tasks[0].state,'todo');
  const fromRestored=await t.call(`/api/assets/${asset.id}`,'GET',undefined,a);assert.deepEqual(Buffer.from(await fromRestored.raw.arrayBuffer()),bytes);t.db.close();
 }finally{rmSync(folder,{recursive:true,force:true});}
});

test('WEBSOCKET: comunica cambios solo a sesiones activas y después de revocar sesión cierra el socket',async()=>{
 const h=harness();try{const [a,b]=await h.accounts();const users=h.db.prepare('SELECT user_id,token_hash FROM sessions ORDER BY rowid').all();assert.equal(users.length,2);
 const events=[];const sockets=users.map(x=>({deserializeAttachment:()=>({sessionHash:x.token_hash}),send:m=>events.push({uid:x.user_id,m:JSON.parse(m)}),close(){this.closed=true;}}));h.websockets.push(...sockets);
 const p=await h.call('/api/projects','POST',{space:'work',title:'Trabajo con edición simultánea'},a);assert.equal(p.status,201);assert.equal(events.length,2,'se notifica a las dos sesiones activas');
 h.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(users[0].token_hash);
 const id=p.data.project.id;const task=await h.call(`/api/projects/${id}/tasks`,'POST',{title:'Revisar'},b);assert.equal(task.status,201);assert.equal(sockets[0].closed,true,'socket de sesión revocada cerrado');assert.equal(events.at(-1).uid,users[1].user_id);
 }finally{h.db.close();}
});

test('GOOGLE OAuth: estado anti-replay, PKCE, tokens cifrados, sincronización idempotente, importación y aislamiento entre cuentas',async()=>{
 const old=globalThis.fetch,requests=[];globalThis.fetch=async(url,options={})=>{
  requests.push({url:String(url),method:options.method,body:options.body});
  if(String(url).endsWith('/token'))return Response.json({access_token:'google-access-secret',refresh_token:'google-refresh-secret',expires_in:3600,scope:'calendar.events'});
  if(String(url).includes('www.googleapis.com/calendar/v3/calendars/1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7%40group.calendar.google.com/events')){
   if(options.method==='GET'&&String(url).endsWith('/ext123'))return Response.json({id:'ext123',summary:'Reunión de diseño',start:{date:'2026-11-20'},location:'Online'});
   if(options.method==='GET')return Response.json({items:[{id:'ext123',summary:'Reunión de diseño',start:{date:'2026-11-20'},location:'Online'}]});
   return Response.json({id:'ext123',status:'confirmed'});
  }
  throw Error('Red externa inesperada: '+url);
 };
 const h=harness();try{const [a,b]=await h.accounts();
  assert.equal((await h.call('/api/google/start','POST',{},undefined)).status,401);
  const start=await h.call('/api/google/start','POST',{},a);assert.equal(start.status,200,JSON.stringify(start.data));const url=new URL(start.data.url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  const state=url.searchParams.get('state');const callback=await h.call('/api/google/callback?state='+state+'&code=approved');assert.equal(callback.status,302);
  const replay=await h.call('/api/google/callback?state='+state+'&code=approved');assert.equal(replay.status,400);
  const encrypted=h.db.prepare('SELECT encrypted_token FROM google_connections').get().encrypted_token;assert(!encrypted.includes('google-access-secret')&&!encrypted.includes('google-refresh-secret'));
  assert.equal((await h.call('/api/google/status','GET',undefined,a)).data.connected,true);
  assert.equal((await h.call('/api/google/status','GET',undefined,b)).data.connected,false);
  const id=(await h.call('/api/projects','POST',{space:'couple',title:'Fechas personales'},a)).data.project.id;
  const evt=await h.call(`/api/projects/${id}/events`,'POST',{title:'Visita cultural',event_date:'2026-12-12',event_time:'19:30',location:'Museo'},a);
  const eid=evt.data.item.id;
  assert.equal((await h.call(`/api/google/sync/${eid}`,'POST',{},b)).status,409,'otra cuenta no accede al Google Calendar de Álvaro');
  assert.equal((await h.call(`/api/google/sync/${eid}`,'POST',{},a)).status,200);
  assert.equal((await h.call(`/api/google/sync/${eid}`,'POST',{},a)).status,200);
  assert.equal(requests.filter(x=>x.method==='POST'&&x.url.includes('/calendar/v3/')).length,1,'segunda sync usa PUT para actualizar, no duplica eventos');
  const job=(await h.call('/api/projects','POST',{space:'work',title:'Proyecto profesional'},b)).data.project.id;
  const imported=await h.call('/api/google/import','POST',{project_id:job,google_id:'ext123'},a);assert.equal(imported.status,201,JSON.stringify(imported.data));
  assert.equal((await h.call('/api/google/import','POST',{project_id:job,google_id:'ext123'},a)).data.created,false);
  const snap=await h.call('/api/snapshot','GET',undefined,a);assert(!JSON.stringify(snap.data).includes('google-access-secret'));
  assert.equal((await h.call('/api/google/disconnect','POST',{},a)).status,200);
  assert.equal((await h.call('/api/google/status','GET',undefined,a)).data.connected,false);
 }finally{globalThis.fetch=old;h.db.close();}
});

test('AVISOS EXTERNOS: no envía sin consentimiento, separa Trabajo/Planes, evita duplicados y entrega a correo propio',async()=>{
 const old=globalThis.fetch,mail=[];globalThis.fetch=async(url,params)=>{assert.equal(url,'https://api.resend.com/emails');mail.push(JSON.parse(params.body));return Response.json({id:'email-ok'});};
 const h=harness();try{const [a,b]=await h.accounts();
  assert.equal((await h.call('/api/notifications/preferences','POST',{email_enabled:true,work_enabled:true,couple_enabled:false},a)).status,200);
  const w=(await h.call('/api/projects','POST',{space:'work',title:'Proyecto'} ,a)).data.project.id;
  const c=(await h.call('/api/projects','POST',{space:'couple',title:'Viaje'},b)).data.project.id;
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assert.equal((await h.call(`/api/projects/${w}/tasks`,'POST',{title:'Urgente',due_date:today},b)).status,201);
  assert.equal((await h.call(`/api/projects/${c}/tasks`,'POST',{title:'Sorpresa',due_date:today},b)).status,201);
  const run=await h.call('/api/reminders/run','POST',{},a);assert.equal(run.status,200,JSON.stringify(run.data));
  assert.equal(mail.length,2,'envía el cambio de Trabajo y su recordatorio, ambos solo a Álvaro');assert.deepEqual(mail[0].to,['a@dupla.test']);assert(!JSON.stringify(mail).includes('Sorpresa'));
  assert.equal((await h.call('/api/reminders/run','POST',{},a)).data.external.sent,0,'repetir no envía emails duplicados');
  assert.equal((await h.call('/api/notifications/preferences','POST',{email_enabled:false,work_enabled:false,couple_enabled:false},a)).status,200);
  assert.equal((await h.call('/api/notifications/preferences','GET',undefined,a)).data.email_enabled,false);
 }finally{globalThis.fetch=old;h.db.close();}
});

test('CIFRADO: token OAuth no puede descifrarse con otra clave; fecha Google all-day con final exclusivo',async()=>{
 const value=await encryptToken(env,{access_token:'hola'});assert.deepEqual(await decryptToken(env,value),{access_token:'hola'});
 await assert.rejects(decryptToken({...env,INTEGRATION_ENCRYPTION_KEY:'clave-completamente-distinta-para-prueba'},value));
 const evt=toGoogleEvent({title:'Prueba',event_date:'2026-12-31'});assert.equal(evt.start.date,'2026-12-31');assert.equal(evt.end.date,'2027-01-01');
});

test('DIRECTOR GENERAL: revisión proactiva en Trabajo, sin espiar Planes ni duplicar avisos',async()=>{
 const h=harness();try{const[a,b]=await h.accounts();const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const work=(await h.call('/api/projects','POST',{space:'work',title:'Trabajo bajo control'},a)).data.project.id;
 const personal=(await h.call('/api/projects','POST',{space:'couple',title:'Viaje privado'},b)).data.project.id;
 const old='2020-04-01';
 assert.equal((await h.call(`/api/projects/${work}/tasks`,'POST',{title:'Retraso de proyecto',due_date:old},a)).status,201);
 assert.equal((await h.call(`/api/projects/${personal}/tasks`,'POST',{title:'Recordatorio personal secreto',due_date:old},b)).status,201);
 const run=await h.call('/api/guardian/review','POST',{},a);assert.equal(run.status,200,JSON.stringify(run.data));assert.equal(run.data.notices,2);
 const second=await h.call('/api/guardian/review','POST',{},b);assert.equal(second.data.notices,0);
 const notices=await h.call('/api/notifications','GET',undefined,b);
 assert(notices.data.items.some(n=>n.action.includes('Director General')));
 assert(!notices.data.items.some(n=>n.action.includes('Director General')&&n.detail.includes('secreto')));
 assert.equal((await h.call(`/api/projects/${personal}`,'GET',undefined,a)).status,200);
 assert.equal((await h.call('/api/guardian/review','POST',{},undefined)).status,401);
 }finally{h.db.close();}
});

test('GOOGLE: una conexión sin claves OAuth no puede activarse ni acepta importaciones no autorizadas',async()=>{
 const h=harness(':memory:',{GOOGLE_CLIENT_ID:'',GOOGLE_CLIENT_SECRET:''});try{const[a]=await h.accounts();
 assert.equal((await h.call('/api/google/status','GET',undefined,a)).data.available,false);
 assert.equal((await h.call('/api/google/start','POST',{},a)).status,503);
 assert.equal((await h.call('/api/google/import','POST',{project_id:'not-real',google_id:'123'},a)).status,404);
 }finally{h.db.close();}
});

test('FIGMA/CANVA OAuth real de API con simulación: dos cuentas, PKCE, cifrado, enlaces guardados sin duplicar',async()=>{
 const old=globalThis.fetch, calls=[];
 globalThis.fetch=async(url,options={})=>{
  const dest=String(url);calls.push({url:dest,method:options.method||'GET'});
  if(dest.includes('/oauth/token'))return Response.json({access_token:'external-secret-access',refresh_token:'external-secret-refresh',expires_in:3600});
  if(dest.includes('api.figma.com/v1/files/ABC12345/meta'))return Response.json({file:{name:'UI profesionales'}});
  if(dest.includes('api.canva.com/rest/v1/designs'))return Response.json({items:[{id:'CANVA1234',title:'Cartel compartido',urls:{edit_url:'https://www.canva.com/design/CANVA1234/edit'}}]});
  throw Error('Llamada externa inesperada: '+dest);
 };
 const h=harness(':memory:',{FIGMA_CLIENT_ID:'figma-client',FIGMA_CLIENT_SECRET:'figma-secret',CANVA_CLIENT_ID:'canva-client',CANVA_CLIENT_SECRET:'canva-secret'});
 try{
  const[a,b]=await h.accounts();
  for(const provider of ['figma','canva']){
   assert.equal((await h.call(`/api/design/${provider}/start`,'POST',{},undefined)).status,401);
   assert.equal((await h.call(`/api/design/${provider}/status`,'GET',undefined,a)).data.connected,false);
   const start=await h.call(`/api/design/${provider}/start`,'POST',{},a);assert.equal(start.status,200,JSON.stringify(start.data));
   const auth=new URL(start.data.url);assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
   const state=auth.searchParams.get('state');assert(state.length>=40);
   assert.equal((await h.call(`/api/design/${provider}/callback?state=${state}&code=authorized`)).status,302);
   assert.equal((await h.call(`/api/design/${provider}/callback?state=${state}&code=authorized`)).status,400,'Estado OAuth no es reutilizable');
   assert.equal((await h.call(`/api/design/${provider}/status`,'GET',undefined,a)).data.connected,true);
   assert.equal((await h.call(`/api/design/${provider}/status`,'GET',undefined,b)).data.connected,false,'conexión limitada a la cuenta que autoriza');
  }
  const encrypted=h.db.prepare('SELECT encrypted_token FROM design_connections').all();assert.equal(encrypted.length,2);assert(encrypted.every(x=>!x.encrypted_token.includes('external-secret')));
  const project=(await h.call('/api/projects','POST',{space:'work',title:'Web corporativa'},a)).data.project.id;
  assert.equal((await h.call('/api/design/figma/import','POST',{url:'https://www.figma.com/design/ABC12345/Mi-panel',project_id:project},b)).status,409,'segunda cuenta necesita su conexión personal');
  const check=await h.call('/api/design/figma/check?url='+encodeURIComponent('https://www.figma.com/design/ABC12345/Mi-panel'),'GET',undefined,a);
  assert.equal(check.status,200,'Debe probar acceso real a Figma sin modificar el proyecto');assert.equal(check.data.title,'UI profesionales');
  assert.equal((await h.call('/api/design/figma/check?url='+encodeURIComponent('https://www.figma.com/design/ABC12345/Mi-panel'),'GET',undefined,b)).status,409,'No usar OAuth de la otra cuenta');
  const figma=await h.call('/api/design/figma/import','POST',{url:'https://www.figma.com/design/ABC12345/Mi-panel',project_id:project},a);assert.equal(figma.status,201,JSON.stringify(figma.data));
  assert.equal((await h.call('/api/design/figma/import','POST',{url:'https://www.figma.com/design/ABC12345/Mi-panel',project_id:project},a)).data.created,false);
  assert.equal((await h.call('/api/design/figma/import','POST',{url:'http://evil.example/design/ABC12345/',project_id:project},a)).status,400,'impide importar enlaces de orígenes ajenos');
  const listed=await h.call('/api/design/canva/list','GET',undefined,a);assert.equal(listed.data.items[0].title,'Cartel compartido');
  const canva=await h.call('/api/design/canva/import','POST',{design_id:'CANVA1234',project_id:project},a);assert.equal(canva.status,201,JSON.stringify(canva.data));
  assert.equal((await h.call('/api/design/canva/import','POST',{design_id:'CANVA1234',project_id:project},a)).data.created,false);
  assert.equal((await h.call('/api/design/canva/import','POST',{design_id:'INVENTADO',project_id:project},a)).status,404);
  const detail=await h.call('/api/projects/'+project,'GET',undefined,b);assert.equal(detail.data.project.links.length,2,'ambos diseños se ven desde otra cuenta');
  const backup=await h.call('/api/snapshot','GET',undefined,a);assert(!JSON.stringify(backup.data).includes('external-secret'));
  assert.equal((await h.call('/api/design/figma/disconnect','POST',{},a)).status,200);
  assert.equal((await h.call('/api/design/figma/status','GET',undefined,a)).data.connected,false);
  assert(calls.some(x=>x.url.includes('api.figma.com/v1/files/ABC12345/meta')));
 }finally{globalThis.fetch=old;h.db.close();}
});

test('WEB PUSH VAPID: opt-in, endpoint permitido, firma ES256, privacidad, envío único y revocación',async()=>{
 const {generateKeyPairSync}=await import('node:crypto');
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=privateKey.export({format:'jwk'}),pub=publicKey.export({format:'jwk'});
 const encoded=x=>Buffer.from(x,'base64url');const publicString=Buffer.concat([Buffer.from([4]),encoded(pub.x),encoded(pub.y)]).toString('base64url');
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts={})=>{calls.push({url:String(url),opts});return new Response('',{status:201});};
 const h=harness(':memory:',{PUSH_VAPID_PRIVATE_JWK:JSON.stringify(jwk),PUSH_VAPID_PUBLIC_KEY:publicString,PUSH_VAPID_SUBJECT:'mailto:avisos@dupla.test',RESEND_API_KEY:''});
 try{
  const [a,b]=await h.accounts();
  assert.equal((await h.call('/api/push/status','GET',undefined,a)).data.available,true);
  const endpoint='https://fcm.googleapis.com/fcm/send/example123456789';
  assert.equal((await h.call('/api/push/subscribe','POST',{endpoint:'https://127.0.0.1/private'},a)).status,400,'prohibido SSRF');
  assert.equal((await h.call('/api/push/subscribe','POST',{endpoint},a)).status,200);
  assert.equal((await h.call('/api/push/subscribe','POST',{endpoint},a)).status,200,'suscripción repetida idempotente');
  assert.equal((await h.call('/api/push/status','GET',undefined,a)).data.subscriptions,1);
  assert.equal((await h.call('/api/push/status','GET',undefined,b)).data.subscriptions,0,'la otra cuenta no ve la suscripción');
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const work=(await h.call('/api/projects','POST',{space:'work',title:'Trabajo de prueba'},a)).data.project.id;
  const privateProject=(await h.call('/api/projects','POST',{space:'couple',title:'Sorpresa privada'},b)).data.project.id;
  assert.equal((await h.call(`/api/projects/${work}/tasks`,'POST',{title:'Aviso profesional',due_date:today},b)).status,201);
  assert.equal((await h.call(`/api/projects/${privateProject}/tasks`,'POST',{title:'Aviso secreto',due_date:today},b)).status,201);
  const r=await h.call('/api/reminders/run','POST',{},a);assert.equal(r.status,200,JSON.stringify(r.data));
  // DUPLA 6: el aviso de cambio ya sale al momento (envío inmediato); en total, exactamente 2 y sin duplicados.
  await new Promise(ok=>setTimeout(ok,50));
  assert.equal(calls.length,2,'aviso de cambio y recordatorio de Trabajo solo a A, sin duplicados');const req=calls[0];assert.equal(req.url,endpoint);assert.equal(req.opts.body,undefined,'sin datos privados en el proveedor push');
  assert(!JSON.stringify(req.opts.headers).includes('Aviso secreto'));assert(req.opts.headers.Authorization.startsWith('vapid t='));
  const jwt=req.opts.headers.Authorization.split('vapid t=')[1].split(',')[0];const [head,payload,signature]=jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(payload,'base64url')).aud,'https://fcm.googleapis.com');
  const subtlePublic=await crypto.subtle.importKey('jwk',pub,{name:'ECDSA',namedCurve:'P-256'},true,['verify']);
  assert.equal(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},subtlePublic,Buffer.from(signature,'base64url'),new TextEncoder().encode(head+'.'+payload)),true);
  assert.equal((await h.call('/api/reminders/run','POST',{},a)).data.push.sent,0,'sin repetición push');
  assert.equal((await h.call('/api/push/unsubscribe','POST',{endpoint},a)).status,200);
  assert.equal((await h.call('/api/push/status','GET',undefined,a)).data.subscriptions,0);
 }finally{globalThis.fetch=old;h.db.close();}
});

test('INTEGRIDAD de fechas: API rechaza días inexistentes y campos que intentan colarse como fecha',async()=>{
 const h=harness();try{
  const [a,b]=await h.accounts();
  const p=(await h.call('/api/projects','POST',{space:'couple',title:'Fechas verificadas'},a)).data.project;
  for(const date of ['2026-02-30','2026-04-31','2026-12-15-sobra','2026-00-10','2026-13-01']){
   const bad=await h.call(`/api/projects/${p.id}/events`,'POST',{title:'Fecha inválida',event_date:date},b);
   assert.equal(bad.status,400,'Una fecha inválida nunca debe guardarse: '+date);
  }
  const ok=await h.call(`/api/projects/${p.id}/events`,'POST',{title:'Día válido',event_date:'2026-12-13',event_time:'18:30'},b);
  assert.equal(ok.status,201);
  const info=(await h.call('/api/projects/'+p.id,'GET',undefined,a)).data.project;
  assert.equal(info.events.length,1,'Las fechas inválidas no dejan registros parciales');
 }finally{h.db.close();}
});
