import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createApi} from '../edge/api.mjs';
import {encryptToken,authorizationUrl,validSharedCalendarId,normalizedSharedEvent} from '../edge/google-calendar.mjs';

function setupDB(){
 const native=new DatabaseSync(':memory:');native.exec('PRAGMA foreign_keys=ON');
 return {sql:{exec(sql,...bindings){if(!bindings.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){native.exec(sql);return {toArray:()=>[],rowsWritten:0};}
 const statement=native.prepare(sql);const read=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
 return {toArray:()=>read?statement.all(...bindings):[],rowsWritten:read?0:statement.run(...bindings).changes};}},transactionSync(cb){native.exec('BEGIN');try{const v=cb();native.exec('COMMIT');return v;}catch(e){native.exec('ROLLBACK');throw e;}},close(){native.close()}};
}
function mockReq(request){return {method:request.method,url:new URL(request.url).pathname,headers:Object.fromEntries(request.headers.entries()),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){const v=await request.arrayBuffer();if(v.byteLength)yield Buffer.from(v);}};}
async function invoke(app,path,method='GET',data,cookie){
 const headers=new Headers({'origin':'https://dupla.test',host:'dupla.test'});if(cookie)headers.set('cookie',cookie);
 if(data!==undefined)headers.set('content-type','application/json');
 const request=new Request('https://dupla.test'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 let code=200,done,headersOut={};const pending=new Promise(ok=>done=ok);
 const response={headersSent:false,writableEnded:false,writeHead(status,extra={}){code=status;headersOut=extra;this.headersSent=true;},end(message){this.writableEnded=true;done(message);}};
 try{await app.api(mockReq(request),response,new URL(request.url));}
 catch(e){if(!response.headersSent){code=e.status||500;}response.end(JSON.stringify({error:e.message}));}
 const raw=await pending;let obj;try{obj=JSON.parse(raw)}catch{obj={}};
 return {code,obj,cookie:headersOut['Set-Cookie']||headersOut['set-cookie']};
}

test('DUPLA shared Google calendar: 2 users, one calendar, CRUD, native edits, optimistic locking and invitation recovery',async t=>{
 const db=setupDB();t.after(()=>db.close());
 const env={SETUP_TOKEN:'Z'.repeat(64),GOOGLE_CLIENT_ID:'calendar-id',GOOGLE_CLIENT_SECRET:'test-secret',PUBLIC_ORIGIN:'https://dupla.test',INTEGRATION_ENCRYPTION_KEY:'C'.repeat(64)};
 const app=createApi(db,env,{getWebSockets:()=>[],waitUntil(){}});
 const start=await invoke(app,'/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'a@gmail.com',email_b:'b@gmail.com',password_a:'LongTestPasswordOne2026!',password_b:'LongTestPasswordTwo2026!'});
 assert.equal(start.code,201,JSON.stringify(start.obj));
 const A=await invoke(app,'/api/login','POST',{email:'a@gmail.com',password:'LongTestPasswordOne2026!'});
 const B=await invoke(app,'/api/login','POST',{email:'b@gmail.com',password:'LongTestPasswordTwo2026!'});
 assert.equal(A.code,200);assert.equal(B.code,200);const a=A.cookie.split(';')[0],b=B.cookie.split(';')[0];
 // Simulate owner completing OAuth, with real encrypted token format used by production.
 const encrypted=await encryptToken(env,{access_token:'owner-access',refresh_token:'refresh-secret',scope:'https://www.googleapis.com/auth/calendar'});
 db.sql.exec('INSERT INTO google_connections(user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?)',A.obj.user.id,encrypted,Date.now()+3600000,new Date().toISOString());
 const original=globalThis.fetch;
 const events=new Map();let createdCount=0;
 globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);assert.equal(u.origin,'https://www.googleapis.com');
  assert.equal(opts.headers.Authorization,'Bearer owner-access','Only owner token accesses shared calendar for both signed-in users');
  assert.ok(!u.pathname.includes('/primary'),'Nunca el calendario personal');assert.ok(!u.pathname.endsWith('/acl'),'No se cambian los permisos del calendario');
  if(u.pathname.includes('/calendars/')&&!u.pathname.includes(encodeURIComponent('1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com'))&&!u.pathname.includes('calendarList'))throw Error('Otro calendario: '+u.pathname);
  let code=200,body={};const input=opts.body?JSON.parse(opts.body):{};
  if(u.pathname==='/calendar/v3/calendars'&&opts.method==='POST'){createdCount++;body={id:'otro@group.calendar.google.com'};}
  else if(u.pathname==='/calendar/v3/users/me/calendarList/'+encodeURIComponent('1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com')){body={accessRole:'owner',summary:'DUPLA · Nuestro calendario'};}
  else if(u.pathname.endsWith('/events')&&opts.method==='GET'){assert.ok(u.searchParams.get('timeMin')&&u.searchParams.get('timeMax'));body={items:[...events.values()],nextPageToken:null};}
  else if(u.pathname.endsWith('/events')&&opts.method==='POST'){
   const id=input.id||'evt_'+(events.size+1);if(events.has(id)){code=409;body={error:'duplicate'};}else{body={...input,id,etag:'"v1"',htmlLink:'https://calendar.google.com/calendar/event?eid=test'};events.set(id,body);}
  }else if(u.pathname.includes('/events/')&&opts.method==='GET'){const id=u.pathname.split('/').at(-1);body=events.get(id)||{};if(!events.has(id))code=404;}
  else if(u.pathname.includes('/events/')&&opts.method==='PUT'){
   const id=u.pathname.split('/').at(-1),old=events.get(id);
   if(!old)code=404;
   else if(opts.headers['If-Match']!==old.etag)code=412;
   else{body={...input,id,etag:'"v2"'};events.set(id,body);}
  }else if(u.pathname.includes('/events/')&&opts.method==='DELETE'){
   const id=u.pathname.split('/').at(-1);events.delete(id);return new Response(null,{status:204});
  }else throw new Error('Unexpected Google method: '+opts.method+' '+url);
  return new Response(JSON.stringify(body),{status:code,headers:{'content-type':'application/json'}});
 };
 t.after(()=>{globalThis.fetch=original});
 assert.equal((await invoke(app,'/api/google/shared/status','GET',undefined,b)).obj.created,false);
 assert.equal((await invoke(app,'/api/google/shared/create','POST',{title:'Otro'},a)).code,404,'DUPLA no crea calendarios (la ruta ya no existe)');
 assert.equal((await invoke(app,'/api/google/shared/attach','POST',{calendar_id:'otro@group.calendar.google.com'},a)).code,400,'Solo el calendario conjunto');
 assert.equal((await invoke(app,'/api/google/shared/attach','POST',{},a)).code,201);
 assert.equal((await invoke(app,'/api/google/shared/attach','POST',{},b)).code,409,'No se vincula dos veces');
 assert.equal(createdCount,0);
 const status=(await invoke(app,'/api/google/shared/status','GET',undefined,b)).obj;
 assert.equal(status.created,true);assert.equal(status.share_status,'shared');assert.equal(status.id,'1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com');assert.equal(status.title,'DUPLA · Nuestro calendario');
 const payload={title:'Cena en pareja',date:'2026-12-11',time:'21:00',location:'Budapest',notes:'Reserva a confirmar',request_id:'11111111-2222-4333-8444-555555555555'};
 const newEvent=await invoke(app,'/api/google/shared/events','POST',payload,b);
 const duplicate=await invoke(app,'/api/google/shared/events','POST',payload,b);
 assert.equal(duplicate.code,201);assert.equal(duplicate.obj.id,newEvent.obj.id);assert.equal(events.size,1,'Retry uses stable Google ID rather than creating duplicate events');
 assert.equal(newEvent.code,201,JSON.stringify(newEvent.obj));
 const listA=await invoke(app,'/api/google/shared/events','GET',undefined,a);
 const listB=await invoke(app,'/api/google/shared/events','GET',undefined,b);
 assert.equal(listA.obj.items.length,1);assert.deepEqual(listA.obj.items,listB.obj.items);
 const etag=listB.obj.items[0].etag;
 // A native Google Calendar app updates it first; stale browser must not overwrite it.
 events.get(newEvent.obj.id).etag='"v3"';events.get(newEvent.obj.id).summary='Cambio desde el móvil de Angie';
 const stale=await invoke(app,'/api/google/shared/events/'+newEvent.obj.id,'PUT',{title:'Versión antigua',date:'2026-12-11',time:'22:00',etag},a);
 assert.equal(stale.code,409);assert.equal(events.get(newEvent.obj.id).summary,'Cambio desde el móvil de Angie');
 const latest=(await invoke(app,'/api/google/shared/events','GET',undefined,a)).obj.items[0];
 const updated=await invoke(app,'/api/google/shared/events/'+newEvent.obj.id,'PUT',{title:'Cena actualizada por Álvaro',date:'2026-12-11',time:'20:30',etag:latest.etag},a);
 assert.equal(updated.code,200);assert.equal((await invoke(app,'/api/google/shared/events','GET',undefined,b)).obj.items[0].title,'Cena actualizada por Álvaro');
 assert.equal((await invoke(app,'/api/google/disconnect','POST',{},a)).code,409,'Owner token must not be destroyed while shared calendar is active');
 assert.equal((await invoke(app,'/api/google/shared/events/'+newEvent.obj.id,'DELETE',{},b)).code,200);
 assert.equal((await invoke(app,'/api/google/shared/events','GET',undefined,a)).obj.items.length,0);
 assert.equal((await invoke(app,'/api/google/shared/events','POST',{title:'',date:'2026-12-11'},b)).code,400);
 assert.equal(createdCount,0);
 const actualUsers=db.sql.exec('SELECT email,password_hash FROM users ORDER BY email').toArray();
 assert.equal(actualUsers.length,2);assert(actualUsers.every(x=>x.password_hash.length>25));
});

test('Google OAuth permissions & safe calendar validation',()=>{
 const url=new URL(authorizationUrl({GOOGLE_CLIENT_ID:'abc',PUBLIC_ORIGIN:'https://dupla.test'},'state','verifier'));
 const scopes=url.searchParams.get('scope').split(' ');
 assert.deepEqual(scopes,[
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.owned'
 ]);
 assert.ok(!scopes.includes('https://www.googleapis.com/auth/calendar'), 'No pedir permiso completo a todos los calendarios');
 assert.ok(scopes.every(s=>!s.includes('gmail')&&!s.includes('drive')), 'No acceder al correo ni a Drive');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert(validSharedCalendarId('abc123@group.calendar.google.com'));
 assert(!validSharedCalendarId('https://evil.test/a'));
 assert.throws(()=>normalizedSharedEvent({title:'Evento',date:'2026-02-30'}),/Fecha/);
});

test('Vincular exige que la cuenta conectada sea la propietaria del calendario conjunto; no se crea ninguno',async t=>{
 const db=setupDB();t.after(()=>db.close());
 const env={SETUP_TOKEN:'Q'.repeat(64),GOOGLE_CLIENT_ID:'id',GOOGLE_CLIENT_SECRET:'secret',PUBLIC_ORIGIN:'https://dupla.test',INTEGRATION_ENCRYPTION_KEY:'D'.repeat(64)};
 const app=createApi(db,env,{getWebSockets:()=>[],waitUntil(){}});
 await invoke(app,'/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'one@gmail.com',email_b:'two@gmail.com',password_a:'TestPass123456781!',password_b:'TestPass123456782!'});
 const A=await invoke(app,'/api/login','POST',{email:'one@gmail.com',password:'TestPass123456781!'});const a=A.cookie.split(';')[0];
 const blob=await encryptToken(env,{access_token:'owner',refresh_token:'refresh',scope:'x'});
 db.sql.exec('INSERT INTO google_connections(user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?)',A.obj.user.id,blob,Date.now()+3600_000,new Date().toISOString());
 const original=globalThis.fetch;let accessRole='writer',created=0;
 globalThis.fetch=async(url,opts={})=>{
  const path=new URL(url).pathname;let data={};
  if(path==='/calendar/v3/users/me/calendarList/'+encodeURIComponent('1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com')&&opts.method==='GET')data={accessRole,summary:'DUPLA · Nuestro calendario'};
  else if(path==='/calendar/v3/calendars'&&opts.method==='POST')created++;
  else throw Error('Path no esperado '+path);
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };
 t.after(()=>{globalThis.fetch=original});
 assert.equal((await invoke(app,'/api/google/shared/attach','POST',{},a)).code,403,'Una cuenta que no es la propietaria no lo vincula');
 accessRole='owner';const linked=await invoke(app,'/api/google/shared/attach','POST',{},a);
 assert.equal(linked.code,201,JSON.stringify(linked.obj));assert.equal(created,0,'Se usa el calendario existente');
 assert.equal((await invoke(app,'/api/google/shared/status','GET',undefined,a)).obj.share_status,'shared');
 assert.equal((await invoke(app,'/api/google/shared/attach','POST',{},a)).code,409,'Repeated attach is rejected');
});
