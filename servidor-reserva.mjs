// DUPLA · servidor de reserva fuera de Cloudflare (Node 22+). Mismo código que la web (edge/), con SQLite en un archivo.
// Uso: npm run reserva   (copia los datos desde Cloudflare al arrancar y cada hora; abre http://localhost:8790)
//      npm run reserva -- --sin-copiar   (arranca con lo que ya tiene)   --forzar   (copia aunque haya cambios hechos en la reserva)
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './edge/api.mjs';
import { createNodeStorage } from './edge/node-storage.mjs';
import { importSnapshot } from './edge/reserva-import.mjs';
import { runHourlyJobs } from './edge/jobs.mjs';
import { isAllowedSocketOrigin } from './edge/origin.mjs';
import { security } from './edge/security.mjs';

const ROOT=fileURLToPath(new URL('.',import.meta.url)),PUBLIC=join(ROOT,'edge','public');
const CLOUD='https://dos-espacios-compartido.dos-espacios-ferris.workers.dev';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'};
const WRITE=new Set(['POST','PUT','PATCH','DELETE']),NOT_A_CHANGE=/^\/api\/(login|logout|passkeys|ws|push\/)/;

function readEnvFile(file){const out={};if(!existsSync(file))return out;for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);if(m)out[m[1]]=m[2].replace(/^["']|["']$/g,'');}return out;}

// WebSocket mínimo (RFC 6455) con la misma forma que los del Durable Object: send, close y deserializeAttachment.
function frame(op,payload){const len=payload.length,head=len<126?Buffer.from([0x80|op,len]):len<65536?Buffer.from([0x80|op,126,len>>8,len&255]):Buffer.concat([Buffer.from([0x80|op,127]),(()=>{const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(len));return b;})()]);return Buffer.concat([head,payload]);}
function acceptSocket(socket,attachment,sockets,onText){
 let buf=Buffer.alloc(0),open=true;
 const ws={send(text){if(open)socket.write(frame(1,Buffer.from(String(text))));},close(code=1000,reason=''){if(!open)return;open=false;const r=Buffer.from(String(reason).slice(0,100));const b=Buffer.alloc(2+r.length);b.writeUInt16BE(code);r.copy(b,2);try{socket.end(frame(8,b));}catch{}sockets.delete(ws);},deserializeAttachment:()=>attachment};
 sockets.add(ws);
 socket.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);
  while(buf.length>=2){const op=buf[0]&15,masked=buf[1]&128;let len=buf[1]&127,off=2;
   if(len===126){if(buf.length<4)return;len=buf.readUInt16BE(2);off=4;}else if(len===127){if(buf.length<10)return;len=Number(buf.readBigUInt64BE(2));off=10;}
   if(len>65536){ws.close(1009,'Mensaje demasiado grande');return;}
   const need=off+(masked?4:0)+len;if(buf.length<need)return;
   const mask=masked?buf.subarray(off,off+4):null,data=Buffer.from(buf.subarray(off+(masked?4:0),need));if(mask)for(let i=0;i<data.length;i++)data[i]^=mask[i%4];
   buf=buf.subarray(need);
   if(op===8){ws.close();return;}if(op===9){socket.write(frame(10,data));continue;}if(op===1)onText(ws,data.toString('utf8'));}
 });
 const gone=()=>{open=false;sockets.delete(ws);};socket.on('close',gone);socket.on('error',gone);
 return ws;
}

export async function startReserva({port=8790,host='127.0.0.1',dataFile=join(ROOT,'data','reserva','dupla.sqlite'),env:extra={},sync=true,force=false,log=console.log}={}){
 const env={...readEnvFile(join(ROOT,'.env.reserva')),...extra};
 // Igual que env.ASSETS en Cloudflare: la API lee /private/* (foto, cuaderno) solo con sesión.
 env.ASSETS=env.ASSETS||{fetch:async r=>{const p=normalize(join(PUBLIC,decodeURIComponent(new URL(r.url||r).pathname)));if(!p.startsWith(PUBLIC+sep)||!existsSync(p)||!statSync(p).isFile())return new Response('No encontrado',{status:404});return new Response(await readFile(p),{headers:{'Content-Type':TYPES[extname(p).toLowerCase()]||'application/octet-stream'}});}};
 const storage=createNodeStorage(dataFile),sockets=new Set();
 const ctx={getWebSockets:()=>[...sockets],waitUntil:p=>{Promise.resolve(p).catch(()=>{});}};
 let app=null;
 const headers={...security,'Content-Security-Policy':security['Content-Security-Policy'].replace("connect-src 'self' wss:","connect-src 'self' ws: wss:")};
 delete headers['Strict-Transport-Security'];

 async function serveStatic(req,res,url){
  let rel=decodeURIComponent(url.pathname);if(rel.endsWith('/'))rel+='index.html';
  const file=normalize(join(PUBLIC,rel));
  if(!file.startsWith(PUBLIC+sep)||file.startsWith(join(PUBLIC,'private')+sep)||!existsSync(file)||!statSync(file).isFile()){res.writeHead(404,{...headers,'Content-Type':'text/plain; charset=utf-8'});res.end('No encontrado');return;}
  const ext=extname(file).toLowerCase(),body=await readFile(file);
  res.writeHead(200,{...headers,'Content-Type':TYPES[ext]||'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'});res.end(req.method==='HEAD'?undefined:body);
 }
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  try{
   // --entrar: abre la reserva ya con la sesión del dueño de la credencial (solo desde este ordenador).
   if(url.pathname==='/entrar'&&env.RESERVA_ENTRAR==='1'&&/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress||'')){
    const u=storage.db.prepare("SELECT id FROM users WHERE password_hash NOT LIKE 'sin-clave:%' ORDER BY created_at LIMIT 1").get();if(!u){res.writeHead(404,headers);res.end('Sin cuenta con clave');return;}
    const token=randomBytes(32).toString('hex');storage.db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,device,created_at) VALUES(?,?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),u.id,new Date(Date.now()+30*864e5).toISOString(),'Reserva local',new Date().toISOString());
    res.writeHead(302,{...headers,'Set-Cookie':`dos_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`,Location:'/'});res.end();return;}
   if(!url.pathname.startsWith('/api/'))return await serveStatic(req,res,url);
   if(!app){res.writeHead(503,{...headers,'Content-Type':'application/json'});res.end('{"error":"La reserva está arrancando"}');return;}
   if(url.pathname==='/api/health'){res.writeHead(200,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',reserva:true,sync:await storage.get('reserva_sync')||null}));return;}
   const wh=res.writeHead.bind(res),pdfIn=/^\/api\/assets\/[a-f0-9-]{36}$/.test(url.pathname)&&url.searchParams.get('inline')==='1';res.writeHead=(code,h={})=>{const x={...headers,...h};if(pdfIn&&/^application\/pdf/.test(x['Content-Type']||'')){x['Content-Security-Policy']=x['Content-Security-Policy'].replace("frame-ancestors 'none'","frame-ancestors 'self'");x['X-Frame-Options']='SAMEORIGIN';}return wh(code,x);};
   // --entrar: los calendarios de Google (conjunto y personales fusionados) se leen de la web real; desde aquí no se escribe en Google.
   if(env.RESERVA_ENTRAR==='1'&&(url.pathname.startsWith('/api/google/')||(['/api/push/status','/api/calendar/merged'].includes(url.pathname)&&req.method==='GET'))&&app.userFromReq(req)){
    if(req.method!=='GET'){res.writeHead(409,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:'En la copia local el calendario de Google es solo de lectura.'}));return;}
    const r=await cloudGet(url.pathname+url.search);res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json','Cache-Control':'no-store'});res.end(Buffer.from(await r.arrayBuffer()));return;}
   await app.api(req,res,url);
   if(WRITE.has(req.method)&&res.statusCode<400&&!NOT_A_CHANGE.test(url.pathname)&&!await storage.get('reserva_cambios'))await storage.put('reserva_cambios',{at:new Date().toISOString(),path:url.pathname});
  }catch(error){
   if(!res.headersSent)res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(JSON.stringify({error:error.status?error.message:'Error interno del servidor'}));if(!error.status)console.error('Reserva',error?.message);
  }
 });
 server.on('upgrade',(req,socket)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  const request=new Request(`http://${req.headers.host}${url.pathname}`,{headers:Object.entries(req.headers).filter(([,v])=>typeof v==='string')});
  const user=app&&url.pathname==='/api/ws'&&isAllowedSocketOrigin(request)?app.userFromReq(req):null,key=req.headers['sec-websocket-key'];
  if(!user||!key){socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');return;}
  const accept=createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  acceptSocket(socket,{sessionHash:user.token_hash},sockets,(ws,text)=>{if(!app.isSessionActive(ws.deserializeAttachment()?.sessionHash)){ws.close(1008,'Sesión cerrada');return;}if(text==='ping')ws.send('pong');});
 });

 // Copia desde Cloudflare (o desde la entrada de Firebase si Cloudflare no responde). Nunca pisa cambios hechos en la reserva.
 async function syncNow(forced=false){
  const pending=await storage.get('reserva_cambios');
  if(pending&&!forced){log(`AVISO: hay cambios hechos en la reserva (${pending.at}). No copio desde Cloudflare para no perderlos. Usa --forzar si quieres descartarlos.`);return {skipped:true};}
  const cred=credential(env);if(!cred){log('Sin credencial: no puedo copiar los datos (npm run credencial).');return {skipped:true};}
  for(const origin of [env.RESERVA_ORIGEN||CLOUD,env.RESERVA_ORIGEN_FIREBASE].filter(Boolean)){
   try{
    const login=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:cred.email,password:cred.password}),signal:AbortSignal.timeout(20000)});
    if(!login.ok)throw Error('inicio de sesión HTTP '+login.status);
    const cookie=(login.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');
    const snap=await fetch(origin+'/api/snapshot',{headers:{Cookie:cookie},signal:AbortSignal.timeout(180000)});if(!snap.ok)throw Error('copia HTTP '+snap.status);
    const copy=await snap.json();for(const n of copy.pending_files||[]){const x=await fetch(origin+'/api/snapshot/file/'+n,{headers:{Cookie:cookie},signal:AbortSignal.timeout(60000)});if(!x.ok)throw Error('archivo HTTP '+x.status);copy.files.push(await x.json());}
    const r=await importSnapshot(storage,copy,cred);
    fetch(origin+'/api/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin}}).catch(()=>{});
    log(`Datos copiados desde ${new URL(origin).host}: ${r.rows} registros, ${r.files} archivos.`);notifyAll();return r;
   }catch(ex){log(`No se pudo copiar desde ${new URL(origin).host}: ${ex.message}`);}
  }
  return {failed:true};
 }
 let cloudCookie='';
 async function cloudGet(path,retry=true){
  const origin=env.RESERVA_ORIGEN||CLOUD;
  if(!cloudCookie){const cred=credential(env);if(!cred)return new Response('{"error":"Sin credencial"}',{status:503});const l=await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({email:cred.email,password:cred.password}),signal:AbortSignal.timeout(20000)});if(!l.ok)return new Response('{"error":"No se pudo entrar en la web real"}',{status:502});cloudCookie=(l.headers.getSetCookie?.()||[]).map(c=>c.split(';')[0]).join('; ');}
  const r=await fetch(origin+path,{headers:{Cookie:cloudCookie},signal:AbortSignal.timeout(30000)}).catch(()=>new Response('{"error":"La web real no responde"}',{status:502}));
  if(r.status===401&&retry){cloudCookie='';return cloudGet(path,false);}return r;
 }
 function notifyAll(){const m=JSON.stringify({space:null,projectId:null,actor:null,at:new Date().toISOString()});for(const ws of sockets)try{ws.send(m);}catch{}}
 let timer=null;
 const hourly=async()=>{if(sync)await syncNow(false);await runHourlyJobs(app,env);};
 await new Promise(ok=>server.listen(port,host,ok));
 const address=server.address();
 env.PUBLIC_ORIGIN=env.PUBLIC_ORIGIN||`http://localhost:${address.port}`;app=createApi(storage,env,ctx);
 if(sync)await syncNow(force);
 timer=setInterval(()=>hourly().catch(e=>console.error('Reserva cada hora',e?.message)),60*60*1000);timer.unref?.();
 return {server,app,storage,port:address.port,url:`http://localhost:${address.port}`,syncNow,
  async close(){clearInterval(timer);for(const ws of sockets)ws.close(1001,'Servidor parado');await new Promise(ok=>server.close(ok));storage.close();}};
}

// La credencial cifrada de Windows (npm run credencial) solo se lee en memoria; nunca se guarda en claro.
export function credential(env){
 if(env.RESERVA_EMAIL&&env.RESERVA_CLAVE)return {email:env.RESERVA_EMAIL,password:env.RESERVA_CLAVE};
 const file=join(process.env.USERPROFILE||'','.dupla','credencial.xml');if(process.platform!=='win32'||!existsSync(file))return null;
 const ps=`$c=Import-Clixml -LiteralPath '${file.replace(/'/g,"''")}';[Console]::Out.Write((@{email=$c.UserName;password=$c.GetNetworkCredential().Password}|ConvertTo-Json -Compress))`;
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{encoding:'utf8',windowsHide:true,timeout:20000});
 try{return JSON.parse(r.stdout);}catch{return null;}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===normalize(process.argv[1])){
 const args=process.argv.slice(2),r=await startReserva({sync:!args.includes('--sin-copiar'),force:args.includes('--forzar'),port:Number(process.env.PORT)||8790,env:args.includes('--entrar')?{RESERVA_ENTRAR:'1'}:{}});
 console.log(`\nDUPLA (reserva) funcionando en ${r.url}\nDeja esta ventana abierta. Para pararlo: Ctrl+C.`);
 const stop=async()=>{await r.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
