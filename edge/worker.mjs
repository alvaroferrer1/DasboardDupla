import { DurableObject } from 'cloudflare:workers';
import { createApi } from './api.mjs';
import { createDB } from './db.mjs';
import { isAllowedSocketOrigin } from './origin.mjs';
const security = {
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'same-origin',
 'X-Frame-Options':'DENY',
 'Permissions-Policy':'camera=(self), microphone=(self), geolocation=()',
 'Strict-Transport-Security':'max-age=15552000',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' wss:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};

export class DosRoom extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.app=createApi(ctx.storage,env,ctx);if(typeof ctx.setWebSocketAutoResponse==='function' && typeof WebSocketRequestResponsePair!=='undefined')ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));}
 async alarm(){
  // A failure in one scheduled subsystem must not prevent the others from running.
  const jobs=[
   ['reminders',()=>this.app.processReminders()],
   ['guardian',()=>this.app.processGuardianReview()],
   ['resumen',()=>this.app.processDailyBrief()],
   ['repaso',()=>this.app.processWeeklyReview()],
   ['avisos-dupla',()=>this.app.processAgentAlerts()],
   // Automation rules and third-party webhooks stay paused until the owners explicitly enable them.
   ...(this.env.DUPLA_AUTOMATIONS_ENABLED==='true'?[['automations',()=>this.app.processAutomationRules()]]:[]),
   ['backup',()=>this.app.processScheduledBackup()],
   ['drive',()=>this.app.processDriveBackup()],
   ['email',()=>this.app.flushExternalNotices()],
   ['push',()=>this.app.flushPushNotices()],
   ...(this.env.DUPLA_AUTOMATIONS_ENABLED==='true'?[['webhooks',()=>this.app.flushWebhookQueue()]]:[])
  ];
  try{for(const [name,job] of jobs){try{await job();}catch(e){console.error('DUPLA scheduled '+name+':',String(e?.message||e).slice(0,160));try{this.app.alertFailure(name,e);}catch{}}}}
  finally{await this.ctx.storage.setAlarm(Date.now()+60*60*1000);}
 }
 async fetch(request){
  // Durable Object alarms work even when both users have their PCs switched off.
  if(await this.ctx.storage.getAlarm()===null)await this.ctx.storage.setAlarm(Date.now()+60*60*1000);
  const url=new URL(request.url);
  if(url.pathname==='/api/ws'){
   if((request.headers.get('Upgrade')||'').toLowerCase()!=='websocket')return new Response('WebSocket requerido',{status:426});
   // Browsers include Origin on WebSocket handshakes; cookies alone do not prevent CSWSH.
   if(!isAllowedSocketOrigin(request))return new Response('Origen de WebSocket no autorizado',{status:403});
   const req=makeNodeRequest(request);
   const user=this.app.userFromReq(req);
   if(!user)return new Response('No autorizado',{status:401});
   const pair=new WebSocketPair();const [client,server]=Object.values(pair);
   this.ctx.acceptWebSocket(server);
   server.serializeAttachment({sessionHash:user.token_hash});
   return new Response(null,{status:101,webSocket:client});
  }
  if(url.pathname==='/api/health')return Response.json({status:'ok'});
  if(url.pathname==='/api/stream')return new Response('Usa WebSocket /api/ws',{status:410});
  const req=makeNodeRequest(request);
  const response=createNodeResponse();
  try { await this.app.api(req,response.res,url); }
  catch (error) {
   if(!response.res.headersSent)response.res.writeHead(error.status||500,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   response.res.end(JSON.stringify({error:error.status?error.message:'Error interno del servidor'}));
   if(!error.status)console.error('Edge error',error?.message);
  }
  return await response.promise;
 }
 webSocketMessage(ws,message){
  if(!this.app.isSessionActive(ws.deserializeAttachment?.()?.sessionHash)){ws.close(1008,'Sesión cerrada');return;}
  if(message==='ping'){ws.send('pong');return;}
  // Ignore any other client messages: changes originate only from authenticated API endpoints.
 }
}

function makeNodeRequest(request){
 const headers=Object.fromEntries(request.headers.entries());
 const url=new URL(request.url);
 let delivered=false;
 const maxBody=9*1024*1024;
 return {
  url:url.pathname+url.search,method:request.method,headers,
  socket:{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'},
  async *[Symbol.asyncIterator](){
   if(delivered)return;delivered=true;
   const declared=Number(request.headers.get('Content-Length')||0);
   if(declared>maxBody){const error=new Error('Contenido demasiado grande');error.status=413;throw error;}
   if(!request.body)return;
   let total=0;
   for await(const chunk of request.body){
    total+=chunk.byteLength;if(total>maxBody){const error=new Error('Contenido demasiado grande');error.status=413;throw error;}
    yield Buffer.from(chunk);
   }
  }
 };
}
function createNodeResponse(){
 let resolve;const promise=new Promise(r=>resolve=r);
 const stored=new Headers();let code=200;
 const res={headersSent:false,writableEnded:false,
  setHeader(key,val){stored.set(key,val)},
  writeHead(status,headers={}){code=status;for(const [key,val] of Object.entries(headers))stored.set(key,val);this.headersSent=true;},
  end(body){if(this.writableEnded)return;this.writableEnded=true;resolve(new Response(body??null,{status:code,headers:stored}));},
  write(){throw Error('EventSource no está disponible en Cloudflare; utiliza WebSocket')}
 };
 return {res,promise};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  let response;
  if(url.pathname.startsWith('/api/')){
   const id=env.DOS_ROOM.idFromName('shared-home');
   response=await env.DOS_ROOM.get(id).fetch(request);
  }else{
   response=await env.ASSETS.fetch(request);
  }
  // New Response preserves Content-Type, cookies, and WebSocket upgrades; don't rewrite 101 responses.
  if(response.status===101)return response;
  const headers=new Headers(response.headers);
  for(const [name,value] of Object.entries(security))headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
