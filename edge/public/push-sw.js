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
