import assert from 'node:assert/strict';
import {openAuthenticatedSocket} from './websocket-verify.mjs';
const origin='http://127.0.0.1:39773';
async function req(path,method='GET',data,cookie){
 const res=await fetch(origin+path,{method,headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
 let out;try{out=await res.json()}catch{out={}};
 return {status:res.status,data:out,cookie:res.headers.get('set-cookie')?.split(';')[0]};
}
async function login(email,password){const x=await req('/api/login','POST',{email,password});assert.equal(x.status,200,JSON.stringify(x.data));return x.cookie;}
let a,b,wsA,wsB,wsAgain;
try{
 a=await login('usuario1@ejemplo.invalid','PruebaUna2026_Segura!');b=await login('usuario2@ejemplo.invalid','PruebaDos2026_Segura!');
 assert.notEqual(a,b);
 wsA=await openAuthenticatedSocket(origin,a,6000);wsB=await openAuthenticatedSocket(origin,b,6000);
 const waiterB=wsB.nextMessage(6000);
 const created=await req('/api/projects','POST',{space:'work',title:'Sincronización navegación local'},a);
 assert.equal(created.status,201);const id=created.data.project.id;
 const evt=await waiterB;assert.equal(evt.projectId,id);console.log('PASS: evento creación de proyecto recibido por sesión B');
 const waiterA=wsA.nextMessage(6000);
 const task=await req(`/api/projects/${id}/tasks`,'POST',{title:'Nota de cambio desde B'},b);assert.equal(task.status,201);
 const evtA=await waiterA;assert.equal(evtA.projectId,id);console.log('PASS: evento bidireccional desde sesión B recibido por A');
 wsB.close();wsB=null;
 await req(`/api/tasks/${task.data.item.id}`,'PATCH',{revision:1,title:'Edición durante desconexión'},a);
 wsAgain=await openAuthenticatedSocket(origin,b,6000);
 const restored=await req(`/api/projects/${id}`,'GET',undefined,b);
 assert.equal(restored.data.project.tasks[0].title,'Edición durante desconexión');console.log('PASS: desconexión/reconexión + estado persistido recuperado');
 const unauthorized=await req('/api/logout','POST',{},b);assert.equal(unauthorized.status,200);console.log('PASS: logout sesión B');
 const denied=await req(`/api/projects/${id}`,'GET',undefined,b);assert.equal(denied.status,401);console.log('PASS: sesión B invalidada tras cierre');
 wsA.close();wsA=null;wsAgain.close();wsAgain=null;
}catch(e){console.error('FAIL:',e);process.exitCode=1;}finally{wsA?.close();wsB?.close();wsAgain?.close();}
