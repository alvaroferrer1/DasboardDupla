import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import { createApi } from '../edge/api.mjs';
import { readFile } from 'node:fs/promises';

function fixture(extraEnv={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const metadata=new Map();
 const storage={
  async get(key){return metadata.get(key)??null;},
  async put(key,value){metadata.set(key,value);},
  sql:{exec(sql,...bindings){
   if(!bindings.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
   const statement=db.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);
   const rows=reader?statement.all(...bindings):[];
   return {toArray:()=>rows,rowsWritten:reader?0:statement.run(...bindings).changes};
  }},
  transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
 };
 const app=createApi(storage,{SETUP_TOKEN:'X'.repeat(64),...extraEnv},{getWebSockets:()=>[],waitUntil(){}});
 async function call(path,method='GET',body,cookie){
  const headers={origin:'https://dupla.test',host:'dupla.test',...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{})};
  let resolved;const p=new Promise(r=>resolved=r);let status=200;const responseHeaders=new Headers();
  const req={method,headers,socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  const res={writableEnded:false,headersSent:false,writeHead(code,extra={}){status=code;this.headersSent=true;for(const [key,value] of Object.entries(extra))responseHeaders.set(key,value);},end(payload){this.writableEnded=true;resolved(new Response(payload??null,{status,headers:responseHeaders}));}};
  try{await app.api(req,res,new URL('https://dupla.test'+path));}catch(error){res.writeHead(error.status||500);res.end(JSON.stringify({error:error.status?error.message:String(error)}));}
  const response=await p;const data=await response.json();return {status:response.status,data,cookie:response.headers.get('set-cookie')};
 }
 async function login(){
  assert.equal((await call('/api/initialize','POST',{setup_token:'X'.repeat(64),email_a:'first@dupla.test',email_b:'second@dupla.test',password_a:'first-password-1234',password_b:'second-password-1234'})).status,201);
  const a=await call('/api/login','POST',{email:'first@dupla.test',password:'first-password-1234'});
  const b=await call('/api/login','POST',{email:'second@dupla.test',password:'second-password-1234'});
  assert.equal(a.status,200);assert.equal(b.status,200);
  return [a.cookie.split(';')[0],b.cookie.split(';')[0]];
 }
 return {db,call,login};
}

test('DUPLA 5.1: enlace compartido de forma segura, sin claves ni acciones decorativas',async()=>{
 const app=await readFile(new URL('../edge/public/app.js',import.meta.url),'utf8');
 assert.match(app,/data-action="share-access"/);
 assert.match(app,/case 'share-access'/);
 assert.match(app,/navigator\.clipboard\.writeText\(text\)/);
 assert.match(app,/location\.origin\+'\/'/);
 assert.doesNotMatch(app.match(/case 'share-access':[\s\S]*?case 'push-test':/)[0],/SETUP_TOKEN|password_a|password_b/);
});

test('DUPLA 5.1: Push de prueba exige sesión, suscripción propia y VAPID',async()=>{
 const {db,call,login}=fixture();try{
  const [a]=await login();
  assert.equal((await call('/api/push/test','POST',{endpoint:'https://fcm.googleapis.com/fcm/send/example-1234'})).status,401);
  assert.equal((await call('/api/push/test','POST',{endpoint:'https://fcm.googleapis.com/fcm/send/example-1234'},a)).status,503);
 }finally{db.close();}
});

test('DUPLA 5.1: prueba Push real firma VAPID, no entrega datos privados y limita frecuencia',async()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=privateKey.export({format:'jwk'}),point=publicKey.export({format:'jwk'});
 const publicKeyB64=Buffer.concat([Buffer.from([4]),Buffer.from(point.x,'base64url'),Buffer.from(point.y,'base64url')]).toString('base64url');
 const env={PUSH_VAPID_PUBLIC_KEY:publicKeyB64,PUSH_VAPID_PRIVATE_JWK:JSON.stringify(jwk),PUSH_VAPID_SUBJECT:'mailto:notify@dupla.test'};
 const {db,call,login}=fixture(env);
 const originalFetch=globalThis.fetch;
 const sent=[];
 globalThis.fetch=async (url,options)=>{sent.push({url:String(url),options});return new Response(null,{status:201});};
 try{
  const [a,b]=await login();const endpoint='https://fcm.googleapis.com/fcm/send/subscription-for-account-a';
  assert.equal((await call('/api/push/test','POST',{endpoint},a)).status,403);
  assert.equal((await call('/api/push/subscribe','POST',{endpoint},a)).status,200);
  assert.equal((await call('/api/push/test','POST',{endpoint},b)).status,403);
  const first=await call('/api/push/test','POST',{endpoint},a);
  assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.accepted,true);
  assert.equal(sent.length,1);assert.equal(sent[0].url,endpoint);
  assert.equal(sent[0].options.method,'POST');
  assert.equal(sent[0].options.headers['Content-Length'],'0');
  assert.match(sent[0].options.headers.Authorization,/^vapid t=/);
  assert.equal((await call('/api/push/test','POST',{endpoint},a)).status,429);
  assert.equal(sent.length,1,'No debe enviar dos mensajes en menos de un minuto');
 }finally{globalThis.fetch=originalFetch;db.close();}
});

test('DUPLA 5.1: correo de prueba real solo al propio usuario, con permiso y límite de frecuencia',async()=>{
 const env={RESEND_API_KEY:'clave-ficticia-local',NOTIFY_FROM_EMAIL:'DUPLA <alertas@dupla.test>'};
 const {db,call,login}=fixture(env);
 const originalFetch=globalThis.fetch;
 const sent=[];
 globalThis.fetch=async(url,options)=>{sent.push({url:String(url),options});return new Response(JSON.stringify({id:'correo-de-prueba'}),{status:200});};
 try{
  const [a,b]=await login();
  assert.equal((await call('/api/notifications/email/test','POST',{},a)).status,409,'Sin consentimiento explícito');
  assert.equal((await call('/api/notifications/preferences','POST',{email_enabled:true,work_enabled:true,couple_enabled:false},a)).status,200);
  assert.equal((await call('/api/notifications/email/test','POST',{})).status,401);
  const testResult=await call('/api/notifications/email/test','POST',{to:'attacker@example.com'},a);
  assert.equal(testResult.status,200,JSON.stringify(testResult.data));assert.equal(sent.length,1);
  assert.equal(sent[0].url,'https://api.resend.com/emails');
  const body=JSON.parse(sent[0].options.body);
  assert.deepEqual(body.to,['first@dupla.test'],'Nunca aceptar destino arbitrario');
  assert(!JSON.stringify(body).includes('second@dupla.test'));
  assert.equal((await call('/api/notifications/email/test','POST',{},a)).status,429);
  assert.equal(sent.length,1,'Un máximo de una prueba por minuto');
  assert.equal((await call('/api/notifications/email/test','POST',{},b)).status,409);
 }finally{globalThis.fetch=originalFetch;db.close();}
});
