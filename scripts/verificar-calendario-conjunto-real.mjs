// No secrets or event contents are persisted. Run only on the already-authorized
// production/staging URL. Writes one disposable test event only when explicitly opted in.
const origin=String(process.env.DUPLA_URL||'').replace(/\/$/,'');
if(!/^https:\/\/[a-zA-Z0-9.-]+$/.test(origin))throw Error('DUPLA_URL debe ser una URL HTTPS');
const credentials=[['A',process.env.DUPLA_EMAIL_A,process.env.DUPLA_PASSWORD_A],['B',process.env.DUPLA_EMAIL_B,process.env.DUPLA_PASSWORD_B]];
if(credentials.some(x=>!x[1]||!x[2]))throw Error('Faltan las credenciales privadas de ambos usuarios en variables de entorno');
async function request(path,method='GET',body,cookie){
 const r=await fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual',signal:AbortSignal.timeout(20000)});
 const json=await r.json().catch(()=>({}));if(!r.ok)throw Error(method+' '+path+' HTTP '+r.status+': '+String(json.error||'Error remoto').slice(0,100));
 return {json,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
const cookies=[];
try{
 for(const [label,email,password] of credentials){const login=await request('/api/login','POST',{email,password});if(!login.cookie?.startsWith('dos_session='))throw Error('El usuario '+label+' no pudo iniciar sesión');cookies.push(login.cookie);}
 const A=cookies[0],B=cookies[1];const a=(await request('/api/google/shared/status','GET',null,A)).json;
 const b=(await request('/api/google/shared/status','GET',null,B)).json;
 if(!a.created||a.share_status!=='shared'||a.id!==b.id||!a.owner_connected)throw Error('Calendario conjunto inexistente, sin compartir o sin conexión Google');
 console.log('PASS: mismo calendario conjunto y compartido para ambas cuentas; propietario OAuth disponible.');
 const itemsA=(await request('/api/google/shared/events','GET',null,A)).json.items;
 const itemsB=(await request('/api/google/shared/events','GET',null,B)).json.items;
 if(JSON.stringify(itemsA)!==JSON.stringify(itemsB))throw Error('Las cuentas ven listas de eventos distintas');
 console.log('PASS: los dos usuarios ven los mismos eventos: '+itemsA.length+' (no se imprimen nombres ni datos).');
 if(process.env.DUPLA_TEST_CALENDAR_WRITE==='SI'){
  const day=new Date(Date.now()+9*86400000).toISOString().slice(0,10);
  let id;try{
   id=(await request('/api/google/shared/events','POST',{title:'DUPLA VERIFICACION TEMPORAL',date:day,time:'12:00'},A)).json.id;
   if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('ID del evento de prueba incorrecto');
   const afterB=(await request('/api/google/shared/events','GET',null,B)).json.items;
   const event=afterB.find(x=>x.id===id);if(!event)throw Error('El usuario B no ve el evento creado por A');
   await request('/api/google/shared/events/'+encodeURIComponent(id),'PUT',{title:'DUPLA VERIFICACION EDITADA',date:day,time:'12:30',etag:event.etag},B);
   const afterA=(await request('/api/google/shared/events','GET',null,A)).json.items;
   if(afterA.find(x=>x.id===id)?.title!=='DUPLA VERIFICACION EDITADA')throw Error('El usuario A no ve la edición de B');
   console.log('PASS: creación A, edición B, lectura A, mismo Google Calendar.');
  }finally{if(id){try{await request('/api/google/shared/events/'+encodeURIComponent(id),'DELETE',null,A);console.log('PASS: evento temporal eliminado.');}catch(e){console.error('AVISO: eliminar manualmente el evento de prueba '+id);throw e;}}}
 }else console.log('PRUEBA DE ESCRITURA PENDIENTE: necesita DUPLA_TEST_CALENDAR_WRITE=SI; no se ha creado ni borrado ningún evento.');
 console.log('MÓVILES: aceptad la invitación de Google y verificad un cambio desde ambas apps Google Calendar. No se puede certificar desde este script.');
}finally{for(const c of cookies)await request('/api/logout','POST',{},c).catch(()=>{});}
