// Entrada alternativa de DUPLA en Google (Firebase / Cloud Run): reenvía cada petición a la web de Cloudflare.
// Sirve cuando el operador bloquea las IP de Cloudflare: el móvil habla con Google y Google con Cloudflare.
// Mismos datos, cuentas y sesión. Sin dependencias para poder probarlo en local.
const HOP=new Set(['host','connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authorization','proxy-connection','content-length','accept-encoding','x-forwarded-for','x-forwarded-host','x-forwarded-proto','forwarded','x-cloud-trace-context','traceparent']);
const DROP_OUT=new Set(['content-encoding','content-length','transfer-encoding','connection','keep-alive','alt-svc','strict-transport-security']);

export function createProxy(target){
 const upstream=new URL(target).origin;
 return async function proxy(req,res){
  try{
   const proto=String(req.headers['x-forwarded-proto']||(req.socket?.encrypted?'https':'http')).split(',')[0].trim();
   const self=`${proto}://${req.headers['x-forwarded-host']||req.headers.host}`;
   const url=new URL(req.originalUrl||req.url,self);
   if(url.pathname==='/api/ws'){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('Tiempo real no disponible por esta entrada');return;}
   const headers={};
   for(const [k,v] of Object.entries(req.headers)){if(HOP.has(k)||v===undefined)continue;headers[k]=Array.isArray(v)?v.join(', '):v;}
   // Solo las peticiones hechas desde esta misma entrada pasan como si vinieran de la web original (protección CSRF intacta).
   if(headers.origin)headers.origin=headers.origin===self?upstream:'https://origen-no-permitido.invalid';
   if(headers.referer)headers.referer=headers.referer.startsWith(self+'/')?upstream+headers.referer.slice(self.length):upstream+'/';
   let body;
   if(!['GET','HEAD'].includes(req.method)){body=req.rawBody;if(!body){const chunks=[];for await(const c of req)chunks.push(c);body=Buffer.concat(chunks);}if(!body.length)body=undefined;}
   const r=await fetch(upstream+url.pathname+url.search,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(250000)});
   const out={};
   r.headers.forEach((v,k)=>{if(!DROP_OUT.has(k)&&k!=='set-cookie')out[k]=v;});
   const cookies=(r.headers.getSetCookie?.()||[]).map(c=>c.replace(/;\s*Domain=[^;]*/i,''));if(cookies.length)out['set-cookie']=cookies;
   if(out.location?.startsWith(upstream))out.location=self+out.location.slice(upstream.length);
   out['x-dupla-entrada']='google';
   const buf=req.method==='HEAD'?null:Buffer.from(await r.arrayBuffer());
   res.writeHead(r.status,out);res.end(buf);
  }catch(ex){
   if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
   res.end(JSON.stringify({error:'La entrada alternativa no pudo llegar a DUPLA: '+String(ex?.message||ex).slice(0,120)}));
  }
 };
}
