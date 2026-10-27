import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createHash} from 'node:crypto';
import {createApi} from '../edge/api.mjs';

function fixture(extra={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const meta=new Map(),objects=new Map(),websockets=[];
 const bucket={
  async put(k,data,opts={}){objects.set(k,{data:Buffer.from(data),opts});},
  async get(k){const a=objects.get(k);return a?{size:a.data.length,customMetadata:a.opts.customMetadata||{},text:async()=>a.data.toString('utf8'),arrayBuffer:async()=>a.data}:null},
  async head(k){const a=objects.get(k);return a?{size:a.data.length}:null},
  async list(){return {objects:[...objects.entries()].map(([key,a])=>({key,size:a.data.length})),truncated:false}}
 };
 const storage={async get(k){return meta.get(k)??null},async put(k,v){meta.set(k,v)},
  sql:{exec(sql,...params){if(!params.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return{toArray:()=>[],rowsWritten:0};}
   const stmt=db.prepare(sql),read=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=read?stmt.all(...params):[];return{toArray:()=>rows,rowsWritten:read?0:stmt.run(...params).changes};}},
  transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 };
 const env={SETUP_TOKEN:'T'.repeat(64),PUBLIC_ORIGIN:'https://dupla.test',INTEGRATION_ENCRYPTION_KEY:'test-secret-key-with-32-characters-000',BACKUP_BUCKET:bucket,...extra};
 const app=createApi(storage,env,{getWebSockets:()=>websockets,waitUntil(){}});
 async function call(path,method='GET',body,cookie,customHeaders={}){
  const headers={origin:'https://dupla.test',host:'dupla.test',...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...customHeaders};
  const req={method,headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  let resolve,status=200;const response=new Promise(r=>resolve=r);const hs=new Headers();
  const res={writableEnded:false,headersSent:false,writeHead(code,x={}){status=code;this.headersSent=true;for(const[k,v]of Object.entries(x))hs.set(k,v)},end(raw){this.writableEnded=true;resolve(new Response(raw??null,{status,headers:hs}));}};
  try{await app.api(req,res,new URL('https://dupla.test'+path));}catch(e){if(!res.headersSent)res.writeHead(e.status||500);res.end(JSON.stringify({error:e.status?e.message:String(e)}));}
  const r=await response;let data;try{data=await r.json()}catch{};return{status:r.status,data,cookie:r.headers.get('set-cookie'),redirect:r.headers.get('location')};
 }
 async function accounts(){
  assert.equal((await call('/api/initialize','POST',{setup_token:env.SETUP_TOKEN,email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'password-for-alpha-2026',password_b:'password-for-bravo-2026'})).status,201);
  const a=await call('/api/login','POST',{email:'a@dupla.test',password:'password-for-alpha-2026'}),b=await call('/api/login','POST',{email:'b@dupla.test',password:'password-for-bravo-2026'});
  assert.equal(a.status,200);assert.equal(b.status,200);return[a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,app,call,accounts,objects,websockets,meta,env};
}

test('Director General: propone, aprueba, ejecuta con autorización, audita e impide duplicados',async()=>{
 const h=fixture();try{
  const [a,b]=await h.accounts();
  const work=await h.call('/api/projects','POST',{title:'Proyecto profesional sin tareas',space:'work'},a);
  const couple=await h.call('/api/projects','POST',{title:'Pareja sin tareas',space:'couple'},b);
  assert.equal(work.status,201);assert.equal(couple.status,201);
  const review=await h.call('/api/guardian/review','POST',{},a);assert.equal(review.status,200,JSON.stringify(review.data));
  assert.equal(review.data.proposals,1,'Solo Trabajo genera propuestas');
  assert.equal((await h.call('/api/guardian/review','POST',{},b)).data.proposals,0);
  const items=(await h.call('/api/guardian/actions','GET',undefined,b)).data.items;
  assert.equal(items.length,1);assert.equal(items[0].status,'proposed');assert.equal(items[0].project_id,work.data.project.id);
  const url='/api/guardian/actions/'+items[0].id;
  assert.equal((await h.call(url+'/execute','POST',{},a)).status,403,'Sin autorización no puede ejecutar');
  assert.equal((await h.call(url+'/approve','POST',{},b)).status,200);
  const act=await h.call(url+'/execute','POST',{},a);assert.equal(act.status,200,JSON.stringify(act.data));assert.equal(act.data.created,true);
  const again=await h.call(url+'/execute','POST',{},b);assert.equal(again.status,200);assert.equal(again.data.created,false);assert.equal(again.data.task_id,act.data.task_id);
  const p=(await h.call('/api/projects/'+work.data.project.id,'GET',undefined,b)).data.project;assert.equal(p.tasks.length,1);
  assert.equal((await h.call('/api/guardian/actions','GET',undefined,a)).data.items[0].executed_by!==null,true);
  const other=(await h.call('/api/projects/'+couple.data.project.id,'GET',undefined,b)).data.project;assert.equal(other.tasks.length,0);
  assert.equal((await h.call(url+'/reject','POST',{},a)).status,409,'No rechazar algo ya ejecutado');
 }finally{h.db.close();}
});

test('Director General: problema resuelto antes de aprobar no permite acción obsoleta',async()=>{
 const h=fixture();try{const [a]=await h.accounts();const p=(await h.call('/api/projects','POST',{title:'Trabajo sin tareas',space:'work'},a)).data.project.id;
  await h.call('/api/guardian/review','POST',{},a);const issue=(await h.call('/api/guardian/actions','GET',undefined,a)).data.items[0];
  assert.equal((await h.call('/api/projects/'+p+'/tasks','POST',{title:'Tarea existente'},a)).status,201);
  assert.equal((await h.call('/api/guardian/actions/'+issue.id+'/approve','POST',{},a)).status,409);
 }finally{h.db.close();}
});

test('Push: reutilizar dispositivo entre usuarios transfiere suscripción y revoca destinatario anterior',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=privateKey.export({format:'jwk'}),pub=publicKey.export({format:'jwk'});
 const key=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
 const h=fixture({PUSH_VAPID_PUBLIC_KEY:key,PUSH_VAPID_PRIVATE_JWK:JSON.stringify(jwk),PUSH_VAPID_SUBJECT:'mailto:security@dupla.test'});
 try{const [a,b]=await h.accounts(),endpoint='https://fcm.googleapis.com/fcm/send/device-claimed-by-new-account';
  assert.equal((await h.call('/api/push/subscribe','POST',{endpoint},a)).status,200);
  assert.equal((await h.call('/api/push/subscribe','POST',{endpoint},b)).status,200);
  assert.equal((await h.call('/api/push/status','GET',undefined,a)).data.subscriptions,0);
  assert.equal((await h.call('/api/push/status','GET',undefined,a)).data.enabled,false);
  assert.equal((await h.call('/api/push/status','GET',undefined,b)).data.subscriptions,1);
  assert.equal((await h.call('/api/push/test','POST',{endpoint},a)).status,403);
 }finally{h.db.close();}
});

test('R2: muestra solo manifiestos recuperables y no archivos fragmentados como nuevas copias',async()=>{
 const h=fixture();try{const[a]=await h.accounts();await h.objects.set('dupla-backups/2026-10-20.json',{data:Buffer.from('{}'),opts:{}});
 h.objects.set('dupla-backups/2026-10-20/files/1234',{data:Buffer.alloc(5),opts:{}});
 h.objects.set('dupla-backups/2026-10-19.json',{data:Buffer.from('{}'),opts:{}});
 const r=await h.call('/api/backups/list','GET',undefined,a);assert.equal(r.status,200,JSON.stringify(r.data));
 assert.deepEqual(r.data.objects.map(x=>x.date),['2026-10-20','2026-10-19']);
 }finally{h.db.close();}
});

test('WebSocket API: broadcast simulado a dos sesiones, revocación y reconexión',async()=>{
 const h=fixture();try{const[a,b]=await h.accounts();
  const active=h.db.prepare('SELECT token_hash FROM sessions ORDER BY token_hash').all();
  assert.equal(active.length,2);
  const mk=hash=>({messages:[],closed:false,deserializeAttachment:()=>({sessionHash:hash}),send(raw){this.messages.push(JSON.parse(raw));},close(){this.closed=true;}});
  const wsA=mk(active[0].token_hash),wsB=mk(active[1].token_hash);h.websockets.push(wsA,wsB);
  const p=await h.call('/api/projects','POST',{title:'Proyecto con aviso WS',space:'work'},a);assert.equal(p.status,201);
  assert.equal(wsA.messages.length,1);assert.equal(wsB.messages.length,1);
  h.websockets.splice(0,2);
  await h.call('/api/projects','POST',{title:'Cambio mientras están desconectados',space:'couple'},b);
  assert.equal(wsA.messages.length,1);
  h.websockets.push(wsA,wsB);
  assert.equal((await h.call('/api/dashboard','GET',undefined,b)).data.projects.length,2,'Tras reconectar se relee el estado persistente');
  assert.equal((await h.call('/api/projects','POST',{title:'Cambio después de reconectar',space:'work'},b)).status,201);
  assert.equal(wsB.messages.length,2);
  // Session invalidated server-side: next broadcast must close its socket.
  h.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(createHash('sha256').update(a.split('=')[1]).digest('hex'));
  await h.call('/api/projects','POST',{title:'Después de revocar',space:'work'},b);
  assert.equal(wsA.closed||wsB.closed,true,'Un socket revocado debe cerrarse en el siguiente broadcast');
 }finally{h.db.close();}
});

test('Seguridad: cookies, origen cruzado y cuerpos JSON inválidos no modifican proyectos',async()=>{
 const h=fixture();try{const[a]=await h.accounts();
  assert.equal((await h.call('/api/projects','POST',{title:'Ataque',space:'work'},a,{origin:'https://evil.example', 'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await h.call('/api/projects','POST',[],a)).status,400);
  assert.equal((await h.call('/api/projects','POST',null,a)).status,400);
  assert.equal((await h.call('/api/dashboard')).status,401);
  assert.equal((await h.call('/api/dashboard','GET',undefined,a)).data.projects.length,0);
 }finally{h.db.close();}
});

test('OAuth: Google, Figma y Canva estado único por usuario, tokens cifrados y respuesta simulada',async()=>{
 const h=fixture({GOOGLE_CLIENT_ID:'client-google',GOOGLE_CLIENT_SECRET:'secret-google',FIGMA_CLIENT_ID:'client-figma',FIGMA_CLIENT_SECRET:'secret-figma',CANVA_CLIENT_ID:'client-canva',CANVA_CLIENT_SECRET:'secret-canva'});
 const prev=globalThis.fetch;const touched=[];
 globalThis.fetch=async(url,opts={})=>{touched.push(String(url));
  if(String(url).includes('oauth2.googleapis.com/token')||String(url).includes('api.figma.com/v1/oauth/token')||String(url).includes('api.canva.com/rest/v1/oauth/token'))
   return Response.json({access_token:'SENSITIVE_FAKE_ACCESS',refresh_token:'SENSITIVE_FAKE_REFRESH',expires_in:3600,scope:'limited'});
  if(String(url).includes('api.canva.com/rest/v1/designs'))return Response.json({items:[{id:'abcde12345',title:'Propuesta',urls:{view_url:'https://www.canva.com/design/abcde12345'}}]});
  if(String(url).includes('api.figma.com/v1/files/'))return Response.json({file:{name:'Archivo Figma ficticio'}});
  if(String(url).includes('googleapis.com/calendar/v3/calendars/primary/events'))return Response.json({items:[]});
  throw Error('Llamada externa inesperada: '+url);
 };
 try{const [a,b]=await h.accounts();
  for(const provider of ['google','figma','canva']){
   const begin=await h.call(provider==='google'?'/api/google/start':'/api/design/'+provider+'/start','POST',{},a);
   assert.equal(begin.status,200,JSON.stringify(begin.data));const authUrl=new URL(begin.data.url);
   const state=authUrl.searchParams.get('state');assert(state,'OAuth debe usar estado');assert(authUrl.searchParams.get('code_challenge'),'PKCE requerido');
   const cb=await h.call(provider==='google'?'/api/google/callback?state='+state+'&code=simulated':'/api/design/'+provider+'/callback?state='+state+'&code=simulated');
   assert.equal(cb.status,302,JSON.stringify(cb.data));
   const replay=await h.call(provider==='google'?'/api/google/callback?state='+state+'&code=simulated':'/api/design/'+provider+'/callback?state='+state+'&code=simulated');
   assert.equal(replay.status,400,'OAuth state no debe reutilizarse');
   const stat=await h.call(provider==='google'?'/api/google/status':'/api/design/'+provider+'/status','GET',undefined,a);
   assert.equal(stat.data.connected,true,provider);
   const statB=await h.call(provider==='google'?'/api/google/status':'/api/design/'+provider+'/status','GET',undefined,b);
   assert.equal(statB.data.connected,false,'La otra cuenta no hereda OAuth');
  }
  assert.equal((await h.call('/api/design/canva/list','GET',undefined,a)).data.items.length,1);
  const figma=await h.call('/api/design/figma/check?url='+encodeURIComponent('https://www.figma.com/design/ABCDE12345/demo'),'GET',undefined,a);
  assert.equal(figma.status,200,JSON.stringify(figma.data));
  const encrypted=h.db.prepare('SELECT encrypted_token FROM google_connections').get().encrypted_token;
  assert(!encrypted.includes('SENSITIVE_FAKE_ACCESS'));
  assert(touched.length>=5);
 }finally{globalThis.fetch=prev;h.db.close();}
});
