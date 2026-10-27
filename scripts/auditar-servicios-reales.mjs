// Auditoría ON-LINE. No inventa resultados ni usa credenciales ficticias.
// El archivo resultante no incluye contraseñas, cookies, tokens ni contenido privado.
import { writeFileSync } from 'node:fs';
const origin=String(process.env.DUPLA_URL||'').replace(/\/$/,'');
if(!/^https:\/\/[-a-zA-Z0-9.]+$/.test(origin))throw Error('Indica DUPLA_URL como origen HTTPS');
const email=process.env.DUPLA_EMAIL_A,password=process.env.DUPLA_PASSWORD_A;
if(!email||!password)throw Error('Faltan credenciales privadas. Usa AUDITAR_SERVICIOS_REALES.ps1');
async function api(path,method='GET',body,cookie){
 const r=await fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(25000)});
 let data;try{data=await r.json()}catch{data={}}return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const results=[];const record=(service,state,details)=>{results.push({service,state,details});console.log(`[${state}] ${service}: ${details}`);};
const login=await api('/api/login','POST',{email,password});
if(login.status!==200||!login.cookie?.startsWith('dos_session='))throw Error('No se pudo iniciar sesión en la cuenta autorizada');
const cookie=login.cookie;
try{
 const system=await api('/api/ops/health','GET',undefined,cookie);
 if(system.status===200&&system.data.database_probe==='ok'&&system.data.database_integrity==='ok')record('SQLite Cloudflare','VERIFICADO','Integridad y lectura SQL confirmadas por el Worker');
 else record('SQLite Cloudflare','FALLO','No se ha confirmado integridad SQL');
 const backup=await api('/api/backups/status','GET',undefined,cookie);
 if(backup.status!==200)record('Copias independientes','FALLO','No se pudo leer estado de R2');
 else if(!backup.data.enabled)record('Copias independientes','PENDIENTE','Falta enlazar bucket R2 privado; solo existe copia manual');
 else if(!backup.data.last?.date)record('Copias independientes','PENDIENTE','R2 conectado, pero todavía no existe una copia finalizada');
 else{
  const check=await api('/api/backups/verify?date='+encodeURIComponent(backup.data.last.date),'GET',undefined,cookie);
  record('Copias independientes',check.status===200&&check.data.ok?'VERIFICADO':'FALLO',check.status===200?`Copia ${backup.data.last.date}, ${check.data.files} archivos, checksum validado`:'Copia no comprobable o incompatible');
 }
 const google=await api('/api/google/status','GET',undefined,cookie);
 if(google.status!==200)record('Google Calendar','FALLO','Error consultando la conexión');
 else if(!google.data.available)record('Google Calendar','PENDIENTE','Faltan credenciales OAuth en Cloudflare');
 else if(!google.data.connected)record('Google Calendar','PENDIENTE','Esta persona no ha autorizado Google');
 else{const status=await api('/api/google/shared/status','GET',undefined,cookie);
  if(status.status!==200||!status.data.created||status.data.share_status!=='shared')record('Google Calendar conjunto','PENDIENTE','Calendario nuevo o invitaciones todavía no completadas');
  else {const events=await api('/api/google/shared/events','GET',undefined,cookie);
   record('Google Calendar conjunto',events.status===200?'VERIFICADO':'FALLO',events.status===200?'Lectura real de calendario compartido completada; falta verificación del segundo usuario y móviles':'Google no ha permitido leer el calendario conjunto');}
 }
 for(const provider of ['figma','canva']){
  const c=await api(`/api/design/${provider}/status`,'GET',undefined,cookie);
  if(c.status!==200){record(provider,'FALLO','Error consultando conexión');continue;}
  if(!c.data.available){record(provider,'PENDIENTE','Faltan credenciales OAuth del proveedor');continue;}
  if(!c.data.connected){record(provider,'PENDIENTE','Esta persona no ha autorizado su cuenta');continue;}
  if(provider==='figma'){
   const file=String(process.env.DUPLA_FIGMA_FILE_URL||'');
   if(!file){record('Figma','PENDIENTE','Autorizado, falta probar acceso real a un archivo desde Conexiones');continue;}
   const r=await api('/api/design/figma/check?url='+encodeURIComponent(file),'GET',undefined,cookie);
   record('Figma',r.status===200?'VERIFICADO':'FALLO',r.status===200?'API Figma ha confirmado acceso al archivo elegido':'Figma no ha confirmado acceso al archivo');
  } else {
   const r=await api('/api/design/canva/list','GET',undefined,cookie);
   record('Canva',r.status===200?'VERIFICADO':'FALLO',r.status===200?'API Canva ha respondido con diseños de la cuenta autorizada':'Canva no ha respondido correctamente');
  }
 }
 const dash=await api('/api/dashboard','GET',undefined,cookie);
 for(const [kind,enabled] of [['ai',!!dash.data?.integrations?.ai],['webhook',!!dash.data?.integrations?.webhook]]){
  if(!enabled){record(kind,'PENDIENTE','Proveedor no configurado');continue;}
  if(process.env.DUPLA_TEST_EXTERNAL!=='SI'){record(kind,'PENDIENTE','Configurado; no se ha autorizado llamada de prueba a proveedor externo');continue;}
  const r=await api('/api/integrations/test','POST',{type:kind},cookie);
  record(kind,r.status===200?'VERIFICADO':'FALLO',r.status===200?'Receptor externo ha devuelto éxito real':'Llamada externa rechazada; comprueba el registro de integraciones');
 }
 const push=await api('/api/push/status','GET',undefined,cookie);
 if(push.status!==200)record('Web Push','FALLO','Error de estado');
 else if(!push.data.available)record('Web Push','PENDIENTE','Falta configurar VAPID');
 else if(!push.data.subscriptions)record('Web Push','PENDIENTE','VAPID listo; este usuario no tiene dispositivos suscritos');
 else record('Web Push','PENDIENTE','Suscripciones registradas; requiere prueba y confirmación visible en el dispositivo');
 const prefs=await api('/api/notifications/preferences','GET',undefined,cookie);
 if(prefs.status!==200)record('Correo Resend','FALLO','No se pudieron consultar preferencias');
 else if(!prefs.data?.email_enabled)record('Correo Resend','PENDIENTE','Avisos no habilitados para esta cuenta');
 else if(process.env.DUPLA_TEST_EXTERNAL!=='SI')record('Correo Resend','PENDIENTE','Avisa por correo, pero no se autorizó enviar la prueba');
 else{
  const r=await api('/api/notifications/email/test','POST',{},cookie);
  record('Correo Resend',r.status===200?'PENDIENTE':'FALLO',r.status===200?'Proveedor aceptó envío; falta confirmar recepción en bandeja':'Error en envío real de prueba');
 }
}finally{await api('/api/logout','POST',{},cookie).catch(()=>{});}
const summary={generated_at:new Date().toISOString(),url:origin,results,counts:{verified:results.filter(x=>x.state==='VERIFICADO').length,blocked:results.filter(x=>x.state==='PENDIENTE').length,failed:results.filter(x=>x.state==='FALLO').length}};
writeFileSync(new URL('../../AUDITORIA_PROVEEDORES_RESULTADO.json',import.meta.url),JSON.stringify(summary,null,2));
console.log(`Resultado: ${summary.counts.verified} verificados, ${summary.counts.blocked} pendientes, ${summary.counts.failed} fallidos. Sin almacenar secretos.`);
if(summary.counts.failed)process.exitCode=1;
