// Creates just one ephemeral test project. Requires two explicit account logins.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openAuthenticatedSocket } from './websocket-verify.mjs';
const origin=String(process.env.DUPLA_URL||'').replace(/\/$/,'');
if(!/^https:\/\/[^/]+$/.test(origin))throw Error('DUPLA_URL debe ser el origen HTTPS del Worker publicado');
for(const n of ['DUPLA_EMAIL_A','DUPLA_PASSWORD_A','DUPLA_EMAIL_B','DUPLA_PASSWORD_B'])if(!process.env[n])throw Error('Falta '+n+' (introducirla de forma privada, nunca aquí)');
async function api(path,method='GET',body,cookie){
 const r=await fetch(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
 let data={};try{data=await r.json()}catch{}
 return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password){const r=await api('/api/login','POST',{email,password});assert.equal(r.status,200,'No ha podido iniciar sesión una de las cuentas');assert(r.cookie?.startsWith('dos_session='));return r.cookie;}
let a,b,id,ws;let failure;
try{
 a=await login(process.env.DUPLA_EMAIL_A,process.env.DUPLA_PASSWORD_A);
 b=await login(process.env.DUPLA_EMAIL_B,process.env.DUPLA_PASSWORD_B);
 const project=await api('/api/projects','POST',{space:'work',title:'TEST WS DUPLA '+randomBytes(5).toString('hex')},a);
 assert.equal(project.status,201,'No se pudo crear el proyecto temporal');id=project.data.project.id;
 // Opening the second user's real WebSocket is essential: REST success alone
 // does not establish real-time collaboration.
 ws=await openAuthenticatedSocket(origin,b);
 const waiter=ws.nextMessage(18000);
 const task=await api(`/api/projects/${id}/tasks`,'POST',{title:'Comprobación WebSocket '+Date.now()},a);
 assert.equal(task.status,201,'El primer usuario no pudo guardar la tarea');
 const message=await waiter;
 assert.equal(message.projectId,id,'La segunda sesión recibió un evento ajeno al proyecto de prueba');
 assert.equal(message.space,'work','Espacio del mensaje incorrecto');
 const fromB=await api('/api/projects/'+id,'GET',undefined,b);
 assert.equal(fromB.status,200);assert(fromB.data.project.tasks.some(t=>t.id===task.data.item.id));
 console.log('OK: WebSocket 101 autenticado + evento en tiempo real + tarea persistida en segunda cuenta.');
}catch(ex){failure=ex;console.error('FALLO de sincronización real:',ex.message);}
finally{
 ws?.close();
 if(id&&a){try{const deletion=await api('/api/projects/'+id,'DELETE',undefined,a);const purge=await api('/api/trash/'+id+'/purge','POST',{},a);if(deletion.status!==200||purge.status!==200){console.error('ATENCION: revisa proyecto de prueba pendiente en la papelera.');process.exitCode=1;}}catch{console.error('ATENCION: no se pudo limpiar el proyecto temporal.');process.exitCode=1;}}
 if(failure)process.exitCode=1;
}
