// DUPLA push: el contenido llega cifrado de extremo a extremo (RFC 8291); el servicio push (Apple/Google)
// solo transporta bytes opacos y únicamente este dispositivo puede leerlo. Sin contenido: aviso genérico.
self.addEventListener('push',event=>{
 let d=null;try{d=event.data?event.data.json():null;}catch{d=null;}
 const path=typeof d?.path==='string'&&d.path.startsWith('/')?d.path:'/';
 event.waitUntil(self.registration.showNotification(d?.title||'DUPLA · Tienes un aviso',{body:d?.body||'Entra en DUPLA para consultar tus recordatorios compartidos.',icon:'/dupla-icon-192.png',badge:'/dupla-icon-192.png',tag:d?.tag||'dupla-avisos',renotify:Boolean(d),data:{path}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(c=>new URL(c.url).origin===self.location.origin);
  const path=event.notification.data?.path||'/';
  if(existing){await existing.focus();existing.navigate?.(path);return;}
  await clients.openWindow(path);
 })());
});
// Sin cobertura: red primero; si no hay red, la última copia guardada en este dispositivo (se borra al cerrar sesión).
const CACHE='dupla-offline-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const r=event.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==self.location.origin)return;
 const api=u.pathname.startsWith('/api/');if(api&&(u.pathname.startsWith('/api/atajo/')||u.pathname==='/api/ws'||u.pathname.startsWith('/api/google/oauth')||(r.headers.get('accept')||'').includes('text/event-stream')))return;
 event.respondWith((async()=>{
  try{const res=await fetch(r);const type=res.headers.get('content-type')||'';if(res.ok&&res.type==='basic'&&(api?type.includes('application/json'):true)){const c=await caches.open(CACHE);c.put(r,res.clone()).catch(()=>{});}return res;}
  catch(ex){const hit=await caches.match(r,{ignoreVary:true})||(r.mode==='navigate'?await caches.match('/'):null);if(!hit)throw ex;if(!api)return hit;const h=new Headers(hit.headers);h.set('x-dupla-cache','1');return new Response(await hit.blob(),{status:200,headers:h});}
 })());
});
