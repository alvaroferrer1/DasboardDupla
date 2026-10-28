
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createDB } from './db.mjs';
import { validateWebhookUrl, extractTasksFromAI } from './integrations.mjs';
import {configured as googleConfigured, randomState, authorizationUrl, encryptToken, decryptToken, tokenRequest, googleRequest, toGoogleEvent, validSharedCalendarId, validSharedEventId, normalizedSharedEvent} from './google-calendar.mjs';
import {configured as designConfigured, spec as designSpec, authUrl as designAuthUrl, tokenRequest as designTokenRequest, remote as designRemote, figmaKey, safeCanvaUrl} from './design-providers.mjs';
import {config as pushConfigured,isAllowedPushEndpoint,sendPush,validKeys as validPushKeys} from './web-push.mjs';
import {createV6,SHARED_CALENDAR_ID} from './v6.mjs';
export function createApi(storage, env, ctx) {
 const {db,all,get,run,now,uid,touch,activity,hashPassword,verifyPassword,saveFile,readFile,fileExists,removeFile,makeRateMap}=createDB(storage);
 const SECURE=true;
 const clients=new Set();
 const loginAttempts=makeRateMap();
 const setupAttempts=makeRateMap();
 const SETUP_TOKEN=String(env.SETUP_TOKEN||'');
 const PUBLIC_ORIGIN=String(env.PUBLIC_ORIGIN||'').replace(/\/$/,'');
 if(SETUP_TOKEN && SETUP_TOKEN.length<32)throw Error('SETUP_TOKEN demasiado corto');
 const v6=createV6({env,all,get,run,now,uid,saveFile,readFile,fileExists,removeFile,respond,fail,readBody,requireText,optional,choice,validDate,money,project,projectList,logChange,notify,logFree:(user,space,action,detail)=>{activity(null,space,user.id,action,detail);notifyPartner(user.id,null,space,action,detail);notify(space,null,user.id);}});
function respond(res,status,data,extra={}){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data));}
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
function requireText(value,name,max=250){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,`${name}: obligatorio, máximo ${max} caracteres`);return value.trim();}
function optional(value,max=12000){if(value===null||value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(400,`Texto demasiado largo (máximo ${max})`);return value;}
function choice(value,options,defaultValue){const v=value??defaultValue;if(!options.includes(v))fail(400,'Valor no permitido');return v;}
function validTime(value){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))fail(400,'La hora debe tener formato HH:MM');return value;}
function booking(value,defaultValue='pending'){return choice(value,['pending','booked','cancelled','not_needed'],defaultValue);}
function recurrence(value, defaultValue='none'){return choice(value,['none','daily','weekly','monthly'],defaultValue);}
function nextOccurrence(due,period,monthlyDay){
 if(period==='none')return null;
 // UTC arithmetic avoids timezone-dependent date drift; monthly dates clamp to month end.
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let basis=due&&due>today?due:today;
 let d=new Date(basis+'T12:00:00Z');
 if(period==='daily')d.setUTCDate(d.getUTCDate()+1);
 else if(period==='weekly')d.setUTCDate(d.getUTCDate()+7);
 else {const day=monthlyDay||d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));}
 return d.toISOString().slice(0,10);
}
function validateBlocker(projectId,taskId,blockedBy){
 if(!blockedBy)return null;
 if(!/^[a-f0-9-]{36}$/.test(String(blockedBy))||blockedBy===taskId)fail(400,'Dependencia inválida');
 const predecessor=get('SELECT id,project_id,blocked_by FROM tasks WHERE id=?',blockedBy);
 if(!predecessor||predecessor.project_id!==projectId)fail(400,'La dependencia debe pertenecer al mismo proyecto');
 let current=predecessor;const visited=new Set();
 while(current){if(current.id===taskId)fail(400,'Las dependencias no pueden formar un ciclo');if(visited.has(current.id))fail(400,'Cadena de dependencias inválida');visited.add(current.id);current=current.blocked_by?get('SELECT id,blocked_by FROM tasks WHERE id=?',current.blocked_by):null;}
 return blockedBy;
}
function requireUnblocked(blockedBy){if(!blockedBy)return;const predecessor=get('SELECT state,title FROM tasks WHERE id=?',blockedBy);if(predecessor?.state!=='done')fail(409,'Completa primero la tarea dependiente: '+(predecessor?.title||'dependencia pendiente'));}
function money(value){const n=Number(value??0);if(!Number.isFinite(n)||n<0||n>100000000)fail(400,'Introduce un importe válido');return Math.round(n*100)/100;}
function validDate(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))fail(400,'Fecha no válida');
 const [year,month,day]=value.split('-').map(Number);
 const check=new Date(Date.UTC(year,month-1,day));
 if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day)fail(400,'Fecha no válida');
 return value;
}
function sha(token){return createHash('sha256').update(token).digest('hex');}
// DUPLA 6: tablas y archivos extra que deben viajar en la copia completa.
const V6_TABLES=['agent_memory','shared_settings','user_prefs','connections','calendar_marks','trip_days','couple_items','project_quotes','meetings','meeting_segments','director_states','board_tasks','dest_notes'];
function v6Files(data){const out=(data.projects||[]).map(p=>p.cover_file).filter(Boolean);const av=(data.shared_settings||[]).find(r=>r.key==='dupla_avatar');if(av){try{out.push(JSON.parse(av.value));}catch{}}return out.filter(n=>typeof n==='string'&&/^[a-f0-9-]{36}$/.test(n));}
// Nombre legible del dispositivo para «Sesiones activas» (solo sistema y navegador, nada identificable).
function deviceName(ua=''){ua=String(ua);const os=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac OS X|Macintosh/.test(ua)?'Mac':/Linux/.test(ua)?'Linux':'Dispositivo';const br=/Edg\//.test(ua)?'Edge':/OPR\//.test(ua)?'Opera':/Firefox\//.test(ua)?'Firefox':/CriOS|Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'Navegador';return `${os} · ${br}`;}
function userFromReq(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dos_session='));if(!cookie)return null;const token=cookie.slice(12);if(!/^[a-f0-9]{64}$/.test(token))return null;return get(`SELECT users.id,users.name,users.email,sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`,sha(token),now())||null;}
function auth(req){const user=userFromReq(req);if(!user)fail(401,'Inicia sesión para continuar');return user;}
function isSessionActive(sessionHash){if(!/^[a-f0-9]{64}$/.test(String(sessionHash||'')))return false;return Boolean(get('SELECT 1 AS active FROM sessions WHERE token_hash=? AND expires_at>?',sessionHash,now()));}
function checkSpace(row){if(!row)fail(404,'Proyecto no encontrado');return row;}
function project(id){return checkSpace(get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',id));}
function projectList(){return all(`SELECT p.*,u.name AS creator,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id) AS tasks_total,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.state='done') AS tasks_done FROM projects p LEFT JOIN users u ON p.created_by=u.id WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`);}
function detail(id){const p=project(id);if(p.deleted_at)fail(404,'Proyecto en la papelera');return {...p,tasks:all('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at DESC',id),checklists:all('SELECT c.* FROM checklist_items c JOIN tasks t ON c.task_id=t.id WHERE t.project_id=? ORDER BY c.created_at ASC',id),milestones:all('SELECT * FROM milestones WHERE project_id=? ORDER BY due_date ASC,created_at ASC',id),decisions:all('SELECT * FROM decisions WHERE project_id=? ORDER BY created_at DESC',id).map(d=>({...d,choices:JSON.parse(d.choices_json),votes:all('SELECT v.*,u.name AS voter FROM decision_votes v JOIN users u ON u.id=v.user_id WHERE v.decision_id=?',d.id)})),expenses:all('SELECT * FROM expenses WHERE project_id=? ORDER BY created_at ASC',id),sections:all('SELECT * FROM sections WHERE project_id=? ORDER BY sort_order ASC,created_at ASC',id),events:all('SELECT * FROM events WHERE project_id=? ORDER BY event_date ASC',id),links:all('SELECT * FROM links WHERE project_id=? ORDER BY created_at DESC',id),assets:all('SELECT id,project_id,name,mime,size,created_by,created_at FROM assets WHERE project_id=? ORDER BY created_at DESC',id),comments:all('SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE project_id=? ORDER BY c.created_at ASC',id),activities:all('SELECT a.*,u.name AS author FROM activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.project_id=? ORDER BY a.created_at DESC LIMIT 80',id)};}
function notify(space,projectId,actor){
 const message=JSON.stringify({space,projectId,actor,at:now()});
 for(const ws of ctx.getWebSockets?.()||[]){try{const attachment=ws.deserializeAttachment?.();if(!attachment?.sessionHash || !isSessionActive(attachment.sessionHash)){ws.close(1008,'Sesión cerrada');continue;}ws.send(message);}catch{try{ws.close();}catch{}}}
}
const NOTICE_TYPES=['events','tasks','projects','comments','trip_reminders','budget','ideas'];
function noticeType(action=''){const a=String(action).toLowerCase();return /resumen del día/.test(a)?'daily':/aviso de dupla/.test(a)?'agent':/viaje/.test(a)&&/recordatorio/.test(a)?'trip_reminders':/coment/.test(a)?'comments':/gasto|presupuesto/.test(a)?'budget':/idea/.test(a)?'ideas':/tarea|hito/.test(a)?'tasks':/plan|evento|fecha|calendario/.test(a)?'events':'projects';}
function userNoticeTypes(userId){const r=get("SELECT value FROM user_prefs WHERE user_id=? AND key='notify_types'",userId);try{return r?JSON.parse(r.value):NOTICE_TYPES;}catch{return NOTICE_TYPES;}}
function userPref(userId,key,fallback){const r=get('SELECT value FROM user_prefs WHERE user_id=? AND key=?',userId,key);try{return r?JSON.parse(r.value):fallback;}catch{return fallback;}}
// Envío inmediato (además de la revisión horaria): el aviso llega al móvil en segundos.
function kickPush(){if(!pushConfigured(env))return;const job=flushPushNotices().catch(ex=>console.error('Push inmediato',String(ex.message||ex).slice(0,120)));if(ctx.waitUntil)ctx.waitUntil(job);}
function queueExternalNotice(notificationId,userId,space){
 const prefs=get('SELECT * FROM notification_preferences WHERE user_id=?',userId);
 if(!prefs||(space==='couple'?!prefs.couple_enabled:!prefs.work_enabled))return;
 // R0234-R0241: los tipos elegidos en Ajustes filtran push y correo; dentro de DUPLA se ve todo.
 const n=get('SELECT action FROM notifications WHERE id=?',notificationId),nt=n&&noticeType(n.action);if(nt==='daily'||nt==='agent'){if(!userPref(userId,nt==='daily'?'daily_summary':'agent_alerts',true))return;}else if(n&&!userNoticeTypes(userId).includes(nt))return;
 if(prefs.email_enabled)run("INSERT OR IGNORE INTO notification_delivery(notification_id,user_id,status,attempts,next_attempt_at,last_error,created_at) VALUES(?,?,'pending',0,0,'',?)",notificationId,userId,now());
 if(prefs.push_enabled && pushConfigured(env))for(const sub of all('SELECT id FROM push_subscriptions WHERE user_id=?',userId))
  run("INSERT OR IGNORE INTO push_delivery(notification_id,subscription_id,status,attempts,next_attempt_at,last_error) VALUES(?,?,'pending',0,0,'')",notificationId,sub.id);
}
 // Durable, reviewable proposals. Creation is read-only against project data;
 // execution remains impossible until an authenticated member explicitly approves.
 function syncGuardianProposals(){
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());let created=0;
  for(const issue of directorIssues()){
   const result=run(`INSERT OR IGNORE INTO guardian_proposals(id,project_id,issue_type,notice_date,title,detail,task_title,severity,status,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,uid(),issue.project_id,issue.type,today,issue.title,issue.detail,issue.task_title,issue.severity,'proposed',now());
   created+=result.changes;
  }
  return {created};
 }
 // Real-time operational review from persistent work data; no external AI, no personal-space exposure.
 function directorIssues(){
  const projects=all("SELECT id,title FROM projects WHERE space='work' AND deleted_at IS NULL AND archived=0");
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const found=[];
  for(const p of projects){
   const overdue=get("SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND state!='done' AND due_date IS NOT NULL AND due_date<?",p.id,today).n;
   const blocked=get("SELECT COUNT(*) AS n FROM tasks t JOIN tasks x ON x.id=t.blocked_by WHERE t.project_id=? AND t.state!='done' AND x.state!='done'",p.id).n;
   const tasks=get('SELECT COUNT(*) AS n FROM tasks WHERE project_id=?',p.id).n;
   const cost=get('SELECT COALESCE(SUM(estimated),0) AS estimated,COALESCE(SUM(actual),0) AS actual FROM expenses WHERE project_id=?',p.id);
   if(overdue)found.push({id:p.id+':overdue',project_id:p.id,project_title:p.title,type:'overdue',severity:'high',title:`${overdue} tareas vencidas`,detail:'Revisar fechas y replantear prioridades.',task_title:'Revisar tareas vencidas y actualizar fechas'});
   if(blocked)found.push({id:p.id+':blocked',project_id:p.id,project_title:p.title,type:'blocked',severity:'medium',title:`${blocked} tareas bloqueadas`,detail:'Hay dependencias pendientes que impiden avanzar.',task_title:'Desbloquear dependencias del proyecto'});
   if(!tasks)found.push({id:p.id+':empty',project_id:p.id,project_title:p.title,type:'empty',severity:'low',title:'Proyecto sin tareas',detail:'Convertir las ideas del proyecto en próximos pasos concretos.',task_title:'Definir primeros pasos del proyecto'});
   if(cost.actual>cost.estimated&&cost.actual>0)found.push({id:p.id+':budget',project_id:p.id,project_title:p.title,type:'budget',severity:'medium',title:'Gasto superior al previsto',detail:'Revisar conceptos del presupuesto y acordar decisiones.',task_title:'Revisar desviación de presupuesto'});
  }
  return found.slice(0,60);
 }

function processGuardianReview(){
 // Deterministic, opt-in-free internal alerts only: never sends project data to a language model.
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const items=all("SELECT p.id,p.title,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.state!='done' AND t.due_date<?) AS overdue,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id) AS task_count,(SELECT count(*) FROM tasks t LEFT JOIN tasks b ON b.id=t.blocked_by WHERE t.project_id=p.id AND t.state!='done' AND t.blocked_by IS NOT NULL AND (b.id IS NULL OR b.state!='done')) AS blocked,(SELECT sum(actual)-sum(estimated) FROM expenses x WHERE x.project_id=p.id) AS delta FROM projects p WHERE p.space='work' AND p.archived=0 AND p.deleted_at IS NULL",today);
 const people=all('SELECT id FROM users');let created=0;
 for(const item of items){
  const issues=[];
  if(item.overdue>0)issues.push({kind:'overdue',text:item.overdue+' tareas vencidas'});
  if(item.blocked>0)issues.push({kind:'blocked',text:item.blocked+' tareas bloqueadas por dependencias'});
  if(item.task_count===0)issues.push({kind:'empty',text:'Proyecto activo sin tareas; conviene definir próximos pasos'});
  if(item.delta>0.01)issues.push({kind:'budget',text:'Gasto superior al presupuesto'});
  for(const issue of issues){for(const person of people){
   const row=run('INSERT OR IGNORE INTO guardian_daily_notices(user_id,project_id,issue_type,notice_date) VALUES(?,?,?,?)',person.id,item.id,issue.kind,today);
   if(row.changes){const nid=uid();run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',nid,person.id,item.id,'work',null,'Director General: revisión preventiva',issue.text+' · '+item.title.slice(0,100),now(),null);queueExternalNotice(nid,person.id,'work');created++;}
  }}
 }
 const proposals=syncGuardianProposals();
 if(created||proposals.created)notify('work',null,null);return {notices:created,proposals:proposals.created,reviewed_projects:items.length,checked_at:now()};
}
async function flushExternalNotices(){
 const enabled=Boolean(env.RESEND_API_KEY&&env.NOTIFY_FROM_EMAIL);
 if(!enabled)return {sent:0,configured:false};
 const pending=all("SELECT d.notification_id,d.user_id,d.attempts,n.action,n.detail,n.space,u.email FROM notification_delivery d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=d.user_id WHERE d.status='pending' AND d.next_attempt_at<=? ORDER BY d.created_at ASC LIMIT 12",Date.now());
 let sent=0;
 for(const item of pending){
  const prefs=get('SELECT * FROM notification_preferences WHERE user_id=?',item.user_id);
  if(!prefs?.email_enabled||!(item.space==='couple'?prefs.couple_enabled:prefs.work_enabled)){
   run("UPDATE notification_delivery SET status='cancelled' WHERE notification_id=?",item.notification_id);continue;
  }
  let failed='';try{
   const result=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.RESEND_API_KEY,'Idempotency-Key':'dupla-'+item.notification_id},body:JSON.stringify({from:env.NOTIFY_FROM_EMAIL,to:[item.email],subject:'DUPLA · Recordatorio',text:`DUPLA te recuerda: ${item.action}\n${item.detail}\n\nEntra en vuestra aplicación para consultar los detalles.`}),signal:AbortSignal.timeout(12000)});
   if(!result.ok)failed='HTTP '+result.status;
  }catch(e){failed=String(e.message||'Error de red').slice(0,120);}
  if(!failed){run("UPDATE notification_delivery SET status='sent',attempts=attempts+1,last_error='' WHERE notification_id=?",item.notification_id);sent++;}
  else{const attempts=item.attempts+1;run('UPDATE notification_delivery SET attempts=?,status=?,last_error=?,next_attempt_at=? WHERE notification_id=?',attempts,attempts>=5?'failed':'pending',failed,Date.now()+Math.min(86400000,60000*2**attempts),item.notification_id);}
 }
 return {sent,configured:true};
}
async function flushPushNotices(){
 if(!pushConfigured(env))return {sent:0,configured:false};
 // Reclamo atómico: rondas simultáneas (envío inmediato + alarma) nunca envían el mismo aviso dos veces.
 const claim='claim:'+uid(),t0=Date.now();
 run("UPDATE push_delivery SET status='pending' WHERE status='sending' AND next_attempt_at<?",t0-600000);
 run("UPDATE push_delivery SET status='sending',last_error=?,next_attempt_at=? WHERE rowid IN (SELECT rowid FROM push_delivery WHERE status='pending' AND next_attempt_at<=? LIMIT 12)",claim,t0,t0);
 const items=all("SELECT d.notification_id,d.subscription_id,d.attempts,s.endpoint,s.p256dh,s.auth,s.user_id,n.space,n.action,n.detail,n.project_id,a.name AS actor_name,p.title AS project_title FROM push_delivery d JOIN push_subscriptions s ON s.id=d.subscription_id JOIN notifications n ON n.id=d.notification_id LEFT JOIN users a ON a.id=n.actor_id LEFT JOIN projects p ON p.id=n.project_id WHERE d.status='sending' AND d.last_error=?",claim);
 let sent=0;
 for(const item of items){
  const prefs=get('SELECT * FROM notification_preferences WHERE user_id=?',item.user_id);
  if(!prefs?.push_enabled||(item.space==='couple'?!prefs.couple_enabled:!prefs.work_enabled)){
   run("UPDATE push_delivery SET status='cancelled' WHERE notification_id=? AND subscription_id=?",item.notification_id,item.subscription_id);continue;
  }
  let error='',remove=false;
  // Contenido real cifrado de extremo a extremo (solo lo puede leer el móvil destinatario).
  const reminder=/recordatorio/i.test(item.action);
  const payload={title:reminder?'DUPLA · Recordatorio':`DUPLA · ${item.actor_name||'Aviso'}`,body:`${reminder?'':item.action+' '}${item.detail?'«'+item.detail+'»':''}${item.project_title?' · '+item.project_title:''}`.trim().slice(0,240),path:item.project_id?'/?p='+item.project_id:'/?v=notices',tag:item.notification_id};
  try{const response=await sendPush(env,item.endpoint,{p256dh:item.p256dh,auth:item.auth},payload,reminder?'high':'normal');if(!response.ok){error='HTTP '+response.status;remove=response.remove;}}
  catch(ex){error=String(ex.message||ex).slice(0,120);}
  if(remove){run('DELETE FROM push_subscriptions WHERE id=?',item.subscription_id);continue;}
  if(!error){run("UPDATE push_delivery SET status='sent',attempts=attempts+1,last_error='' WHERE notification_id=? AND subscription_id=?",item.notification_id,item.subscription_id);sent++;}
  else{const count=item.attempts+1;run('UPDATE push_delivery SET attempts=?,status=?,last_error=?,next_attempt_at=? WHERE notification_id=? AND subscription_id=?',count,count>=4?'failed':'pending',error,Date.now()+Math.min(86400000,60000*2**count),item.notification_id,item.subscription_id);}
 }
 return {sent,configured:true};
}
function processReminders(){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+1);
 const last=end.toISOString().slice(0,10);
 const tasks=all(`SELECT t.id,t.title,t.due_date,t.assigned_to,p.id AS project_id,p.space FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.state!='done' AND t.due_date BETWEEN ? AND ? AND p.deleted_at IS NULL AND p.archived=0`,today,last);
 let sent=0;const users=all('SELECT id FROM users');
 // R0239: cada persona elige cuándo (mismo día, día antes o ambos; por defecto ambos, como antes).
 const leadOk=(userId,date)=>{const lead=userPref(userId,'reminder_lead','both');return lead==='both'||(lead==='same_day'?date===today:date!==today);};
 for(const item of tasks){const recipients=item.assigned_to?users.filter(x=>x.id===item.assigned_to):users;
  for(const recipient of recipients){if(!leadOk(recipient.id,item.due_date))continue;const row=run('INSERT OR IGNORE INTO reminder_sent(task_id,user_id,notice_date) VALUES(?,?,?)',item.id,recipient.id,today);
   if(row.changes){const notificationId=uid();run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',notificationId,recipient.id,item.project_id,item.space,null,'recordatorio de tarea',item.title+' · '+(item.due_date===today?'vence hoy':'vence mañana'),now(),null);queueExternalNotice(notificationId,recipient.id,item.space);sent++;}
  }
 }
 const events=all(`SELECT e.id,e.title,e.event_date,p.id AS project_id,p.space FROM events e JOIN projects p ON p.id=e.project_id WHERE e.event_date BETWEEN ? AND ? AND p.deleted_at IS NULL AND p.archived=0`,today,last);
 for(const item of events){for(const recipient of users){if(!leadOk(recipient.id,item.event_date))continue;const row=run('INSERT OR IGNORE INTO reminder_sent(task_id,user_id,notice_date) VALUES(?,?,?)','event:'+item.id,recipient.id,today);if(row.changes){const notificationId=uid();run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',notificationId,recipient.id,item.project_id,item.space,null,'recordatorio de plan',item.title+' · '+item.event_date,now(),null);queueExternalNotice(notificationId,recipient.id,item.space);sent++;}}}
 // Recordatorio de viaje (R0239): el día antes y el día de salida.
 const trips=all("SELECT id,title,destination,start_date,space FROM projects WHERE deleted_at IS NULL AND archived=0 AND start_date BETWEEN ? AND ? AND (kind IN ('trip','weekend') OR destination!='')",today,last);
 for(const t of trips)for(const recipient of users){if(!leadOk(recipient.id,t.start_date))continue;const row=run('INSERT OR IGNORE INTO reminder_sent(task_id,user_id,notice_date) VALUES(?,?,?)','trip:'+t.id,recipient.id,today);
  if(row.changes){const notificationId=uid();run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',notificationId,recipient.id,t.id,t.space,null,'recordatorio de viaje',`${t.destination||t.title} · ${t.start_date===today?'¡salís hoy!':'salís mañana'}`,now(),null);queueExternalNotice(notificationId,recipient.id,t.space);sent++;}}
 if(sent){notify('all',null,null);kickPush();}
 return {sent,checked_at:now()};
}
// ---- Dupla proactiva: resumen de cada mañana (8:00 Madrid) y avisos inteligentes (9-21 h) ----
const madridNow=()=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour)};};
async function sharedOwnerToken(){const rec=get("SELECT * FROM google_shared_calendar WHERE singleton='main'");if(!rec||!googleConfigured(env))return null;const c=get('SELECT * FROM google_connections WHERE user_id=?',rec.owner_user_id);if(!c)return null;
 const t=await decryptToken(env,c.encrypted_token);if(c.expires_at>Date.now()+60000)return {rec,token:t.access_token};if(!t.refresh_token)return null;
 const r=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:t.refresh_token});run('UPDATE google_connections SET encrypted_token=?,expires_at=? WHERE user_id=?',await encryptToken(env,{access_token:r.access_token,refresh_token:r.refresh_token||t.refresh_token,scope:r.scope||t.scope}),Date.now()+Number(r.expires_in||3600)*1000,c.user_id);return {rec,token:r.access_token};}
function setShared(key,value){run('INSERT INTO shared_settings(key,value,updated_by,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',key,JSON.stringify(value),now());}
function getShared(key){const r=get('SELECT value FROM shared_settings WHERE key=?',key);try{return r?JSON.parse(r.value):null;}catch{return null;}}
function noticeTo(userId,action,detail,projectId=null,space='couple'){const id=uid();run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',id,userId,projectId,space,null,action,String(detail).slice(0,220),now(),null);queueExternalNotice(id,userId,space);return id;}
function gEvent(x){const meetLink=x.hangoutLink||x.conferenceData?.entryPoints?.find(e=>e.entryPointType==='video')?.uri||(String((x.location||'')+' '+(x.description||'')).match(/https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')]+/i)||[])[0]||'';
  return {id:x.id,title:x.summary||'Sin título',date:(x.start?.dateTime||x.start?.date||'').slice(0,10),time:x.start?.dateTime?.slice(11,16)||'',end:x.end?.dateTime?.slice(11,16)||'',location:x.location||'',notes:x.description||'',etag:x.etag||'',url:x.htmlLink||'',meet:/^https:\/\//.test(meetLink)?meetLink:''};}
async function personalToken(row){const t=await decryptToken(env,row.encrypted_token);if(row.expires_at>Date.now()+60000)return t.access_token;if(!t.refresh_token)throw Error('Hay que volver a conectar los calendarios');
 const r=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:t.refresh_token});run('UPDATE google_personal SET encrypted_token=?,expires_at=? WHERE user_id=?',await encryptToken(env,{access_token:r.access_token,refresh_token:r.refresh_token||t.refresh_token,scope:r.scope||t.scope}),Date.now()+Number(r.expires_in||3600)*1000,row.user_id);return r.access_token;}
async function mergedPersonal(from,to,refresh=false){const key=from+'|'+to,cached=get("SELECT json,fetched_at FROM place_cache WHERE kind='pcal' AND query=?",key);if(cached&&!refresh&&Date.now()-cached.fetched_at<120000)return JSON.parse(cached.json);
 const items=[],errors=[];
 for(const row of all('SELECT g.*,us.name FROM google_personal g JOIN users us ON us.id=g.user_id')){try{const token=await personalToken(row);
  for(const c of JSON.parse(row.calendars).filter(c=>c.include)){const r=await googleRequest(token,'GET','/calendars/'+encodeURIComponent(c.id)+'/events?singleEvents=true&orderBy=startTime&maxResults=250&timeMin='+encodeURIComponent(from+'T00:00:00Z')+'&timeMax='+encodeURIComponent(to+'T23:59:59Z'));
   for(const x of r.items||[]){if(x.status==='cancelled'||x.transparency==='transparent'&&!x.start?.dateTime&&/birthday|cumple/i.test(c.name))continue;const ev=gEvent(x);if(!ev.date)continue;items.push({...ev,id:'p_'+row.user_id.slice(0,8)+'_'+String(x.id).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,120),gid:x.id,cal_id:c.id,owner_id:row.user_id,owner_name:row.name,calendar:c.name});}}}
  catch(ex){errors.push({owner_name:row.name,error:String(ex.message||ex).slice(0,140)});}}
 const out={items:items.sort((a,b)=>(a.date+(a.time||'00')).localeCompare(b.date+(b.time||'00'))).slice(0,1500),errors,refreshed_at:now()};
 run("INSERT INTO place_cache(kind,query,json,fetched_at) VALUES('pcal',?,?,?) ON CONFLICT(kind,query) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at",key,JSON.stringify(out),Date.now());return out;}
// Choques: dos cosas con hora el mismo día que se solapan (sin hora de fin se cuenta 1 h).
function findClashes(list){const mins=t=>{const [h,m]=String(t).split(':').map(Number);return h*60+m;},timed=list.filter(x=>x.time).map(x=>({...x,s:mins(x.time),e:x.end&&mins(x.end)>mins(x.time)?mins(x.end):mins(x.time)+60})),out=[];
 for(let i=0;i<timed.length;i++)for(let j=i+1;j<timed.length;j++){const a=timed[i],b=timed[j];if(a.date===b.date&&a.s<b.e&&b.s<a.e)out.push([a,b]);}return out;}
async function buildDailyBrief(today){const tomorrow=new Date(Date.parse(today+'T12:00:00Z')+864e5).toISOString().slice(0,10),in14=new Date(Date.parse(today+'T12:00:00Z')+14*864e5).toISOString().slice(0,10);
 const events=all("SELECT e.title,e.event_time,p.title AS project FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL AND p.archived=0 AND e.event_date=? ORDER BY e.event_time",today);
 const due=all("SELECT t.title,t.due_date,p.title AS project FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND p.archived=0 AND t.state!='done' AND t.due_date IS NOT NULL AND t.due_date<=? ORDER BY t.due_date LIMIT 12",today);
 const trip=get("SELECT id,title,destination,start_date FROM projects WHERE deleted_at IS NULL AND archived=0 AND start_date BETWEEN ? AND ? AND (kind IN ('trip','weekend') OR destination!='') ORDER BY start_date LIMIT 1",today,in14);
 const pend=trip?all("SELECT title FROM trip_stops WHERE project_id=? AND booking_state='pending' AND state!='cancelled'",trip.id):[];
 let gcal=[];try{const g=await sharedOwnerToken();if(g){const r=await googleRequest(g.token,'GET','/calendars/'+encodeURIComponent(g.rec.calendar_id)+'/events?singleEvents=true&orderBy=startTime&timeMin='+encodeURIComponent(today+'T00:00:00+02:00')+'&timeMax='+encodeURIComponent(tomorrow+'T00:00:00+01:00'));gcal=(r.items||[]).filter(x=>x.status!=='cancelled'&&!String(x.id).startsWith('duplaresumen')).map(x=>({title:x.summary||'Evento',time:x.start?.dateTime?.slice(11,16)||'',end:x.end?.dateTime?.slice(11,16)||''}));}}catch(ex){console.error('Resumen: Google',String(ex.message||ex).slice(0,120));}
 let personal=[];try{personal=(await mergedPersonal(today,today)).items.filter(x=>x.date===today);}catch{}
 const lines=[],ev=[...gcal.map(x=>(x.time?x.time+' ':'')+x.title),...events.map(x=>(x.event_time?x.event_time+' ':'')+x.title+' ('+x.project+')'),...personal.map(x=>(x.time?x.time+' ':'')+x.title+' ('+x.owner_name.split(' ')[0]+')')];
 if(ev.length)lines.push('Hoy: '+ev.join(' · '));
 const late=due.filter(x=>x.due_date<today),now_=due.filter(x=>x.due_date===today);
 if(now_.length)lines.push('Vence hoy: '+now_.map(x=>x.title).join(' · '));if(late.length)lines.push(`Atrasadas (${late.length}): `+late.slice(0,4).map(x=>x.title).join(' · '));
 const clashes=findClashes([...gcal.map(x=>({...x,date:today})),...events.map(x=>({title:x.title,time:x.event_time,date:today})),...personal]);
 if(clashes.length)lines.push('⚠ Choques: '+clashes.slice(0,3).map(([a,b])=>`${a.title} (${a.time}) y ${b.title} (${b.time})`).join(' · '));
 if(trip){const d=Math.round((Date.parse(trip.start_date)-Date.parse(today))/864e5);lines.push(`${trip.destination||trip.title}: ${d===0?'¡salís hoy!':'faltan '+d+' días'}${pend.length?` · ${pend.length} ${pend.length===1?'reserva pendiente':'reservas pendientes'}`:''}`);}
 return {short:lines.length?lines.join(' — '):'Hoy no tenéis nada pendiente. ¡Buen día!',full:lines.length?lines.join('\n'):'Hoy no tenéis nada pendiente. ¡Buen día!'};}
async function processDailyBrief(force=false){const m=madridNow();if(!force&&(m.hour<8||getShared('daily_brief_date')===m.date))return {sent:0};setShared('daily_brief_date',m.date);
 const brief=await buildDailyBrief(m.date),users=all('SELECT id FROM users');let sent=0;
 for(const x of users)if(userPref(x.id,'daily_summary',true)){noticeTo(x.id,'Resumen del día',brief.short);sent++;}
 let calendar=false;if(users.some(x=>userPref(x.id,'daily_calendar',true)))try{const g=await sharedOwnerToken();if(g){const id='duplaresumen'+m.date.replace(/-/g,'');
  try{await googleRequest(g.token,'POST','/calendars/'+encodeURIComponent(g.rec.calendar_id)+'/events',{id,summary:'☀️ Resumen del día · DUPLA',description:brief.full+'\n\nAbrir DUPLA: '+(env.PUBLIC_ORIGIN||''),start:{dateTime:m.date+'T08:30:00',timeZone:'Europe/Madrid'},end:{dateTime:m.date+'T08:45:00',timeZone:'Europe/Madrid'},reminders:{useDefault:false,overrides:[{method:'popup',minutes:0}]},transparency:'transparent'});calendar=true;}
  catch(ex){if(ex.statusCode!==409)throw ex;}}}catch(ex){console.error('Resumen: evento de calendario',String(ex.message||ex).slice(0,120));}
 if(sent){notify('all',null,null);kickPush();}return {sent,calendar,brief:brief.short};}
async function processAgentAlerts(){const m=madridNow();if(m.hour<9||m.hour>21)return {sent:0};run('CREATE TABLE IF NOT EXISTS agent_alerts(id TEXT PRIMARY KEY,sent_at TEXT NOT NULL)');
 const users=all('SELECT id FROM users');let sent=0;
 // Antes de cada viaje (a 90, 45, 21 y 7 días): lo que encarece esas fechas en ese destino y un consejo.
 for(const t of all("SELECT id,title,destination,start_date,end_date,space FROM projects WHERE deleted_at IS NULL AND COALESCE(archived,0)=0 AND destination!='' AND start_date>? AND start_date<=?",m.date,new Date(Date.parse(m.date+'T12:00:00Z')+90*864e5).toISOString().slice(0,10))){if(sent>=3)break;
  const days=Math.round((Date.parse(t.start_date)-Date.parse(m.date))/864e5),phase=[7,21,45,90].find(p=>days<=p);if(!phase)continue;
  if(get('SELECT 1 AS ok FROM agent_alerts WHERE id=?','trip:'+t.id+':'+phase))continue;
  let fc;try{fc=await v6.budgetForecast(t.destination,t.start_date,t.end_date||t.start_date,2);}catch{continue;}
  const top=fc.alerts.find(a=>a.level==='high')||fc.alerts.find(a=>a.level==='mid'),ev=fc.insights?.events?.[0],tip=fc.insights?.tips?.[0];
  if(!top&&!ev)continue;run('INSERT OR IGNORE INTO agent_alerts(id,sent_at) VALUES(?,?)','trip:'+t.id+':'+phase,now());
  const text=`${t.destination}: faltan ${days} días. ${ev?ev.name+' ('+ev.when+'): '+ev.impact+'. ':''}${top&&!ev?top.text+' ':''}${tip?'Consejo: '+tip:''}`;
  for(const u2 of users)if(userPref(u2.id,'agent_alerts',true))noticeTo(u2.id,'Aviso de Dupla',text,t.id,t.space);sent++;}
 for(const space of ['couple','work'])for(const x of v6.directorSuggestions(space).filter(s=>s.severity==='high'&&['proposal','review','approved'].includes(s.status))){if(sent>=3)break;
  if(!run('INSERT OR IGNORE INTO agent_alerts(id,sent_at) VALUES(?,?)',x.id+':'+m.date.slice(0,7),now()).changes)continue;
  for(const u2 of users)if(userPref(u2.id,'agent_alerts',true))noticeTo(u2.id,'Aviso de Dupla',x.title+'. '+x.detail,x.project_id,space);sent++;}
 if(sent){notify('all',null,null);kickPush();}return {sent};}
function logIntegration(kind,status,event,detail=''){
 run('INSERT INTO integration_runs(id,kind,status,event,detail,created_at) VALUES(?,?,?,?,?,?)',uid(),kind,status,event,String(detail).slice(0,180),now());
 run('DELETE FROM integration_runs WHERE id IN (SELECT id FROM integration_runs ORDER BY created_at DESC LIMIT -1 OFFSET 500)');
}
function notifyPartner(actorId,projectId,space,action,detailText=''){
 // Only recipients who opted in receive email or push. There are no external
 // calls here: durable queues are flushed separately by the scheduled alarm.
 for(const user of all('SELECT id FROM users WHERE id!=?',actorId)){
  const id=uid();
  run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',id,user.id,projectId,space,actorId,action,String(detailText).slice(0,220),now(),null);
  queueExternalNotice(id,user.id,space);
 }
 kickPush();
}
function logChange(p,user,action,detailText){activity(p.id,p.space,user.id,action,detailText);notifyPartner(user.id,p.id,p.space,action,detailText);notify(p.space,p.id,user.id); if(p.space==='work')sendWebhook({projectId:p.id,action,actor:user.name,at:now()});}
function logIdea(idea,user,action){activity(null,idea.space,user.id,action,idea.title);notifyPartner(user.id,idea.project_id||null,idea.space,action,idea.title);notify(idea.space,idea.project_id||null,user.id);}

// Durable webhook outbox: an HTTP timeout must not silently drop a work event.
// The receiver may see at-least-once delivery; idempotency key is stable per event.
function sendWebhook(payload){
 if(!env.WORK_WEBHOOK_URL)return;
 try{validateWebhookUrl(env.WORK_WEBHOOK_URL);}catch(ex){logIntegration('webhook','error',payload.action,'URL no segura');return;}
 const id=uid();
 run('INSERT INTO webhook_outbox(id,payload,status,attempts,next_attempt_at,last_error,created_at,sent_at) VALUES(?,?,?,0,0,?,?,NULL)',id,JSON.stringify({source:'dupla',version:1,space:'work',event:payload}), 'pending','',now());
 run('INSERT INTO integration_runs(id,kind,status,event,detail,created_at) VALUES(?,?,?,?,?,?)',id,'webhook','pending',payload.action,'En cola de entrega',now());
 // Keep the most recent completed records but never silently discard unsent events.
 run("DELETE FROM webhook_outbox WHERE id IN (SELECT id FROM webhook_outbox WHERE status IN ('sent','failed') ORDER BY created_at DESC LIMIT -1 OFFSET 500)");
 if(typeof ctx.waitUntil==='function')ctx.waitUntil(flushWebhookQueue().catch(e=>console.error('Webhook outbox',String(e.message).slice(0,120))));
}
async function flushWebhookQueue(){
 if(!env.WORK_WEBHOOK_URL)return {enabled:false,sent:0,pending:0};
 let safe;try{safe=validateWebhookUrl(env.WORK_WEBHOOK_URL);}catch{return {enabled:false,sent:0,pending:0,error:'URL no segura'};}
 const due=all("SELECT * FROM webhook_outbox WHERE (status='pending' OR (status='sending' AND next_attempt_at<=?)) AND next_attempt_at<=? ORDER BY created_at ASC LIMIT 15",Date.now(),Date.now());
 let sent=0,failed=0;
 for(const item of due){
  // Reserve an attempt before network I/O. An abandoned lease becomes eligible again.
  const leased=run("UPDATE webhook_outbox SET status='sending',attempts=attempts+1,next_attempt_at=? WHERE id=? AND (status='pending' OR (status='sending' AND next_attempt_at<=?))",Date.now()+120000,item.id,Date.now());
  if(!leased.changes)continue;
  let error='',statusCode=0;
  try{
   const response=await fetch(safe,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':item.id},body:item.payload,redirect:'error',signal:AbortSignal.timeout(8000)});
   statusCode=response.status;if(!response.ok)error='HTTP '+response.status;
  }catch(ex){error=String(ex.message||ex).slice(0,120);}
  if(!error){run("UPDATE webhook_outbox SET status='sent',sent_at=?,last_error='',next_attempt_at=0 WHERE id=?",now(),item.id);run('UPDATE integration_runs SET status=?,detail=? WHERE id=?','success','HTTP '+statusCode,item.id);sent++;}
  else{
   const attempts=item.attempts+1;
   const permanent=(statusCode>=400&&statusCode<500&&statusCode!==408&&statusCode!==429)||attempts>=6;
   run('UPDATE webhook_outbox SET status=?,last_error=?,next_attempt_at=? WHERE id=?',permanent?'failed':'pending',error,permanent?0:Date.now()+Math.min(86400000,30000*2**attempts),item.id);
   run('UPDATE integration_runs SET status=?,detail=? WHERE id=?',permanent?'error':'pending',permanent?error:'Reintento programado: '+error,item.id);failed++;
  }
 }
 return {enabled:true,sent,failed,pending:get("SELECT COUNT(*) AS n FROM webhook_outbox WHERE status IN ('pending','sending')").n};
}

async function readBody(req){if(!['POST','PATCH','PUT'].includes(req.method))return {};if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Se necesita application/json');let chunks=[],bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>9*1024*1024)fail(413,'El archivo o contenido supera el límite de 8 MB');chunks.push(chunk);}try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Se necesita un objeto JSON');return value;}catch(e){if(e?.status)throw e;fail(400,'JSON inválido');}}
function requireRevision(b,row){if(!Number.isInteger(b.revision)||b.revision!==row.revision)fail(409,'Este elemento ha cambiado en la otra cuenta. Copia tu texto, recarga y vuelve a intentarlo.');}
function idMatch(path,regex){const m=path.match(regex);return m||null;}
function cookie(token,maxAge){return `dos_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${SECURE?'; Secure':''}`;}
function csrf(req){
 if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return;
 const origin=req.headers.origin;
 // Public TLS terminates at a reverse proxy. Do not trust X-Forwarded-Host headers
 // supplied by an arbitrary client; allow only an explicitly configured HTTPS origin.
 if(origin){
  let parsed;try{parsed=new URL(origin);}catch{fail(403,'Origen no permitido');}
  const isDirect=parsed.host===req.headers.host && (parsed.protocol==='https:' || (env.DEV_MODE==='true' && parsed.protocol==='http:'));
  const isPublic=Boolean(PUBLIC_ORIGIN)&&origin===PUBLIC_ORIGIN;
  if(!isDirect&&!isPublic)fail(403,'Origen no permitido');
 }
 if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Solicitud no permitida');
}
function executeRule(rule,actor,runDate){
 const stamp=now(),id=uid(),p=project(rule.project_id);if(p.space!=='work')throw Error('La automatización solo puede operar en Trabajo');
 if(get('SELECT id FROM automation_executions WHERE rule_id=? AND run_date=?',rule.id,runDate))return {created:false,reason:'Ya ejecutada'};
 db.transactionSync(()=>{
  run('INSERT INTO automation_executions(id,rule_id,run_date,run_at,status,detail) VALUES(?,?,?,?,?,?)',id,rule.id,runDate,stamp,'success','Acción registrada');
  if(rule.action_type==='task')run('INSERT INTO tasks(id,project_id,title,description,state,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),p.id,rule.payload,'Generada por automatización '+rule.title,'todo','normal',actor,stamp,stamp);
  else for(const user of all('SELECT id FROM users'))run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',uid(),user.id,p.id,'work',actor||null,'automatización',rule.payload,stamp,null);
  run('UPDATE automation_rules SET last_run_date=? WHERE id=?',stamp.slice(0,10),rule.id);
 });
 logChange(p,{id:actor||rule.created_by,name:'Automatización'},'ejecutó automatización',rule.title);
 return {created:true,id};
}
function processAutomationRules(){
 const utc=new Date(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(utc);
 const weekday=new Date(today+'T12:00:00Z').getUTCDay();let executed=0,failed=0;
 for(const rule of all("SELECT ar.* FROM automation_rules ar JOIN projects p ON p.id=ar.project_id WHERE ar.active=1 AND ar.trigger_type!='manual' AND p.space='work' AND p.deleted_at IS NULL AND p.archived=0 LIMIT 60")){
  if(rule.trigger_type==='weekly'&&rule.week_day!==weekday)continue;
  if(rule.last_run_date===today)continue;
  try{if(executeRule(rule,rule.created_by,today).created)executed++;}catch(error){failed++;console.error('Automation rule',rule.id,String(error.message).slice(0,120));}
 }
 return {executed,failed};
}
// Optional independent off-site backup. R2 is disabled unless the user binds a private bucket.
async function processScheduledBackup(){
 if(!env.BACKUP_BUCKET)return {enabled:false};
 if(typeof storage.get!=='function'||typeof storage.put!=='function')throw Error('Almacenamiento de control no disponible');
 const date=now().slice(0,10),previous=await storage.get('dupla-backup-success');
 if(previous?.date===date && (typeof env.BACKUP_BUCKET.head!=='function'||await env.BACKUP_BUCKET.head(previous.key||'dupla-backups/'+date+'.json')))return {enabled:true,created:false};
 const tables=['projects','tasks','sections','events','comments','links','assets','milestones','expenses','checklist_items','activities','ideas','section_versions','decisions','decision_votes','knowledge','audit_events','notifications','reminder_sent','integration_runs','work_deliverables','time_entries','trip_stops','automation_rules','automation_executions','brief_imports'];
 const data=Object.fromEntries(tables.map(t=>[t,all(`SELECT * FROM ${t}`)]));
 for(const t of V6_TABLES)data[t]=all(`SELECT * FROM ${t}`);
 // Small historical copies stay byte-compatible with v1. For larger collections, R2 stores
 // attachments as private binary objects and the dated JSON becomes the commit manifest.
 // Never publish the manifest until ALL objects are written successfully.
 const bytes=data.assets.reduce((sum,a)=>sum+Number(a.size),0);
 if(!Number.isSafeInteger(bytes)||bytes>36*1024*1024)throw Error('Copia superior al máximo de recuperación R2 (36 MiB); utiliza exportación por lotes');
 const large=bytes>18*1024*1024;
 const files=[];
 for(const asset of data.assets){
  const raw=readFile(asset.stored_name);
  if(raw.length!==asset.size||raw.length>6*1024*1024)throw Error('Adjunto inconsistente en copia R2: '+asset.stored_name);
  if(large){
   const fileKey='dupla-backups/'+date+'/files/'+asset.stored_name;
   const digest=sha(raw);
   await env.BACKUP_BUCKET.put(fileKey,raw,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:digest}});
   files.push({stored_name:asset.stored_name,key:fileKey,size:raw.length,sha256:digest});
  }else files.push({stored_name:asset.stored_name,base64:raw.toString('base64')});
 }
 const format=large?'dos-espacios-edge-v2':'dos-espacios-edge-v1';
 const snapshot=JSON.stringify({format,exported_at:now(),users:all('SELECT id,name,email,created_at FROM users'),data,files});
 if(Buffer.byteLength(snapshot)>18*1024*1024)throw Error('Metadatos demasiado extensos para copia R2; divide la exportación');
 const key='dupla-backups/'+date+'.json';
 const checksum=sha(snapshot);
 await env.BACKUP_BUCKET.put(key,snapshot,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:checksum,format}});
 await storage.put('dupla-backup-success',{date,key,at:now(),sha256:checksum});
 return {enabled:true,created:true,key,format,files:files.length};
}

// External v2 blobs are never used without checksums, exact private R2 keys, matching
// metadata and two original account IDs. Fail closed BEFORE beginning SQL restore.
async function readR2Backup(date,{withFiles=false}={}){
 const obj=await env.BACKUP_BUCKET.get('dupla-backups/'+date+'.json');
 if(!obj)fail(404,'No existe esa copia externa');
 if(Number(obj.size)>32*1024*1024)fail(413,'El manifiesto supera el límite de lectura');
 const payload=await obj.text();
 const digest=obj.customMetadata?.sha256;
 if(!digest||digest!==sha(payload))fail(409,'La copia externa no supera SHA-256');
 let snapshot;try{snapshot=JSON.parse(payload);}catch{fail(409,'El manifiesto R2 no es JSON válido');}
 if(snapshot.format==='dos-espacios-edge-v1')return snapshot;
 if(snapshot.format!=='dos-espacios-edge-v2'||!Array.isArray(snapshot.files)||!Array.isArray(snapshot.data?.assets))fail(409,'Formato R2 inválido');
 const assets=new Map(snapshot.data.assets.map(a=>[a.stored_name,a.size]));
 if(assets.size!==snapshot.files.length)fail(409,'Número de adjuntos R2 incorrecto');
 let total=0;const result=[];const visited=new Set();
 for(const file of snapshot.files){
  const key='dupla-backups/'+date+'/files/'+file.stored_name;
  if(!/^[a-f0-9-]{36}$/.test(String(file.stored_name))||file.key!==key||visited.has(file.stored_name)||
    !/^[a-f0-9]{64}$/.test(String(file.sha256))||!Number.isInteger(file.size)||file.size<1||file.size>6*1024*1024||assets.get(file.stored_name)!==file.size)fail(409,'Metadatos de adjunto R2 inválidos');
  visited.add(file.stored_name);total+=file.size;
  if(total>36*1024*1024)fail(413,'Copia externa supera 36 MiB de adjuntos');
  const obj=await env.BACKUP_BUCKET.get(key);
  if(!obj||Number(obj.size)!==file.size)fail(409,'Adjunto R2 ausente o truncado');
  const raw=Buffer.from(await obj.arrayBuffer());
  if(raw.length!==file.size||sha(raw)!==file.sha256||obj.customMetadata?.sha256!==file.sha256)fail(409,'Adjunto R2 alterado');
  if(withFiles)result.push({stored_name:file.stored_name,base64:raw.toString('base64')});
 }
 return withFiles?{...snapshot,format:'dos-espacios-edge-v1',files:result}:snapshot;
}
async function api(req,res,url){
 const path=url.pathname;csrf(req);
 // Primera configuración privada: crea exactamente dos cuentas, una sola vez.
 if(path==='/api/initialize'&&req.method==='POST'){
  if(get('SELECT COUNT(*) AS n FROM users').n>0)fail(409,'Las cuentas ya están creadas.');
  if(!SETUP_TOKEN)fail(404,'Alta web deshabilitada: configura SETUP_TOKEN o usa npm run setup.');
  const key=req.socket.remoteAddress||'unknown';
  const attempts=setupAttempts.get(key)||{n:0,since:Date.now()};
  if(Date.now()-attempts.since>15*60*1000){attempts.n=0;attempts.since=Date.now();}
  if(attempts.n>=8)fail(429,'Demasiados intentos de configuración. Reintenta más tarde.');
  const b=await readBody(req);
  const valid=timingSafeEqual(Buffer.from(sha(String(b.setup_token||'')),'hex'),Buffer.from(sha(SETUP_TOKEN),'hex'));
  if(!valid){attempts.n++;setupAttempts.set(key,attempts);fail(403,'Clave de instalación incorrecta.');}
  const emailA=String(b.email_a||'').trim().toLowerCase(),emailB=String(b.email_b||'').trim().toLowerCase();
  const passwordA=String(b.password_a||''),passwordB=String(b.password_b||'');
  if(!/^\S+@\S+\.\S+$/.test(emailA)||!/^\S+@\S+\.\S+$/.test(emailB)||emailA===emailB)fail(400,'Introduce dos correos diferentes y válidos.');
  if(passwordA.length<12||passwordB.length<12||passwordA===passwordB||passwordA.length>200||passwordB.length>200)fail(400,'Las contraseñas deben ser diferentes y tener entre 12 y 200 caracteres.');
  const hashedA=await hashPassword(passwordA),hashedB=await hashPassword(passwordB);
  db.transactionSync(()=>{
   if(get('SELECT COUNT(*) AS n FROM users').n>0)fail(409,'Las cuentas ya están creadas.');
   run('INSERT INTO users VALUES(?,?,?,?,?)',uid(),'Álvaro',emailA,hashedA,now());
   run('INSERT INTO users VALUES(?,?,?,?,?)',uid(),'Angie',emailB,hashedB,now());
   
  });
  setupAttempts.clear();respond(res,201,{ok:true,message:'Las dos cuentas se han creado. Ya podéis iniciar sesión.'});return;
 }
 // OAuth callback is state-bound and one-use; no cookie is required on the third-party redirect.
 if(path==='/api/google/callback'&&req.method==='GET'){
  const state=String(url.searchParams.get('state')||'');
  if(!/^[a-zA-Z0-9_-]{40,80}$/.test(state))fail(400,'Estado OAuth inválido');
  const pending=get('SELECT * FROM google_oauth_states WHERE state=?',state);
  if(!pending||pending.expires_at<Date.now())fail(400,'Autorización caducada o ya utilizada');
  run('DELETE FROM google_oauth_states WHERE state=?',state);
  if(url.searchParams.has('error'))fail(400,'Google Calendar no concedió autorización');
  if(!googleConfigured(env))fail(503,'Google Calendar no está configurado');
  const code=String(url.searchParams.get('code')||'');if(!code||code.length>2048)fail(400,'Falta código OAuth');
  let result;try{result=await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/api/google/callback',code_verifier:pending.verifier});}
  catch(e){fail(502,'No se pudo completar la autorización con Google: '+e.message);}
  const sealed=await encryptToken(env,{access_token:result.access_token,refresh_token:result.refresh_token||'',scope:result.scope||''});
  if(pending.kind==='personal'){let list=[];try{list=(await googleRequest(result.access_token,'GET','/users/me/calendarList?minAccessRole=reader&maxResults=100')).items||[];}catch(e){fail(502,'Google no devolvió vuestros calendarios: '+e.message);}
   const email=String(list.find(x=>x.primary)?.id||'').slice(0,200),cals=list.filter(x=>x.id!==SHARED_CALENDAR_ID).slice(0,40).map(x=>({id:String(x.id).slice(0,250),name:String(x.summaryOverride||x.summary||x.id).slice(0,120),primary:!!x.primary,include:!/holiday|festivos|contacts|birthday|cumplea/i.test(x.id+' '+(x.summary||''))}));
   run('INSERT INTO google_personal(user_id,encrypted_token,expires_at,email,calendars,connected_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,email=excluded.email,calendars=excluded.calendars,connected_at=excluded.connected_at',pending.user_id,sealed,Date.now()+Number(result.expires_in||3600)*1000,email,JSON.stringify(cals),now());
   notify('couple',null,pending.user_id);res.writeHead(302,{'Location':'/?google=personal','Cache-Control':'no-store'});res.end('');return;}
  run('INSERT INTO google_connections(user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,connected_at=excluded.connected_at',pending.user_id,sealed,Date.now()+Number(result.expires_in||3600)*1000,now());
  res.writeHead(302,{'Location':'/?google=connected','Cache-Control':'no-store'});res.end('');return;
 }
 // OAuth callback for Figma/Canva. State is one-time, account bound, 10-min TTL.
 const designCb=path.match(/^\/api\/design\/(figma|canva)\/callback$/);
 if(designCb&&req.method==='GET'){
  const provider=designCb[1],state=String(url.searchParams.get('state')||'');
  if(!/^[a-zA-Z0-9_-]{40,100}$/.test(state))fail(400,'Estado OAuth inválido');
  const pending=get('SELECT * FROM design_oauth_states WHERE state=? AND provider=?',state,provider);
  if(!pending||pending.expires_at<Date.now())fail(400,'Autorización de diseño caducada o ya utilizada');
  run('DELETE FROM design_oauth_states WHERE state=?',state);
  if(url.searchParams.has('error'))fail(400,'El proveedor no concedió autorización');
  if(!designConfigured(provider,env))fail(503,'Integración no configurada en Cloudflare');
  const code=String(url.searchParams.get('code')||'');if(!code||code.length>2048)fail(400,'Falta el código OAuth');
  let tokens;try{tokens=await designTokenRequest(provider,env,{grant_type:'authorization_code',code,redirect_uri:env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/api/design/'+provider+'/callback',code_verifier:pending.verifier});}
  catch(ex){fail(502,'No se pudo conectar la cuenta de diseño: '+ex.message);}
  const sealed=await encryptToken(env,{access_token:tokens.access_token,refresh_token:tokens.refresh_token||'',scope:tokens.scope||''});
  run('INSERT INTO design_connections(provider,user_id,encrypted_token,expires_at,connected_at) VALUES(?,?,?,?,?) ON CONFLICT(provider,user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token,expires_at=excluded.expires_at,connected_at=excluded.connected_at',provider,pending.user_id,sealed,Date.now()+Number(tokens.expires_in||3600)*1000,now());
  res.writeHead(302,{'Location':'/?design='+provider+'&connected=1','Cache-Control':'no-store'});res.end('');return;
 }
 if(path==='/api/login'&&req.method==='POST'){
  const b=await readBody(req);const email=String(b.email||'').toLowerCase().trim();const key=(req.socket.remoteAddress||'')+':'+email;
  const a=loginAttempts.get(key)||{n:0,since:Date.now()};if(Date.now()-a.since>15*60*1000){a.n=0;a.since=Date.now();}
  if(a.n>=10)fail(429,'Demasiados intentos. Prueba en 15 minutos.');
  const u=get('SELECT * FROM users WHERE email=?',email);
  if(!u||!await verifyPassword(String(b.password||''),u.password_hash)){a.n++;loginAttempts.set(key,a);fail(401,'Correo o contraseña incorrectos');}
  loginAttempts.delete(key);const token=randomBytes(32).toString('hex');run('INSERT INTO sessions(token_hash,user_id,expires_at,device,created_at) VALUES(?,?,?,?,?)',sha(token),u.id,new Date(Date.now()+30*864e5).toISOString(),deviceName(req.headers['user-agent']),now());
  respond(res,200,{user:{id:u.id,name:u.name,email:u.email}},{'Set-Cookie':cookie(token,30*86400)});return;
 }
 if(path==='/api/me'&&req.method==='GET'){const u=userFromReq(req);respond(res,200,{user:u?{id:u.id,name:u.name,email:u.email}:null,configured:get('SELECT COUNT(*) AS n FROM users').n===2,setupAvailable:Boolean(SETUP_TOKEN)&&get('SELECT COUNT(*) AS n FROM users').n===0});return;}
 const u=auth(req);
 if(await v6.route(req,res,url,u))return;
 // Design providers are authorized separately for every DUPLA account.
 const dRoute=path.match(/^\/api\/design\/(figma|canva)\/(status|start|disconnect|list|import)$/);
 async function designAccess(provider){
  const row=get('SELECT * FROM design_connections WHERE provider=? AND user_id=?',provider,u.id);
  if(!row)fail(409,'Autoriza '+provider+' antes de importar diseños');
  let tokens;try{tokens=await decryptToken(env,row.encrypted_token);}catch{fail(503,'No se pudo descifrar la conexión de '+provider);}
  if(row.expires_at>Date.now()+60000)return tokens.access_token;
  if(!tokens.refresh_token)fail(409,'Vuelve a autorizar '+provider+' para actualizar el acceso');
  let fresh;try{fresh=await designTokenRequest(provider,env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});}
  catch(ex){fail(502,'Error renovando '+provider+': '+ex.message);}
  const sealed=await encryptToken(env,{access_token:fresh.access_token,refresh_token:fresh.refresh_token||tokens.refresh_token,scope:fresh.scope||tokens.scope});
  run('UPDATE design_connections SET encrypted_token=?,expires_at=? WHERE provider=? AND user_id=?',sealed,Date.now()+Number(fresh.expires_in||3600)*1000,provider,u.id);
  return fresh.access_token;
 }
 // Non-mutating live test: prove that the user's authorized Figma token can read
 // an existing design instead of treating a stored OAuth token as proof of access.
 if(path==='/api/design/figma/check'&&req.method==='GET'){
  if(!designConfigured('figma',env))fail(503,'Figma no está configurado');
  let key;try{key=figmaKey(url.searchParams.get('url')||'');}catch(ex){fail(400,ex.message);}
  const access=await designAccess('figma');
  let remoteFile;try{remoteFile=await designRemote('figma',access,'/v1/files/'+key+'/meta');}
  catch(ex){logIntegration('figma','error','design.check','HTTP/API '+String(ex.message).slice(0,120));fail(502,'Figma no permitió consultar el archivo: '+ex.message);}
  if(!remoteFile?.file?.name)fail(502,'Figma no devolvió metadatos válidos');
  logIntegration('figma','success','design.check','Archivo verificado');
  respond(res,200,{ok:true,provider:'figma',title:String(remoteFile.file.name).slice(0,150)});return;
 }
 if(dRoute){
  const provider=dRoute[1],action=dRoute[2];
  if(action==='status'&&req.method==='GET'){
   respond(res,200,{provider,available:designConfigured(provider,env),connected:!!get('SELECT 1 AS ok FROM design_connections WHERE provider=? AND user_id=?',provider,u.id),mode:'Sólo consultar diseños autorizados e importar enlaces elegidos'});return;
  }
  if(action==='start'&&req.method==='POST'){
   if(!designConfigured(provider,env))fail(503,'Faltan las credenciales OAuth de '+provider+' en Cloudflare');
   const state=randomState(),verifier=randomState();
   run('DELETE FROM design_oauth_states WHERE expires_at<?',Date.now());
   run('INSERT INTO design_oauth_states VALUES(?,?,?,?,?)',state,provider,u.id,verifier,Date.now()+10*60*1000);
   respond(res,200,{url:designAuthUrl(provider,env,state,verifier)});return;
  }
  if(action==='disconnect'&&req.method==='POST'){
   run('DELETE FROM design_connections WHERE provider=? AND user_id=?',provider,u.id);respond(res,200,{ok:true});return;
  }
  if(action==='list'&&req.method==='GET'&&provider==='canva'){
   const access=await designAccess(provider);let r;try{r=await designRemote('canva',access,'/rest/v1/designs?limit=30');}catch(ex){fail(502,'No se pudieron consultar los diseños de Canva: '+ex.message);}
   const items=(r.items||[]).slice(0,30).map(x=>({id:String(x.id||''),title:String(x.title||'').slice(0,150),url:x.urls?.edit_url||x.urls?.view_url||''})).filter(x=>x.id);
   respond(res,200,{items});return;
  }
  if(action==='import'&&req.method==='POST'){
   const b=await readBody(req);const p=project(b.project_id);v6.requireConnection(provider,p);let externalId,title,link;
   if(provider==='figma'){
    let key;try{key=figmaKey(b.url);}catch(ex){fail(400,ex.message);}externalId=key;
    const access=await designAccess(provider);let doc;try{doc=await designRemote('figma',access,'/v1/files/'+key+'/meta');}catch(ex){fail(502,'No se pudo consultar el archivo de Figma: '+ex.message);}
    title=String(doc.file?.name||'Diseño Figma').slice(0,120);link='https://www.figma.com/design/'+key;
   } else {
    externalId=String(b.design_id||'');if(!/^[a-zA-Z0-9_-]{5,150}$/.test(externalId))fail(400,'Identificador de Canva no válido');
    const access=await designAccess(provider);let designs;try{designs=await designRemote('canva',access,'/rest/v1/designs?limit=30');}catch(ex){fail(502,'No se pudo consultar Canva: '+ex.message);}
    const selected=(designs.items||[]).find(x=>x.id===externalId);if(!selected)fail(404,'Diseño Canva no encontrado en la lista autorizada');
    title=String(selected.title||'Diseño Canva').slice(0,120);try{link=safeCanvaUrl(selected.urls?.edit_url||selected.urls?.view_url);}catch{fail(502,'Canva no devolvió un enlace oficial');}
   }
   const existing=get('SELECT l.id FROM design_imports di JOIN links l ON l.id=di.link_id WHERE di.provider=? AND di.user_id=? AND di.external_id=? AND di.project_id=?',provider,u.id,externalId,p.id);
   if(existing){respond(res,200,{created:false,link_id:existing.id});return;}
   const id=uid();db.transactionSync(()=>{
    run('INSERT INTO links VALUES(?,?,?,?,?,?)',id,p.id,title,link,u.id,now());
    run('INSERT INTO design_imports VALUES(?,?,?,?,?)',provider,u.id,externalId,p.id,id);
   });
   logChange(p,u,'importó enlace autorizado de '+provider,title);
   respond(res,201,{created:true,link_id:id,title,url:link});return;
  }
 }
 // Google Calendar is an optional per-user connector; nothing syncs until a user authorizes it.
 async function googleAccess(accountId=u.id){
  const connection=get('SELECT * FROM google_connections WHERE user_id=?',accountId);
  if(!connection)fail(409,'Conecta Google Calendar desde Conexiones antes de sincronizar');
  let tokens;try{tokens=await decryptToken(env,connection.encrypted_token);}catch{fail(503,'No se pudieron descifrar las credenciales de Google Calendar');}
  if(connection.expires_at>Date.now()+60000)return tokens.access_token;
  if(!tokens.refresh_token)fail(409,'Reconecta Google Calendar: falta el token de renovación');
  let refresh;try{refresh=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});}
  catch(ex){fail(502,'No se pudo renovar Google Calendar: '+ex.message);}
  const blob=await encryptToken(env,{access_token:refresh.access_token,refresh_token:refresh.refresh_token||tokens.refresh_token,scope:refresh.scope||tokens.scope});
  run('UPDATE google_connections SET encrypted_token=?,expires_at=? WHERE user_id=?',blob,Date.now()+Number(refresh.expires_in||3600)*1000,accountId);
  return refresh.access_token;
 }
 if(path==='/api/google/status'&&req.method==='GET'){
  const exists=Boolean(get('SELECT 1 AS ok FROM google_connections WHERE user_id=?',u.id));
  respond(res,200,{available:googleConfigured(env),connected:exists,scope:'calendar.events.owned + calendar.calendars + calendar.calendarlist.readonly + calendar.acls',mode:'Calendario de Google compartido para los dos; autorización individual y permisos explícitos'});return;
 }
 if(path==='/api/google/start'&&req.method==='POST'){
  if(!googleConfigured(env))fail(503,'Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, INTEGRATION_ENCRYPTION_KEY o PUBLIC_ORIGIN en Cloudflare');
  const state=randomState(),verifier=randomState();
  run('DELETE FROM google_oauth_states WHERE expires_at<?',Date.now());
  const sb=await readBody(req).catch(()=>({})),kind=sb?.kind==='personal'?'personal':'shared';
  run('INSERT INTO google_oauth_states(state,user_id,verifier,expires_at,kind) VALUES(?,?,?,?,?)',state,u.id,verifier,Date.now()+10*60*1000,kind);
  respond(res,200,{url:authorizationUrl(env,state,verifier,kind)});return;
 }
 if(path==='/api/google/disconnect'&&req.method==='POST'){
  if(get("SELECT 1 AS active FROM google_shared_calendar WHERE singleton='main' AND owner_user_id=?",u.id))fail(409,'Esta cuenta mantiene el calendario conjunto. Reconecta Google o configura otro propietario antes de desconectar.');
  run('DELETE FROM google_connections WHERE user_id=?',u.id);
  run('DELETE FROM google_event_map WHERE user_id=?',u.id);
  respond(res,200,{ok:true});return;
 }
 // Solo el calendario conjunto: nunca el calendario personal de nadie.
 const SHARED_CAL='/calendars/'+encodeURIComponent(SHARED_CALENDAR_ID);
 if(path==='/api/google/events'&&req.method==='GET'){
  const token=await googleAccess();let remote;
  try{remote=await googleRequest(token,'GET',SHARED_CAL+'/events?maxResults=30&singleEvents=true&orderBy=startTime&timeMin='+encodeURIComponent(new Date().toISOString()));}
  catch(e){fail(502,'Error al consultar Google Calendar: '+e.message);}
  respond(res,200,{items:(remote.items||[]).filter(x=>!x.status||x.status!=='cancelled').map(x=>({id:x.id,title:x.summary||'Sin título',start:x.start?.dateTime||x.start?.date||'',location:x.location||''})).slice(0,30)});return;
 }
 const googleSync=path.match(/^\/api\/google\/sync\/([a-f0-9-]{36})$/);
 if(googleSync&&req.method==='POST'){
  const item=get('SELECT * FROM events WHERE id=?',googleSync[1]);if(!item)fail(404,'Plan no encontrado');
  const p=project(item.project_id);v6.requireConnection('google_calendar',p);const token=await googleAccess();const body=toGoogleEvent(item);
  const saved=get('SELECT google_id FROM google_event_map WHERE user_id=? AND event_id=?',u.id,item.id);
  let result;try{
   if(saved){try{result=await googleRequest(token,'PUT',SHARED_CAL+'/events/'+encodeURIComponent(saved.google_id),body);}
    catch(ex){if(ex.statusCode!==404)throw ex;result=await googleRequest(token,'POST',SHARED_CAL+'/events',body);}}
   else result=await googleRequest(token,'POST',SHARED_CAL+'/events',body);
  }catch(ex){fail(502,'No se pudo guardar el evento en Google: '+ex.message);}
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(result.id||''))fail(502,'Google no devolvió un identificador válido');
  run('INSERT INTO google_event_map(user_id,event_id,google_id,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,event_id) DO UPDATE SET google_id=excluded.google_id,updated_at=excluded.updated_at',u.id,item.id,result.id,now());
  logIntegration('google','success','calendar.sync',p.space+': '+item.id);
  respond(res,200,{ok:true,google_id:result.id,updated:Boolean(saved)});return;
 }
 if(path==='/api/google/import'&&req.method==='POST'){
  const b=await readBody(req);const p=project(String(b.project_id||''));v6.requireConnection('google_calendar',p);
  const googleId=String(b.google_id||'');if(!/^[a-zA-Z0-9_-]{1,200}$/.test(googleId))fail(400,'Selecciona un evento de Google válido');
  const existing=get('SELECT m.event_id FROM google_event_map m JOIN events e ON e.id=m.event_id WHERE m.user_id=? AND m.google_id=? AND e.project_id=?',u.id,googleId,p.id);
  if(existing){respond(res,200,{ok:true,created:false,event_id:existing.event_id});return;}
  const token=await googleAccess();let remote;
  try{remote=await googleRequest(token,'GET',SHARED_CAL+'/events/'+encodeURIComponent(googleId));}
  catch(e){fail(502,'No se pudo importar desde Google: '+e.message);}
  const date=(remote.start?.dateTime||remote.start?.date||'').slice(0,10),time=remote.start?.dateTime?remote.start.dateTime.slice(11,16):'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(422,'El evento no tiene una fecha compatible');
  const id=uid();run('INSERT INTO events(id,project_id,title,event_date,location,notes,created_by,created_at,event_time,booking_status,booking_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText((remote.summary||'Evento importado').slice(0,160),'Plan',160),date,optional((remote.location||'').slice(0,220),220),optional((remote.description||'').slice(0,5000),5000),u.id,now(),validTime(time),'not_needed','');
  run('INSERT INTO google_event_map VALUES(?,?,?,?)',u.id,id,googleId,now());
  logChange(p,u,'importó un plan de Google Calendar',String(remote.summary||'Evento').slice(0,100));
  respond(res,201,{ok:true,created:true,event_id:id});return;
 }
 // Shared calendar is a single Google secondary calendar, never two copies of personal calendars.
 function sharedRecord(){return get("SELECT * FROM google_shared_calendar WHERE singleton='main'");}
 async function sharedAccess(){const record=sharedRecord();if(!record)fail(409,'Primero cread el calendario conjunto');return {record,token:await googleAccess(record.owner_user_id)};}
 const sharedStatusPath='/api/google/shared/status';
 if(path===sharedStatusPath&&req.method==='GET'){
  const record=sharedRecord();const ownerConnected=record?!!get('SELECT 1 AS ok FROM google_connections WHERE user_id=?',record.owner_user_id):false;
  respond(res,200,{available:googleConfigured(env),connected:!!get('SELECT 1 AS ok FROM google_connections WHERE user_id=?',u.id),created:!!record,owner_connected:ownerConnected,
   id:record?.calendar_id||null,title:record?.title||'DUPLA · Nuestro calendario',share_status:record?.share_status||null,
   members:record?[record.member_email_a,record.member_email_b]:[],owner_user_id:record?.owner_user_id||null,
   is_owner:record?.owner_user_id===u.id});return;
 }
 if(path==='/api/google/shared/attach'&&req.method==='POST'){
  // Solo el calendario conjunto que ya existe (R0702): ni otro, ni crear, ni cambiar a quién está compartido.
  if(sharedRecord())fail(409,'DUPLA ya tiene vinculado el calendario conjunto.');
  const b=await readBody(req),id=String(b.calendar_id||SHARED_CALENDAR_ID).trim();
  if(id!==SHARED_CALENDAR_ID)fail(400,'Solo se puede vincular vuestro calendario conjunto «DUPLA · Nuestro calendario».');
  const token=await googleAccess();let listEntry;
  try{listEntry=await googleRequest(token,'GET','/users/me/calendarList/'+encodeURIComponent(id));}
  catch(ex){fail(ex.statusCode===404?403:502,ex.statusCode===404?'La cuenta de Google conectada no tiene este calendario. Conecta la cuenta propietaria.':'No se pudo verificar el calendario en Google: '+ex.message);}
  if(listEntry?.accessRole!=='owner')fail(403,'Conecta en Google la cuenta propietaria del calendario para vincularlo');
  const title=String(listEntry?.summaryOverride||listEntry?.summary||'DUPLA · Nuestro calendario').slice(0,100);
  run('INSERT INTO google_shared_calendar(singleton,calendar_id,owner_user_id,title,member_email_a,member_email_b,share_status,created_at) VALUES(?,?,?,?,?,?,?,?)',
   'main',id,u.id,title,'','','shared',now());
  logIntegration('google','success','calendar.attach','Calendario verificado');notify('couple',null,u.id);
  respond(res,201,{ok:true,calendar_id:id,shared:true});return;
 }
 if(path==='/api/google/shared/finish'&&req.method==='POST'){respond(res,200,{ok:true});return;}
 // Calendarios personales de cada uno (solo lectura) fusionados en el calendario de DUPLA.
 if(path==='/api/google/personal'&&req.method==='GET'){const mine=get('SELECT email,calendars,connected_at FROM google_personal WHERE user_id=?',u.id);
  let canEdit=false;if(mine){try{canEdit=/calendar\.events(\s|$)/.test((await decryptToken(env,get('SELECT encrypted_token FROM google_personal WHERE user_id=?',u.id).encrypted_token)).scope||'');}catch{}}
  respond(res,200,{available:googleConfigured(env),connected:!!mine,can_edit:canEdit,email:mine?.email||'',calendars:mine?JSON.parse(mine.calendars):[],people:all('SELECT us.id,us.name,(g.user_id IS NOT NULL) AS connected,g.calendars FROM users us LEFT JOIN google_personal g ON g.user_id=us.id ORDER BY us.name').map((x,i)=>({id:x.id,name:x.name,connected:!!x.connected,color:userPref(x.id,'cal_color',i===0?'lavanda':'melocoton'),calendars:x.calendars?JSON.parse(x.calendars).filter(c=>c.include).length:0}))});return;}
 if(path==='/api/google/personal'&&req.method==='PUT'){const row=get('SELECT calendars FROM google_personal WHERE user_id=?',u.id);if(!row)fail(409,'Primero conecta tus calendarios de Google');const b=await readBody(req);const inc=Array.isArray(b.include)?b.include.map(String):[];
  const cals=JSON.parse(row.calendars).map(c=>({...c,include:inc.includes(c.id)}));run('UPDATE google_personal SET calendars=? WHERE user_id=?',JSON.stringify(cals),u.id);run("DELETE FROM place_cache WHERE kind='pcal'");notify('couple',null,u.id);respond(res,200,{calendars:cals});return;}
 if(path==='/api/google/personal'&&req.method==='DELETE'){run('DELETE FROM google_personal WHERE user_id=?',u.id);run("DELETE FROM place_cache WHERE kind='pcal'");notify('couple',null,u.id);respond(res,200,{ok:true});return;}
 // Editar los calendarios personales desde DUPLA (cada evento con el acceso de su dueño).
 if(path==='/api/google/personal/events'&&['POST','PUT','DELETE'].includes(req.method)){const b=await readBody(req),owner=req.method==='POST'?u.id:String(b.owner_id||'');
  const row=get('SELECT g.*,us.name FROM google_personal g JOIN users us ON us.id=g.user_id WHERE g.user_id=?',owner);if(!row)fail(409,'Esa persona no ha conectado sus calendarios');
  const cal=String(b.calendar_id||'');if(!JSON.parse(row.calendars).some(c=>c.id===cal))fail(400,'Calendario no válido');
  const token=await personalToken(row),base='/calendars/'+encodeURIComponent(cal)+'/events';const why=ex=>ex.statusCode===403||ex.statusCode===401?fail(403,`${row.name.split(' ')[0]} tiene que volver a conectar sus calendarios para poder editarlos desde DUPLA.`):ex.statusCode===412?fail(409,'Ese evento cambió en Google. Actualiza antes de guardar.'):fail(502,'Google no guardó el cambio: '+ex.message);
  if(req.method==='DELETE'){const id=String(b.event_id||'');if(!validSharedEventId(id))fail(400,'Evento no válido');try{await googleRequest(token,'DELETE',base+'/'+encodeURIComponent(id));}catch(ex){if(ex.statusCode!==404&&ex.statusCode!==410)why(ex);}run("DELETE FROM place_cache WHERE kind='pcal'");notify('couple',null,u.id);respond(res,200,{ok:true});return;}
  let body;try{body=normalizedSharedEvent(b);}catch(ex){fail(400,ex.message);}if(b.meet===true)body.conferenceData={createRequest:{requestId:'dupla-'+uid(),conferenceSolutionKey:{type:'hangoutsMeet'}}};const q=b.meet===true?'?conferenceDataVersion=1':'';
  let saved;try{if(req.method==='POST')saved=await googleRequest(token,'POST',base+q,body);else{const id=String(b.event_id||'');if(!validSharedEventId(id))fail(400,'Evento no válido');const cur=await googleRequest(token,'GET',base+'/'+encodeURIComponent(id));saved=await googleRequest(token,'PUT',base+'/'+encodeURIComponent(id)+q,{...cur,...body,conferenceData:body.conferenceData||cur.conferenceData},cur.etag?{'If-Match':cur.etag}:{});}}catch(ex){if(ex.status)throw ex;why(ex);}
  run("DELETE FROM place_cache WHERE kind='pcal'");notify('couple',null,u.id);respond(res,req.method==='POST'?201:200,{ok:true,id:saved?.id,meet:gEvent(saved||{}).meet});return;}
 if(path==='/api/calendar/merged'&&req.method==='GET'){const from=validDate(url.searchParams.get('from')),to=validDate(url.searchParams.get('to'));if(!from||!to||from>to)fail(400,'Rango no válido');respond(res,200,await mergedPersonal(from,to,url.searchParams.get('refresh')==='1'));return;}
 if(path==='/api/google/shared/events'&&req.method==='GET'){
  const {record,token}=await sharedAccess();
  const qf=validDate(url.searchParams.get('from')),qt=validDate(url.searchParams.get('to'));
  const timeMin=qf?new Date(qf+'T00:00:00Z').getTime()-86400_000:Date.now()-45*86400_000,timeMax=qt?new Date(qt+'T23:59:59Z').getTime()+86400_000:Date.now()+400*86400_000;
  const base='/calendars/'+encodeURIComponent(record.calendar_id)+'/events?maxResults=250&singleEvents=true&orderBy=startTime&timeMin='+encodeURIComponent(new Date(timeMin).toISOString())+'&timeMax='+encodeURIComponent(new Date(timeMax).toISOString());
  let remote={items:[]};try{let page='';for(let n=0;n<4;n++){const r=await googleRequest(token,'GET',base+(page?'&pageToken='+encodeURIComponent(page):''));remote.items.push(...(r.items||[]));page=r.nextPageToken;if(!page)break;}remote.nextPageToken=page||null;}
  catch(ex){fail(502,'No se pudo consultar el calendario conjunto: '+ex.message);}
  const events=(remote.items||[]).filter(x=>x.status!=='cancelled').map(gEvent);
  respond(res,200,{items:events,more:!!remote.nextPageToken,refreshed_at:now()});return;
 }
 if(path==='/api/google/shared/events'&&req.method==='POST'){
  const {record,token}=await sharedAccess();const b=await readBody(req);let body;
  try{body=normalizedSharedEvent(b);}catch(ex){fail(400,ex.message);}
  const requestId=String(b.request_id||'');
  if(requestId&&!/^[0-9a-f]{8}-[0-9a-f-]{27,45}$/.test(requestId))fail(400,'Identificador de solicitud inválido');
  if(requestId)body.id='d'+sha('dupla:calendar:'+requestId).slice(0,31);
  if(b.meet===true)body.conferenceData={createRequest:{requestId:'dupla-'+(requestId||uid()),conferenceSolutionKey:{type:'hangoutsMeet'}}};
  let saved;try{saved=await googleRequest(token,'POST','/calendars/'+encodeURIComponent(record.calendar_id)+'/events'+(b.meet===true?'?conferenceDataVersion=1':''),body);}
  catch(ex){if(ex.statusCode===409&&requestId){
    try{saved=await googleRequest(token,'GET','/calendars/'+encodeURIComponent(record.calendar_id)+'/events/'+body.id);}
    catch{fail(502,'No se pudo comprobar si Google guardó el evento: actualiza antes de repetir');}
   }else fail(502,'Google no guardó el evento: '+ex.message);}
  logIntegration('google','success','shared.event.create','Evento compartido');notifyPartner(u.id,null,'couple','añadió evento al calendario',body.summary);notify('couple',null,u.id);
  respond(res,201,{ok:true,id:saved.id,meet:gEvent(saved).meet});return;
 }
 const sharedEventRoute=path.match(/^\/api\/google\/shared\/events\/([A-Za-z0-9_-]+)$/);
 if(sharedEventRoute&&['PUT','DELETE'].includes(req.method)){
  const eventId=sharedEventRoute[1];if(!validSharedEventId(eventId))fail(400,'Evento no válido');
  const {record,token}=await sharedAccess();const googlePath='/calendars/'+encodeURIComponent(record.calendar_id)+'/events/'+encodeURIComponent(eventId);
  if(req.method==='DELETE'){
   try{await googleRequest(token,'DELETE',googlePath);}catch(ex){if(ex.statusCode!==404)fail(502,'No se pudo borrar: '+ex.message);}
   logIntegration('google','success','shared.event.delete','Evento eliminado');notifyPartner(u.id,null,'couple','eliminó evento del calendario','Calendario conjunto');notify('couple',null,u.id);
   respond(res,200,{ok:true});return;
  }
  const b=await readBody(req);let body;
  try{body=normalizedSharedEvent(b);}catch(ex){fail(400,ex.message);}
  // Optimistic concurrency: protect another user's edits in Google Calendar mobile.
  if(!/^"[^"\r\n]{1,180}"$/.test(String(b.etag||'')))fail(409,'Actualiza los eventos antes de editarlos: falta la versión del evento');
  if(b.meet===true)body.conferenceData={createRequest:{requestId:'dupla-'+uid(),conferenceSolutionKey:{type:'hangoutsMeet'}}};
  try{await googleRequest(token,'PUT',googlePath+(b.meet===true?'?conferenceDataVersion=1':''),body,{'If-Match':b.etag});}
  catch(ex){if(ex.statusCode===412||ex.statusCode===409)fail(409,'Otro usuario ha editado este evento. Actualiza antes de volver a guardar');fail(502,'Google no pudo editar el evento: '+ex.message);}
  logIntegration('google','success','shared.event.update','Evento actualizado');notifyPartner(u.id,null,'couple','modificó evento del calendario',body.summary);notify('couple',null,u.id);
  respond(res,200,{ok:true});return;
 }
 // DUPLA_INTEGRAL_47: informes autenticados y gestion de sesiones propias.
 if(path==='/api/system/status'&&req.method==='GET'){
  respond(res,200,{
   application:'DUPLA',edition:'4.7',database:'available',storage:'Durable Object SQLite',
   collaboration:'WebSocket',users:get('SELECT COUNT(*) AS n FROM users').n,
   projects:get('SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL').n,
   tasks:get('SELECT COUNT(*) AS n FROM tasks').n,
   connected:{ai:Boolean(env.OPENAI_API_KEY),webhook:Boolean(env.WORK_WEBHOOK_URL)},
   checked_at:now()
  });return;
 }
 if(path==='/api/sessions/revoke-others'&&req.method==='POST'){
  const before=get('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND token_hash!=?',u.id,u.token_hash).n;
  run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?',u.id,u.token_hash);
  respond(res,200,{ok:true,revoked:before});return;
 }
 if(path==='/api/integrations/test'&&req.method==='POST'){
  const b=await readBody(req);
  const type=choice(b.type,['ai','webhook']);
  if(type==='webhook'){
   if(!env.WORK_WEBHOOK_URL)fail(503,'Primero configura WORK_WEBHOOK_URL como secreto de Cloudflare');
   let safe;try{safe=validateWebhookUrl(env.WORK_WEBHOOK_URL);}catch{fail(400,'La URL del webhook es inválida o no es segura');}
   let r;try{r=await fetch(safe,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'dos-espacios',version:1,space:'work',type:'connection.test',test:true,at:now()}),signal:AbortSignal.timeout(10000),redirect:'error'});}
   catch(ex){logIntegration('webhook','error','connection.test',String(ex.message).slice(0,120));fail(502,'No se pudo contactar con el webhook: '+String(ex.message).slice(0,120));}
   if(!r.ok){logIntegration('webhook','error','connection.test','HTTP '+r.status);fail(502,'El receptor del webhook respondió con HTTP '+r.status);}
   logIntegration('webhook','success','connection.test','HTTP '+r.status);
   respond(res,200,{ok:true,type,message:'Webhook probado: receptor HTTP '+r.status+' (evento de prueba entregado)'});return;
  }
  if(!env.OPENAI_API_KEY)fail(503,'Primero configura OPENAI_API_KEY como secreto de Cloudflare');
  let r;try{r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify({model:env.OPENAI_MODEL||'gpt-5-mini',input:'Responde solamente con OK.',max_output_tokens:64,store:false}),signal:AbortSignal.timeout(18000)});}
  catch(ex){logIntegration('ai','error','connection.test',String(ex.message).slice(0,120));fail(502,'No se pudo contactar con el proveedor IA: '+String(ex.message).slice(0,120));}
  if(!r.ok){let detail='';try{const data=await r.json();detail=String(data.error?.message||'').slice(0,160);}catch{}logIntegration('ai','error','connection.test','HTTP '+r.status);fail(502,'El proveedor IA respondió HTTP '+r.status+(detail?': '+detail:''));}
  logIntegration('ai','success','connection.test','HTTP '+r.status);
  respond(res,200,{ok:true,type,message:'IA probada correctamente: el proveedor respondió a una solicitud real'});return;
 }
 if(path==='/api/snapshot'&&req.method==='GET'){
  // Manual full data export, including attachment payloads, but never credentials or session tokens.
  const tables=['projects','tasks','sections','events','comments','links','assets','milestones','expenses','checklist_items','activities','ideas','section_versions','decisions','decision_votes','knowledge','audit_events','notifications','reminder_sent','integration_runs','work_deliverables','time_entries','trip_stops','automation_rules','automation_executions','brief_imports'];
  const data=Object.fromEntries(tables.map(t=>[t,all(`SELECT * FROM ${t}`)]));
  for(const t of V6_TABLES)data[t]=all(`SELECT * FROM ${t}`);
  const files=[];let total=0;
  // Adjuntos + portadas de proyecto + avatar de Dupla (DUPLA 6): todo lo que vive en upload_chunks.
  for(const name of [...data.assets.map(a=>a.stored_name),...v6Files(data)]){
   if(!fileExists(name))continue;
   const file=readFile(name);total+=file.length;
   if(total>18*1024*1024)fail(413,'Los archivos son demasiado grandes para una exportación web. Utiliza la restauración por puntos de Cloudflare o exporta archivos por separado.');
   files.push({stored_name:name,base64:file.toString('base64')});
  }
  const metadata=all('SELECT id,name,email,created_at FROM users');
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':'attachment; filename="dos-espacios-copia-completa.json"'});
  res.end(JSON.stringify({format:'dos-espacios-edge-v1',exported_at:now(),users:metadata,data,files}));return;
 }
 // Explicit, password-confirmed restore. Users, login credentials, sessions, secrets and DO identity are never overwritten.
 if((path==='/api/snapshot/restore'||path==='/api/backups/restore')&&req.method==='POST'){
  const b=await readBody(req);
  const fromR2=path==='/api/backups/restore';
  if(fromR2){
   if(!env.BACKUP_BUCKET)fail(409,'Las copias externas R2 no están configuradas');
   if(typeof b.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.date))fail(400,'Fecha de copia inválida');
   // Password and explicit confirmation are checked BEFORE requesting the full backup.
   if(b.confirmation!=='RESTAURAR DUPLA')fail(400,'Escribe RESTAURAR DUPLA para confirmar');
   const restoreAccount=get('SELECT password_hash FROM users WHERE id=?',u.id);
   if(!await verifyPassword(String(b.password||''),restoreAccount.password_hash))fail(403,'Contraseña actual incorrecta');
   b.snapshot=await readR2Backup(b.date,{withFiles:true});
  }
  if(b.confirmation!=='RESTAURAR DUPLA')fail(400,'Confirma la restauración escribiendo RESTAURAR DUPLA');
  const account=get('SELECT password_hash FROM users WHERE id=?',u.id);
  if(!await verifyPassword(String(b.password||''),account.password_hash))fail(403,'Contraseña actual incorrecta');
  const snapshot=b.snapshot;
  if(!snapshot||snapshot.format!=='dos-espacios-edge-v1'||!snapshot.data||!Array.isArray(snapshot.users)||!Array.isArray(snapshot.files))fail(400,'Formato de copia completa no compatible');
  const currentUsers=all('SELECT id,email FROM users ORDER BY id');
  const importedUsers=snapshot.users.map(x=>({id:x.id,email:x.email})).sort((x,y)=>x.id.localeCompare(y.id));
  if(JSON.stringify(currentUsers)!==JSON.stringify(importedUsers))fail(409,'Esta copia pertenece a otras cuentas. Por seguridad no se importará.');
  const tables=['projects','tasks','sections','events','comments','links','assets','milestones','expenses','checklist_items','activities','ideas','section_versions','decisions','decision_votes','knowledge','audit_events','notifications'];
  const allTables=[...tables,'reminder_sent','integration_runs','work_deliverables','time_entries','trip_stops','automation_rules','automation_executions','brief_imports',...V6_TABLES.filter(t=>snapshot.data?.[t])];
  const data=snapshot.data;
  let count=0;
  const prepared=[];
  for(const table of allTables){
   const records=data[table]??[];
   if(!Array.isArray(records)||records.length>25000)fail(413,'La copia contiene demasiados registros o una tabla inválida');
   const knownColumns=all('PRAGMA table_info('+table+')').map(c=>c.name);
   if(!knownColumns.length)fail(400,'Tabla desconocida en la copia');
   for(const record of records){
    if(!record||typeof record!=='object'||Array.isArray(record))fail(400,'Fila de copia inválida');
    const keys=Object.keys(record);
    if(!keys.length||keys.some(k=>!knownColumns.includes(k)))fail(400,'Campo desconocido en la copia');
    if(keys.some(k=>record[k]!==null&&!['string','number'].includes(typeof record[k])))fail(400,'Tipo de dato no permitido');
    prepared.push({table,keys,values:keys.map(k=>record[k])});
    if(++count>70000)fail(413,'Copia demasiado grande');
   }
  }
  const files=new Map();
  let bytes=0;
  for(const file of snapshot.files){
   if(!file||typeof file.stored_name!=='string'||!/^[a-f0-9-]{36}$/.test(file.stored_name)||typeof file.base64!=='string'||!/^[a-zA-Z0-9+/]*={0,2}$/.test(file.base64))fail(400,'Adjunto inválido');
   const raw=Buffer.from(file.base64,'base64');if(raw.length>6*1024*1024||!raw.length)fail(413,'Adjunto inválido o demasiado grande');
   if(files.has(file.stored_name))fail(400,'Adjunto duplicado');
   files.set(file.stored_name,raw);bytes+=raw.length;
   if(bytes>(fromR2?36:6)*1024*1024)fail(413,fromR2?'Los adjuntos exceden los 36 MiB de la copia R2':'Esta copia requiere restauración externa. Máximo 6 MB en restauración web.');
  }
  for(const asset of data.assets||[]){if(!files.has(asset.stored_name)||files.get(asset.stored_name).length!==asset.size)fail(400,'Falta un archivo adjunto o su tamaño no coincide');}
  const expected=new Set([...(data.assets||[]).map(a=>a.stored_name),...v6Files(data)]);
  for(const name of files.keys())if(!expected.has(name))fail(400,'La copia contiene adjuntos inesperados');
  const deletion=['brief_imports','automation_executions','automation_rules','time_entries','work_deliverables','trip_stops','reminder_sent','integration_runs','notifications','decision_votes','checklist_items','section_versions','assets','expenses','milestones','links','comments','events','sections','tasks','decisions','ideas','knowledge','activities','audit_events','projects'];
  try{db.transactionSync(()=>{
   // Idempotency receipts are tied to the previous project set, not to restored data.
   run('DELETE FROM project_create_requests');
   for(const table of deletion)run('DELETE FROM '+table);
   for(const t of V6_TABLES)if(snapshot.data?.[t])run('DELETE FROM '+t);
   // Old webhook events must not be delivered after restoring a historical snapshot.
   run('DELETE FROM webhook_outbox');
   run('DELETE FROM upload_chunks');
   for(const item of prepared){
    const placeholders=item.keys.map(()=>'?').join(',');
    run('INSERT INTO '+item.table+'('+item.keys.join(',')+') VALUES('+placeholders+')',...item.values);
   }
   for(const [name,file] of files){let seq=0;for(let offset=0;offset<file.length;offset+=384*1024)run('INSERT INTO upload_chunks(name,seq,data) VALUES(?,?,?)',name,seq++,new Uint8Array(file.subarray(offset,offset+384*1024)));}
   // Copias antiguas o R2 sin portadas/avatar: nunca dejar referencias a archivos que no existen.
   run('UPDATE projects SET cover_file=NULL WHERE cover_file IS NOT NULL AND cover_file NOT IN (SELECT DISTINCT name FROM upload_chunks)');
   run("DELETE FROM shared_settings WHERE key='dupla_avatar' AND json_extract(value,'$') NOT IN (SELECT DISTINCT name FROM upload_chunks)");
   const bad=all('PRAGMA foreign_key_check');if(bad.length)fail(409,'Referencias de datos inconsistentes; se ha cancelado la restauración');
  });}catch(error){if(/FOREIGN KEY|constraint|CHECK/i.test(String(error.message)))fail(409,'La copia contiene referencias o datos incoherentes; ningún dato ha sido sustituido');throw error;}
  notify('all',null,u.id);
  respond(res,200,{ok:true,restored_records:count,restored_files:files.size});return;
 }
 // Project operations: only authenticated members, no external credentials in the browser.
 const op=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/operations(?:\/(deliverables|hours|itinerary|automations|run|brief|days))?(?:\/([a-f0-9-]{36}))?$/);
 if(op){
  const p=project(op[1]);const kind=op[2]||'all',itemId=op[3];
  const requireKind=space=>{if(p.space!==space)fail(403,'Esta función pertenece al otro espacio');};
  const changed=(label,detailText)=>logChange(p,u,label,detailText);
  const lists=()=>({
   deliverables:p.space==='work'?all('SELECT * FROM work_deliverables WHERE project_id=? ORDER BY updated_at DESC',p.id):[],
   hours:p.space==='work'?all('SELECT te.*,us.name AS person FROM time_entries te JOIN users us ON te.user_id=us.id WHERE te.project_id=? ORDER BY work_date DESC,created_at DESC LIMIT 300',p.id):[],
   itinerary:p.space==='couple'?all('SELECT * FROM trip_stops WHERE project_id=? ORDER BY visit_date,sort_order,visit_time',p.id):[],
   trip_days:p.space==='couple'?all('SELECT day_date,done FROM trip_days WHERE project_id=? ORDER BY day_date',p.id):[],
   automations:p.space==='work'?all('SELECT * FROM automation_rules WHERE project_id=? ORDER BY created_at DESC',p.id):[],
   executions:p.space==='work'?all('SELECT ae.* FROM automation_executions ae JOIN automation_rules ar ON ar.id=ae.rule_id WHERE ar.project_id=? ORDER BY ae.run_at DESC LIMIT 100',p.id):[]
  });
  if(kind==='all'&&req.method==='GET'){respond(res,200,{...lists(),users:all('SELECT id,name FROM users')});return;}
  if(kind==='brief'&&req.method==='POST'){
   requireKind('work');const b=await readBody(req);const brief=requireText(b.brief,'Briefing',8000);
   let lines=brief.split(/\r?\n/).map(x=>x.trim()).filter(x=>/^(?:[-*•]|\d+[.)])\s+/.test(x)).map(x=>x.replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(x=>x.length>=4&&x.length<=180);
   if(!lines.length)lines=brief.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>=4&&x.length<=180);
   const tasks=[...new Set(lines)].slice(0,25);if(!tasks.length)fail(400,'Incluye al menos una tarea por línea. Puedes utilizar guiones o números.');
   if(b.confirm!==true){respond(res,200,{preview:true,tasks});return;}
   const fingerprint=sha(brief);if(get('SELECT 1 AS found FROM brief_imports WHERE project_id=? AND brief_hash=?',p.id,fingerprint)){respond(res,200,{created:false,task_ids:[]});return;}
   const t=now(),ids=[];db.transactionSync(()=>{
    run('INSERT INTO brief_imports(project_id,brief_hash,created_at) VALUES(?,?,?)',p.id,fingerprint,t);
    run('INSERT INTO sections(id,project_id,title,content,sort_order,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),p.id,'Briefing de trabajo · '+t.slice(0,10),brief,0,1,u.id,u.id,t,t);
    for(const title of tasks){const id=uid();run('INSERT INTO tasks(id,project_id,title,description,state,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,p.id,title,'Generada desde el briefing aprobado','todo','normal',u.id,t,t);ids.push(id);}
   });
   changed('convirtió briefing en tareas',tasks.length+' tareas');respond(res,201,{created:true,task_ids:ids});return;
  }
  if(kind==='deliverables'){
   requireKind('work');
   if(req.method==='POST'&&!itemId){const b=await readBody(req),id=uid();run('INSERT INTO work_deliverables(id,project_id,title,description,status,due_date,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Entregable',180),optional(b.description,5000),'draft',validDate(b.due_date),u.id,now());changed('creó entregable',b.title);respond(res,201,{id});return;}
   const row=itemId?get('SELECT * FROM work_deliverables WHERE id=? AND project_id=?',itemId,p.id):null;
   if(itemId&&!row)fail(404,'Entregable no encontrado');
   if(row&&req.method==='PATCH'){const b=await readBody(req);requireRevision(b,row);const status=choice(b.status,['draft','review','approved'],row.status);run('UPDATE work_deliverables SET title=?,description=?,status=?,due_date=?,revision=revision+1,updated_at=? WHERE id=?',b.title===undefined?row.title:requireText(b.title,'Título',180),b.description===undefined?row.description:optional(b.description,5000),status,b.due_date===undefined?row.due_date:validDate(b.due_date),now(),row.id);changed('actualizó entregable',row.title+' · '+status);respond(res,200,{item:get('SELECT * FROM work_deliverables WHERE id=?',row.id)});return;}
   if(row&&req.method==='DELETE'){run('DELETE FROM work_deliverables WHERE id=?',row.id);changed('eliminó entregable',row.title);respond(res,200,{ok:true});return;}
  }
  if(kind==='hours'){
   requireKind('work');
   if(req.method==='POST'&&!itemId){const b=await readBody(req),minutes=Number(b.minutes),date=validDate(b.work_date);if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!date)fail(400,'Indica minutos (1-1440) y una fecha válida');if(b.task_id&&!get('SELECT id FROM tasks WHERE id=? AND project_id=?',b.task_id,p.id))fail(400,'Tarea ajena al proyecto');const id=uid();run('INSERT INTO time_entries(id,project_id,task_id,user_id,minutes,work_date,note,created_at) VALUES(?,?,?,?,?,?,?,?)',id,p.id,b.task_id||null,u.id,minutes,date,optional(b.note,600),now());changed('registró tiempo',minutes+' min');respond(res,201,{id});return;}
   const row=itemId?get('SELECT * FROM time_entries WHERE id=? AND project_id=?',itemId,p.id):null;
   if(itemId&&!row)fail(404,'Registro no encontrado');
   if(row&&req.method==='DELETE'){if(row.user_id!==u.id)fail(403,'Solo puedes eliminar tus propias horas');run('DELETE FROM time_entries WHERE id=?',row.id);changed('eliminó registro de tiempo',row.work_date);respond(res,200,{ok:true});return;}
  }
  if(kind==='days'&&req.method==='POST'){requireKind('couple');const b=await readBody(req),date=validDate(b.date);if(!date)fail(400,'Día no válido');const done=b.done?1:0;
   run('INSERT INTO trip_days(project_id,day_date,done,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(project_id,day_date) DO UPDATE SET done=excluded.done,updated_by=excluded.updated_by,updated_at=excluded.updated_at',p.id,date,done,u.id,now());
   changed(done?'completó un día del viaje':'reabrió un día del viaje',date);respond(res,200,{ok:true,date,done:Boolean(done)});return;}
  if(kind==='itinerary'){
   requireKind('couple');
   if(req.method==='POST'&&!itemId){const b=await readBody(req),id=uid(),date=validDate(b.visit_date);if(!date)fail(400,'Fecha obligatoria');run('INSERT INTO trip_stops(id,project_id,title,visit_date,visit_time,location,details,booking_state,reference,created_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Actividad',180),date,validTime(b.visit_time),optional(b.location,250),optional(b.details,3500),booking(b.booking_state),optional(b.reference,250),u.id,now());changed('añadió itinerario',b.title);respond(res,201,{id});return;}
   const row=itemId?get('SELECT * FROM trip_stops WHERE id=? AND project_id=?',itemId,p.id):null;
   if(itemId&&!row)fail(404,'Parada no encontrada');
   if(row&&req.method==='PATCH'){const b=await readBody(req);requireRevision(b,row);const state=b.state===undefined?row.state:choice(b.state,['planned','done','cancelled']),used=b.booking_used===undefined?row.booking_used:(b.booking_used?1:0),order=b.sort_order===undefined?row.sort_order:(Number.isInteger(b.sort_order)&&Math.abs(b.sort_order)<1e6?b.sort_order:fail(400,'Orden no válido'));
    run('UPDATE trip_stops SET state=?,booking_used=?,sort_order=?,title=?,visit_date=?,visit_time=?,location=?,details=?,booking_state=?,reference=?,revision=revision+1,updated_at=? WHERE id=?',state,used,order,b.title===undefined?row.title:requireText(b.title,'Actividad',180),b.visit_date===undefined?row.visit_date:validDate(b.visit_date),b.visit_time===undefined?row.visit_time:validTime(b.visit_time),b.location===undefined?row.location:optional(b.location,250),b.details===undefined?row.details:optional(b.details,3500),booking(b.booking_state,row.booking_state),b.reference===undefined?row.reference:optional(b.reference,250),now(),row.id);changed(state!==row.state?(state==='done'?'completó la actividad':state==='cancelled'?'canceló la actividad':'reactivó la actividad'):used!==row.booking_used?(used?'usó la reserva':'desmarcó la reserva usada'):b.visit_date&&b.visit_date!==row.visit_date?'reagendó la actividad':'actualizó itinerario',row.title);respond(res,200,{item:get('SELECT * FROM trip_stops WHERE id=?',row.id)});return;}
   if(row&&req.method==='DELETE'){run('DELETE FROM trip_stops WHERE id=?',row.id);changed('eliminó actividad de itinerario',row.title);respond(res,200,{ok:true});return;}
  }
  if(kind==='automations'){
   requireKind('work');
   if(req.method==='POST'&&!itemId){const b=await readBody(req),id=uid();const trigger=choice(b.trigger_type,['manual','daily','weekly'],'manual'),action=choice(b.action_type,['task','notify'],'task');let day=Number(b.week_day??1);if(!Number.isInteger(day)||day<0||day>6)fail(400,'Día de la semana inválido');run('INSERT INTO automation_rules(id,project_id,title,trigger_type,week_day,action_type,payload,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Automatización',150),trigger,day,action,requireText(b.payload,'Texto de acción',200),0,u.id,now());changed('creó automatización',b.title);respond(res,201,{id});return;}
   const row=itemId?get('SELECT * FROM automation_rules WHERE id=? AND project_id=?',itemId,p.id):null;
   if(itemId&&!row)fail(404,'Regla no encontrada');
   if(row&&req.method==='PATCH'){const b=await readBody(req);const active=b.active===true?1:b.active===false?0:row.active;run('UPDATE automation_rules SET active=? WHERE id=?',active,row.id);changed('configuró automatización',row.title);respond(res,200,{ok:true,active});return;}
   if(row&&req.method==='DELETE'){run('DELETE FROM automation_rules WHERE id=?',row.id);changed('eliminó automatización',row.title);respond(res,200,{ok:true});return;}
  }
  if(kind==='run'&&req.method==='POST'&&itemId){requireKind('work');const row=get('SELECT * FROM automation_rules WHERE id=? AND project_id=?',itemId,p.id);if(!row)fail(404,'Regla no encontrada');const result=executeRule(row,u.id,'manual:'+uid());respond(res,200,{ok:true,...result});return;}
  fail(405,'Operación no disponible');
 }
 // Authenticated operational database check. Does not leak project data to anonymous visitors.
 if(path==='/api/ops/health'&&req.method==='GET'){
  let integrity='unavailable';try{const result=get('PRAGMA integrity_check');integrity=result?.integrity_check==='ok'?'ok':'attention';}catch{integrity='not_supported';}
  const probe=get('SELECT 1 AS ok');respond(res,200,{database_integrity:integrity,database_probe:probe?.ok===1?'ok':'attention',projects:get('SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL').n,deliverables:get('SELECT COUNT(*) AS n FROM work_deliverables').n,itinerary:get('SELECT COUNT(*) AS n FROM trip_stops').n,automations:get('SELECT COUNT(*) AS n FROM automation_rules').n,updated_at:now()});return;
 }
 if(path==='/api/backups/status'&&req.method==='GET'){
  const enabled=Boolean(env.BACKUP_BUCKET);const last=enabled&&typeof storage.get==='function'?await storage.get('dupla-backup-success'):null;
  respond(res,200,{enabled,last:last||null});return;
 }
 if(path==='/api/backups/run'&&req.method==='POST'){
  if(!env.BACKUP_BUCKET)fail(409,'Conecta primero un bucket privado R2');
  const result=await processScheduledBackup();
  respond(res,200,{ok:true,...result});return;
 }
 if(path==='/api/backups/verify'&&req.method==='GET'){
  if(!env.BACKUP_BUCKET)fail(409,'Conecta primero un bucket privado R2');
  const date=String(url.searchParams.get('date')||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'Fecha de copia inválida');
  const snapshot=await readR2Backup(date);
  const raw=JSON.stringify(snapshot),checksum=sha(raw);
  const current=all('SELECT id,email FROM users ORDER BY id');
  const copied=(snapshot.users||[]).map(x=>({id:x.id,email:x.email})).sort((a,b)=>a.id.localeCompare(b.id));
  if(!['dos-espacios-edge-v1','dos-espacios-edge-v2'].includes(snapshot.format)||JSON.stringify(current)!==JSON.stringify(copied))fail(409,'La copia no pertenece a estas dos cuentas o tiene formato inválido');
  const files=new Map((snapshot.files||[]).map(f=>[f.stored_name,snapshot.format==='dos-espacios-edge-v2'?f.size:Buffer.from(f.base64||'','base64').length]));
  for(const asset of snapshot.data?.assets||[])if(files.get(asset.stored_name)!==asset.size)fail(409,'Archivo incompleto o ausente');
  if(files.size!==(snapshot.data?.assets||[]).length)fail(409,'La copia contiene archivos inesperados o duplicados');
  respond(res,200,{ok:true,date,sha256:checksum,accounts:copied.length,projects:snapshot.data?.projects?.length||0,files:files.size,restorable:true});return;
 }
 if(path==='/api/backups/list'&&req.method==='GET'){
  if(!env.BACKUP_BUCKET)fail(409,'No hay almacenamiento externo R2 configurado');
  // R2 v2 writes private attachment objects under /files/. Those are not
  // independent backups; listing them as dates makes restoration misleading.
  const listed=await env.BACKUP_BUCKET.list({prefix:'dupla-backups/',delimiter:'/',limit:1000});
  const manifests=(listed.objects||[]).filter(x=>/^dupla-backups\/\d{4}-\d{2}-\d{2}\.json$/.test(x.key));
  respond(res,200,{objects:manifests.map(x=>({date:x.key.slice('dupla-backups/'.length,-5),size:x.size})).sort((a,b)=>b.date.localeCompare(a.date)),truncated:!!listed.truncated});return;
 }
 if(path==='/api/backups/download'&&req.method==='GET'){
  if(!env.BACKUP_BUCKET)fail(409,'No hay almacenamiento externo R2 configurado');
  const date=url.searchParams.get('date')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail(400,'Fecha inválida');
  // Download stays compatible with the existing manual restore format, even for v2.
  const snapshot=await readR2Backup(date,{withFiles:true});
  const payload=Buffer.from(JSON.stringify(snapshot));
  res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Disposition':`attachment; filename="dupla-${date}.json"`});res.end(payload);return;
 }
 if(path==='/api/logout'&&req.method==='POST'){run('DELETE FROM sessions WHERE token_hash=?',u.token_hash);respond(res,200,{ok:true},{'Set-Cookie':cookie('',0)});return;}
 if(path==='/api/stream'&&req.method==='GET'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': conectado\n\n');clients.add(res);const tick=setInterval(()=>{try{res.write(': latido\n\n');}catch{clearInterval(tick);clients.delete(res);}},25000);req.on('close',()=>{clearInterval(tick);clients.delete(res);});return;
 }
 // DUPLA_ACTION_CENTER_V46 - Centro de acciones (API autenticada)
 if(path==='/api/action-center'&&req.method==='GET'){
  const tasks=all(`SELECT t.id,t.project_id,t.title,t.description,t.state,t.priority,t.due_date,t.assigned_to,t.revision,t.recurrence,t.blocked_by,p.title AS project_title,p.space,u.name AS assignee_name
    FROM tasks t JOIN projects p ON p.id=t.project_id LEFT JOIN users u ON u.id=t.assigned_to
    WHERE p.deleted_at IS NULL AND p.archived=0
    ORDER BY CASE WHEN t.state='done' THEN 1 ELSE 0 END,CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,t.due_date ASC,CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,t.created_at DESC LIMIT 500`);
  respond(res,200,{items:tasks,generated_at:now()});return;
 }
 if(path==='/api/dashboard'&&req.method==='GET'){
  const projects=projectList();const recent=all('SELECT a.*,u.name AS author,p.title AS project_title FROM activities a LEFT JOIN users u ON a.user_id=u.id LEFT JOIN projects p ON a.project_id=p.id ORDER BY a.created_at DESC LIMIT 18');
  const upcoming=all(`SELECT t.id,t.title,t.due_date AS date,t.state,p.id AS project_id,p.title AS project_title,p.space,'task' AS kind FROM tasks t JOIN projects p ON t.project_id=p.id WHERE p.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.state!='done' UNION ALL SELECT e.id,e.title,e.event_date AS date,'' AS state,p.id AS project_id,p.title AS project_title,p.space,'event' AS kind FROM events e JOIN projects p ON e.project_id=p.id WHERE p.deleted_at IS NULL ORDER BY date ASC LIMIT 40`);
  respond(res,200,{projects,recent,upcoming,ideas:all('SELECT i.*,us.name AS author FROM ideas i LEFT JOIN users us ON us.id=i.created_by ORDER BY i.updated_at DESC LIMIT 300'),unread:get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',u.id).n,users:all('SELECT id,name,email FROM users ORDER BY name'),integrations:{ai:!!env.OPENAI_API_KEY,webhook:!!env.WORK_WEBHOOK_URL,model:env.OPENAI_MODEL||'gpt-5-mini'}});return;
 }
 if(path==='/api/export'&&req.method==='GET'){
  const space=url.searchParams.get('space');if(space&&!['work','couple'].includes(space))fail(400,'Espacio inválido');const projects=projectList().filter(p=>!space||p.space===space).map(p=>detail(p.id));respond(res,200,{exported_at:now(),projects},{'Content-Disposition':'attachment; filename="dos-espacios-backup.json"'});return;
 }
 if(path==='/api/calendar.ics'&&req.method==='GET'){
  const escapeICS=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,c=>'\\'+c);
  const tasks=all(`SELECT t.id,t.title,t.due_date AS date,p.title AS project FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.due_date IS NOT NULL AND p.deleted_at IS NULL`);
  const events=all(`SELECT e.id,e.title,e.event_date AS date,p.title AS project FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL`);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DUPLA//ES','CALSCALE:GREGORIAN'];
  for(const x of [...tasks,...events])lines.push('BEGIN:VEVENT',`UID:${x.id}@dos-espacios`,`DTSTAMP:${now().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${x.date.replaceAll('-','')}`,`SUMMARY:${escapeICS(x.title)}`,`DESCRIPTION:${escapeICS(x.project)}`,'END:VEVENT');
  lines.push('END:VCALENDAR');res.writeHead(200,{'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'attachment; filename="dos-espacios.ics"','Cache-Control':'no-store'});res.end(lines.join('\r\n'));return;
 }

 // Shared idea inbox: anything recorded here is visible and editable by both people.
 if(path==='/api/knowledge'&&req.method==='GET'){
  const space=url.searchParams.get('space');if(space&& !['work','couple'].includes(space))fail(400,'Espacio inválido');
  const entries=space?all('SELECT k.*,u.name AS author FROM knowledge k LEFT JOIN users u ON u.id=k.created_by WHERE k.space=? ORDER BY k.updated_at DESC LIMIT 500',space):all('SELECT k.*,u.name AS author FROM knowledge k LEFT JOIN users u ON u.id=k.created_by ORDER BY k.updated_at DESC LIMIT 500');
  respond(res,200,{entries});return;
 }
 if(path==='/api/knowledge'&&req.method==='POST'){
  const b=await readBody(req);const space=choice(b.space,['work','couple']);const id=uid();let projectId=null;
  if(b.project_id){const p=project(b.project_id);if(p.space!==space)fail(400,'El proyecto pertenece a otro espacio');projectId=p.id;}
  run('INSERT INTO knowledge(id,space,project_id,title,question,answer,source,status,tags,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,space,projectId,requireText(b.title,'Conocimiento',180),optional(b.question,5000),optional(b.answer,12000),optional(b.source,700),choice(b.status,['draft','reviewed','validated'],'draft'),optional(b.tags,350),1,u.id,now(),now());
  activity(projectId,space,u.id,'registró conocimiento',b.title);notify(space,projectId,u.id);respond(res,201,{item:get('SELECT * FROM knowledge WHERE id=?',id)});return;
 }
 const know=path.match(/^\/api\/knowledge\/([a-f0-9-]{36})$/);
 if(know){const row=get('SELECT * FROM knowledge WHERE id=?',know[1]);if(!row)fail(404,'Conocimiento no encontrado');
  if(req.method==='PATCH'){const b=await readBody(req);requireRevision(b,row);const changed=run('UPDATE knowledge SET title=?,question=?,answer=?,source=?,tags=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Conocimiento',180),b.question===undefined?row.question:optional(b.question,5000),b.answer===undefined?row.answer:optional(b.answer,12000),b.source===undefined?row.source:optional(b.source,700),b.tags===undefined?row.tags:optional(b.tags,350),choice(b.status,['draft','reviewed','validated'],row.status),now(),row.id,row.revision);if(!changed.changes)fail(409,'Este conocimiento fue editado por otra persona');activity(row.project_id,row.space,u.id,'actualizó conocimiento',row.title);notify(row.space,row.project_id,u.id);respond(res,200,{item:get('SELECT * FROM knowledge WHERE id=?',row.id)});return;}
  if(req.method==='DELETE'){run('DELETE FROM knowledge WHERE id=?',row.id);activity(row.project_id,row.space,u.id,'eliminó conocimiento',row.title);notify(row.space,row.project_id,u.id);respond(res,200,{ok:true});return;}
 }
 if(path==='/api/analytics'&&req.method==='GET'){
  const space=url.searchParams.get('space');if(space&&!['work','couple'].includes(space))fail(400,'Espacio inválido');const where=space?'WHERE space=?':'';const args=space?[space]:[];
  const totals={projects:get(`SELECT COUNT(*) AS n FROM projects ${space?'WHERE space=? AND deleted_at IS NULL':'WHERE deleted_at IS NULL'}`,...args).n,tasks:get(`SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id=t.project_id ${space?'WHERE p.space=? AND p.deleted_at IS NULL':'WHERE p.deleted_at IS NULL'}`,...args).n,done:get(`SELECT COUNT(*) AS n FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.state='done' AND p.deleted_at IS NULL ${space?'AND p.space=?':''}`,...args).n,ideas:get(`SELECT COUNT(*) AS n FROM ideas ${where}`,...args).n,knowledge:get(`SELECT COUNT(*) AS n FROM knowledge ${where}`,...args).n};
  const trend=all(`SELECT substr(occurred_at,1,10) AS date,count(*) AS changes FROM audit_events ${where} GROUP BY substr(occurred_at,1,10) ORDER BY date DESC LIMIT 30`,...args).reverse();
  const statuses=all(`SELECT status,count(*) AS n FROM projects WHERE deleted_at IS NULL ${space?'AND space=?':''} GROUP BY status`,...args);
  respond(res,200,{space:space||'all',totals,trend,statuses,source:'Tablas persistentes; audit_events registra cambios desde V4 y no reconstruye fechas históricas.',updated_at:now()});return;
 }
 if(path==='/api/guardian/review'&&req.method==='POST'){const notices=processGuardianReview();respond(res,200,{ok:true,...notices});return;}
 if(path==='/api/guardian/actions'&&req.method==='GET'){
  const items=all(`SELECT g.*,p.title AS project_title FROM guardian_proposals g JOIN projects p ON p.id=g.project_id
      WHERE p.space='work' AND p.deleted_at IS NULL ORDER BY g.created_at DESC LIMIT 100`);
  respond(res,200,{scope:'work',items});return;
 }
 const guardianAction=path.match(/^\/api\/guardian\/actions\/([a-f0-9-]{36})\/(approve|reject|execute)$/);
 if(guardianAction&&req.method==='POST'){
  const id=guardianAction[1],command=guardianAction[2];const item=get('SELECT * FROM guardian_proposals WHERE id=?',id);
  if(!item)fail(404,'Propuesta no encontrada');const p=project(item.project_id);
  if(p.space!=='work')fail(403,'No se permiten propuestas sobre Planes en común');
  if(command==='reject'){
   if(item.status==='executed')fail(409,'La acción ya se ejecutó');
   if(item.status!=='rejected')run("UPDATE guardian_proposals SET status='rejected',decided_by=?,decided_at=? WHERE id=?",u.id,now(),id);
   respond(res,200,{status:'rejected'});return;
  }
  if(command==='approve'){
   if(item.status==='rejected'||item.status==='executed')fail(409,'La propuesta ya está cerrada');
   if(!directorIssues().some(x=>x.project_id===p.id&&x.type===item.issue_type))fail(409,'El problema ya no está vigente; no se puede aprobar');
   run("UPDATE guardian_proposals SET status='approved',decided_by=?,decided_at=? WHERE id=? AND status='proposed'",u.id,now(),id);
   respond(res,200,{status:'approved'});return;
  }
  if(item.status==='executed'){respond(res,200,{status:'executed',task_id:item.executed_task_id,created:false});return;}
  if(item.status!=='approved'||!item.decided_by)fail(403,'Es necesario aprobar explícitamente la propuesta');
  if(!directorIssues().some(x=>x.project_id===p.id&&x.type===item.issue_type))fail(409,'El problema ha desaparecido; revisa antes de ejecutar');
  let taskId,created=false;
  db.transactionSync(()=>{
   const existing=get("SELECT id FROM tasks WHERE project_id=? AND title=? AND state!='done' LIMIT 1",p.id,item.task_title);
   taskId=existing?.id;
   if(!taskId){taskId=uid();created=true;const t=now();
    run('INSERT INTO tasks(id,project_id,title,description,state,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',taskId,p.id,item.task_title,item.detail,'todo',item.severity==='high'?'high':'normal',u.id,t,t);
   }
   const saved=run("UPDATE guardian_proposals SET status='executed',executed_task_id=?,executed_by=?,executed_at=? WHERE id=? AND status='approved'",taskId,u.id,now(),id);
   if(!saved.changes)throw Error('La propuesta cambió mientras se ejecutaba');
  });
  logChange(p,u,'ejecutó propuesta autorizada',item.task_title);
  respond(res,200,{status:'executed',created,task_id:taskId});return;
 }

 if(path==='/api/guardian/insights'&&req.method==='GET'){
  respond(res,200,{generated_at:now(),scope:'work',issues:directorIssues()});return;
 }
 if(path==='/api/guardian/insights/create-task'&&req.method==='POST'){
  const b=await readBody(req);const issue=directorIssues().find(x=>x.id===b.id);
  if(!issue)fail(409,'Esta recomendación ya no está vigente. Actualiza la revisión.');
  const p=project(issue.project_id);
  if(p.space!=='work')fail(403,'El Director General no interviene en Planes en común');
  const existing=get("SELECT id FROM tasks WHERE project_id=? AND title=? AND state!='done' LIMIT 1",p.id,issue.task_title);
  if(existing){respond(res,200,{created:false,task_id:existing.id});return;}
  const id=uid(),t=now();
  run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.id,issue.task_title,issue.detail,'todo',null,issue.severity==='high'?'high':'normal',null,u.id,t,t);
  logChange(p,u,'convirtió una alerta en tarea',issue.task_title);
  respond(res,201,{created:true,task_id:id});return;
 }
 if(path==='/api/guardian/report'&&req.method==='GET'){
  const reportPath='guardian-report';if(!get('SELECT 1 AS ok FROM guardian_reports WHERE id=1')){respond(res,200,{available:false,reason:'Aún no hay informe técnico publicado en la nube. Las revisiones automáticas de código se ejecutan fuera del servicio, en un entorno de desarrollo o CI.'});return;}
  let report;try{report=JSON.parse(get('SELECT json FROM guardian_reports WHERE id=1').json);}catch{fail(500,'Informe no válido');}
  respond(res,200,{available:true,project:report.project,generated_at:report.generated_at,release_decision:report.release_decision,counts:report.evaluation?.counts,findings:(report.evaluation?.findings||[]).map(f=>({id:f.id,severity:f.severity,title:f.title,why:f.why,remediation:f.remediation})),tests:(report.tests||[]).map(t=>({command:t.command,passed:t.passed,duration_ms:t.duration_ms}))});return;
 }
 if(path==='/api/ideas'&&req.method==='POST'){
  const b=await readBody(req),id=uid(),t=now(),space=choice(b.space,['work','couple']);
  run('INSERT INTO ideas(id,space,title,body,state,project_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,space,requireText(b.title,'Idea',160),optional(b.body,6000),'inbox',null,u.id,t,t);
  const idea=get('SELECT * FROM ideas WHERE id=?',id);logIdea(idea,u,'propuso una idea');respond(res,201,{idea});return;
 }
 const im=path.match(/^\/api\/ideas\/([a-f0-9-]{36})(?:\/(convert))?$/);
 if(im){const idea=get('SELECT * FROM ideas WHERE id=?',im[1]);if(!idea)fail(404,'Idea no encontrada');
  if(im[2]==='convert'&&req.method==='POST'){
   if(idea.project_id||idea.converted_kind)fail(409,'Esta idea ya se convirtió');
   // R0336-R0340: proyecto de trabajo, plan en común, viaje o lista de deseos.
   const cb=await readBody(req),target=choice(cb.target||(idea.space==='work'?'work':'plan'),['work','plan','trip','wish']);
   if(target==='wish'){const wid=uid(),t=now();db.transactionSync(()=>{run('INSERT INTO couple_items(id,kind,title,body,idea_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',wid,'wish',idea.title,idea.body,idea.id,u.id,t,t);const ok=run("UPDATE ideas SET state='converted',converted_kind='wish',converted_ref=?,archived_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND project_id IS NULL AND converted_kind IS NULL",wid,t,idea.id);if(!ok.changes)fail(409,'La idea ya está convertida');});
    logIdea(idea,u,'pasó una idea a la lista de deseos');respond(res,201,{wish:get('SELECT * FROM couple_items WHERE id=?',wid)});return;}
   const space=target==='work'?'work':'couple',kind=target==='trip'?'trip':'blank',dest=target==='trip'?optional(cb.destination,120):'';
   const id=uid(),t=now();db.transactionSync(()=>{
    run('INSERT INTO projects(id,space,title,description,status,color,kind,destination,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,space,idea.title,idea.body,'idea',space==='work'?'indigo':'rose',kind,dest,u.id,t,t);
    const updated=run("UPDATE ideas SET state=?,project_id=?,converted_kind=?,converted_ref=?,archived_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND project_id IS NULL AND converted_kind IS NULL",'converted',id,target,id,t,idea.id);if(!updated.changes)fail(409,'La idea ya está convertida');
    
   });
   logIdea(idea,u,target==='trip'?'convirtió una idea en viaje':target==='plan'?'convirtió una idea en plan en común':'convirtió una idea en proyecto');const np=project(id);if(np.destination){const job=v6.autoCover(np);if(ctx.waitUntil)ctx.waitUntil(job);else await job;}respond(res,201,{project:np});return;
  }
  if(req.method==='PATCH'){
   const b=await readBody(req);requireRevision(b,idea);const arch=b.archived===undefined?idea.archived_at:(b.archived?(idea.archived_at||now()):null);const changed=run('UPDATE ideas SET archived_at=?,title=?,body=?,state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',arch,b.title===undefined?idea.title:requireText(b.title,'Idea',160),b.body===undefined?idea.body:optional(b.body,6000),choice(b.state,['inbox','considering','converted'],idea.state),now(),idea.id,idea.revision);if(!changed.changes)fail(409,'Idea modificada por otra persona');
   logIdea(get('SELECT * FROM ideas WHERE id=?',idea.id),u,b.archived===true?'archivó una idea':b.archived===false?'recuperó una idea':'actualizó una idea');respond(res,200,{idea:get('SELECT * FROM ideas WHERE id=?',idea.id)});return;
  }
  if(req.method==='DELETE'){run('DELETE FROM ideas WHERE id=?',idea.id);logIdea(idea,u,'eliminó una idea');respond(res,200,{ok:true});return;}
 }
 if(path==='/api/search'&&req.method==='GET'){
  const query=String(url.searchParams.get('q')||'').trim();if(query.length<2||query.length>100)fail(400,'Busca entre 2 y 100 caracteres');
  const pattern='%'+query.replace(/[\%_]/g,c=>'\\'+c)+'%';
  // R0200-R0208: filtro Trabajo/Nuestro espacio/Todo y «buscar en este proyecto».
  const space=['work','couple'].includes(url.searchParams.get('space'))?url.searchParams.get('space'):'',only=url.searchParams.get('project')?project(url.searchParams.get('project')).id:'';
  const rows=(sql)=>all(sql,...Array(sql.split('?').length-1).fill(pattern)).filter(r=>(!space||r.space===space)&&(!only||r.project_id===only)).slice(0,30);
  const found={projects:rows("SELECT id AS project_id,title,description AS snippet,space,CASE WHEN kind='trip' OR destination!='' THEN 'trip' ELSE 'project' END AS type,destination,start_date FROM projects WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR destination LIKE ? ESCAPE '\\') LIMIT 300"),ideas:rows("SELECT id,project_id,title,body AS snippet,space,'idea' AS type FROM ideas WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' LIMIT 300")};
  for(const [key,table,fields] of [['tasks','tasks','t.title,t.description'],['notes','sections','t.title,t.content'],['milestones','milestones','t.title,t.description'],['events','events','t.title,t.notes']]){
   const [a,b]=fields.split(',');found[key]=rows(`SELECT t.id,t.project_id,t.title,substr(${b},1,180) AS snippet,p.space,'${key}' AS type FROM ${table} t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND (${a} LIKE ? ESCAPE '\\' OR ${b} LIKE ? ESCAPE '\\') LIMIT 300`);
  }
  found.knowledge=rows("SELECT k.id,k.project_id,k.title,substr(k.answer,1,180) AS snippet,k.space,'knowledge' AS type FROM knowledge k WHERE k.title LIKE ? ESCAPE '\\' OR k.answer LIKE ? ESCAPE '\\' LIMIT 300");
  found.links=rows("SELECT l.id,l.project_id,l.label AS title,l.url AS snippet,p.space,'links' AS type FROM links l JOIN projects p ON p.id=l.project_id WHERE p.deleted_at IS NULL AND (l.label LIKE ? ESCAPE '\\' OR l.url LIKE ? ESCAPE '\\') LIMIT 300");
  found.decisions=rows("SELECT d.id,d.project_id,d.title,substr(d.description,1,180) AS snippet,p.space,'decisions' AS type FROM decisions d JOIN projects p ON p.id=d.project_id WHERE p.deleted_at IS NULL AND (d.title LIKE ? ESCAPE '\\' OR d.description LIKE ? ESCAPE '\\') LIMIT 300");
  found.assets=rows("SELECT a.id,a.project_id,a.name AS title,a.mime AS snippet,p.space,'assets' AS type FROM assets a JOIN projects p ON p.id=a.project_id WHERE p.deleted_at IS NULL AND (a.name LIKE ? ESCAPE '\\' OR a.mime LIKE ? ESCAPE '\\') LIMIT 300");
  found.memories=rows("SELECT id,project_id,title,substr(body,1,180) AS snippet,'couple' AS space,'memories' AS type FROM couple_items WHERE kind='memory' AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') LIMIT 300");
  found.trips=found.projects.filter(x=>x.type==='trip');found.projects=found.projects.filter(x=>x.type!=='trip');
  found.activity=rows("SELECT a.id,a.project_id,(COALESCE(us.name,'')||' '||a.action) AS title,substr(a.detail,1,180) AS snippet,a.space,'activity' AS type,a.created_at FROM activities a LEFT JOIN users us ON us.id=a.user_id LEFT JOIN projects p ON p.id=a.project_id WHERE (p.id IS NULL OR p.deleted_at IS NULL) AND (a.action LIKE ? ESCAPE '\\' OR a.detail LIKE ? ESCAPE '\\') ORDER BY a.created_at DESC LIMIT 300");
  respond(res,200,{query,space,project:only,results:found});return;
 }
 if(path==='/api/integrations/outbox'&&req.method==='GET'){
  // No secret URLs or authentication tokens in results; only bounded diagnostic metadata.
  respond(res,200,{items:all('SELECT id,status,attempts,last_error,created_at,sent_at FROM webhook_outbox ORDER BY created_at DESC LIMIT 100')});return;
 }
 if(path==='/api/integrations/retry'&&req.method==='POST'){
  // Manual retry is explicit; failed (permanent) errors are not silently retried.
  const outcome=await flushWebhookQueue();respond(res,200,outcome);return;
 }
 if(path==='/api/integrations/history'&&req.method==='GET'){
  const items=all('SELECT id,kind,status,event,detail,created_at FROM integration_runs ORDER BY created_at DESC LIMIT 100');
  respond(res,200,{items});return;
 }
 if(path==='/api/daily-brief/run'&&req.method==='POST'){respond(res,200,await processDailyBrief(true));return;}
 if(path==='/api/reminders/run'&&req.method==='POST'){
  const result=processReminders();const external=await flushExternalNotices();const push=await flushPushNotices();respond(res,200,{ok:true,...result,external,push});return;
 }
 // Push notifications require explicit subscription by each browser and no project data leaves DUPLA.
 if(path==='/api/push/status'&&req.method==='GET'){
  const prefs=get('SELECT * FROM notification_preferences WHERE user_id=?',u.id);
  respond(res,200,{available:pushConfigured(env),public_key:pushConfigured(env)?env.PUSH_VAPID_PUBLIC_KEY:null,enabled:!!prefs?.push_enabled,subscriptions:get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?',u.id).n});return;
 }
 if(path==='/api/push/subscribe'&&req.method==='POST'){
  if(!pushConfigured(env))fail(503,'Push requiere una clave VAPID configurada en Cloudflare');
  const b=await readBody(req);if(!isAllowedPushEndpoint(b.endpoint))fail(400,'Endpoint push no autorizado');
  const old=get('SELECT id FROM push_subscriptions WHERE user_id=? AND endpoint=?',u.id,b.endpoint);
  if(!old){
   if(get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?',u.id).n>=8)fail(429,'Máximo ocho dispositivos con avisos');
   // A physical browser may change DUPLA accounts. Its subscription must NEVER
   // remain on the old account, or private notices may reach the new user.
   db.transactionSync(()=>{
    run('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id!=?',b.endpoint,u.id);
    run('INSERT INTO push_subscriptions(id,user_id,endpoint,created_at) VALUES(?,?,?,?)',uid(),u.id,b.endpoint,now());
    run('UPDATE notification_preferences SET push_enabled=0 WHERE user_id!=? AND NOT EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id=notification_preferences.user_id)',u.id);
   });
  }
  // Claves públicas del dispositivo para cifrar el contenido (RFC 8291). Sin ellas, aviso genérico.
  if(validPushKeys(b.keys))run('UPDATE push_subscriptions SET p256dh=?,auth=? WHERE user_id=? AND endpoint=?',b.keys.p256dh,b.keys.auth,u.id,b.endpoint);
  run('INSERT INTO notification_preferences(user_id,push_enabled) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET push_enabled=1',u.id);
  respond(res,200,{ok:true});return;
 }
 // A real device-to-provider push diagnostic: an authenticated user can only target
 // a subscription registered under their own account. Generic payload only.
 if(path==='/api/push/test'&&req.method==='POST'){
  if(!pushConfigured(env))fail(503,'Configura las claves VAPID antes de probar las notificaciones');
  const b=await readBody(req);
  if(!isAllowedPushEndpoint(b.endpoint))fail(400,'Suscripción push inválida');
  const subscription=get('SELECT id,endpoint FROM push_subscriptions WHERE user_id=? AND endpoint=?',u.id,b.endpoint);
  if(!subscription)fail(403,'Este navegador no está suscrito con tu cuenta');
  const rateKey='dupla-push-test:'+u.id;
  const last=Number(await storage.get(rateKey)||0);
  if(Date.now()-last<60000)fail(429,'Espera un minuto antes de repetir la prueba push');
  await storage.put(rateKey,Date.now());
  let response;
  try{response=await sendPush(env,subscription.endpoint);}
  catch(ex){fail(502,'No se pudo contactar con el servicio Push: '+String(ex.message||ex).slice(0,120));}
  if(!response.ok)fail(502,'El servicio Push ha rechazado la prueba (HTTP '+response.status+')');
  respond(res,200,{ok:true,accepted:true,message:'El proveedor Push aceptó el aviso. Confirma que aparece en este dispositivo.'});return;
 }
 if(path==='/api/push/unsubscribe'&&req.method==='POST'){
  const b=await readBody(req);
  if(b.endpoint){run('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?',u.id,String(b.endpoint).slice(0,1600));}
  else run('DELETE FROM push_subscriptions WHERE user_id=?',u.id);
  if(!get('SELECT 1 AS ok FROM push_subscriptions WHERE user_id=?',u.id))run('UPDATE notification_preferences SET push_enabled=0 WHERE user_id=?',u.id);
  respond(res,200,{ok:true});return;
 }
 // Explicit verification of Resend delivery to the authenticated user's own address.
 // Never accepts an arbitrary recipient, so it cannot be used to relay spam.
 if(path==='/api/notifications/email/test'&&req.method==='POST'){
  if(!env.RESEND_API_KEY||!env.NOTIFY_FROM_EMAIL)fail(503,'Configura Resend y el remitente verificado en Cloudflare');
  const prefs=get('SELECT email_enabled FROM notification_preferences WHERE user_id=?',u.id);
  if(!prefs?.email_enabled)fail(409,'Activa primero los avisos de correo en Ajustes');
  const rateKey='dupla-email-test:'+u.id;
  const last=Number(await storage.get(rateKey)||0);
  if(Date.now()-last<60000)fail(429,'Espera un minuto antes de repetir la prueba de correo');
  await storage.put(rateKey,Date.now());
  let response;
  try{response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.RESEND_API_KEY,'Idempotency-Key':'dupla-test-'+u.id+'-'+Math.floor(Date.now()/60000)},body:JSON.stringify({from:env.NOTIFY_FROM_EMAIL,to:[u.email],subject:'DUPLA · Prueba de notificaciones',text:'Esta es una prueba de notificaciones de DUPLA. No contiene datos de vuestros proyectos.'}),signal:AbortSignal.timeout(12000)});}
  catch(ex){fail(502,'No se pudo contactar con el servicio de correo: '+String(ex.message||ex).slice(0,120));}
  if(!response.ok)fail(502,'El proveedor de correo ha rechazado la prueba (HTTP '+response.status+')');
  respond(res,200,{ok:true,accepted:true,message:'El proveedor aceptó el correo de prueba. Comprueba tu bandeja de entrada.'});return;
 }
 if(path==='/api/notifications/preferences'&&req.method==='GET'){
  const preferences=get('SELECT * FROM notification_preferences WHERE user_id=?',u.id);
  respond(res,200,{email_enabled:Boolean(preferences?.email_enabled),work_enabled:Boolean(preferences?.work_enabled??1),couple_enabled:Boolean(preferences?.couple_enabled??0),provider_configured:Boolean(env.RESEND_API_KEY&&env.NOTIFY_FROM_EMAIL)});return;
 }
 if(path==='/api/notifications/preferences'&&req.method==='POST'){
  const b=await readBody(req);
  if(['email_enabled','work_enabled','couple_enabled'].some(k=>typeof b[k]!=='boolean'))fail(400,'Las preferencias deben ser valores booleanos explícitos');
  if(b.email_enabled&&!(env.RESEND_API_KEY&&env.NOTIFY_FROM_EMAIL))fail(503,'El servicio de correo todavía no está configurado en Cloudflare');
  run('INSERT INTO notification_preferences(user_id,email_enabled,work_enabled,couple_enabled) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET email_enabled=excluded.email_enabled,work_enabled=excluded.work_enabled,couple_enabled=excluded.couple_enabled',u.id,+b.email_enabled,+b.work_enabled,+b.couple_enabled);
  if(!b.email_enabled)run("UPDATE notification_delivery SET status='cancelled' WHERE user_id=? AND status='pending'",u.id);
  respond(res,200,{ok:true});return;
 }
 if(path==='/api/notifications/delivery'&&req.method==='GET'){
  respond(res,200,{items:all('SELECT status,attempts,last_error,created_at FROM notification_delivery WHERE user_id=? ORDER BY created_at DESC LIMIT 30',u.id)});return;
 }
 if(path==='/api/notifications'&&req.method==='GET'){
  // R0219-R0223/R0242: tipo, importante (manual o recordatorio) y estado real de entrega push por dispositivo.
  const items=all(`SELECT n.*,users.name AS actor_name,p.title AS project_title,COALESCE(f.important,0) AS flagged,(SELECT group_concat(d.status) FROM push_delivery d WHERE d.notification_id=n.id) AS push_states FROM notifications n LEFT JOIN users ON users.id=n.actor_id LEFT JOIN projects p ON p.id=n.project_id LEFT JOIN notification_flags f ON f.notification_id=n.id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 120`,u.id).map(({flagged,push_states,...n})=>{const st=String(push_states||'').split(',').filter(Boolean);return {...n,type:noticeType(n.action),reminder:/recordatorio/i.test(n.action),important:Boolean(flagged)||/recordatorio/i.test(n.action),push:!st.length?'none':st.includes('sent')?'sent':st.includes('pending')?'pending':st.includes('cancelled')?'cancelled':'failed'};});
  respond(res,200,{unread:get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',u.id).n,items});return;
 }
 if(path==='/api/notifications/important'&&req.method==='POST'){
  const b=await readBody(req);const n=get('SELECT id FROM notifications WHERE id=? AND user_id=?',String(b.id||''),u.id);if(!n)fail(404,'Aviso no encontrado');
  run('INSERT INTO notification_flags(notification_id,important) VALUES(?,?) ON CONFLICT(notification_id) DO UPDATE SET important=excluded.important',n.id,b.important?1:0);respond(res,200,{ok:true});return;
 }
 if(path==='/api/notifications/read'&&req.method==='POST'){
  const b=await readBody(req);if(b.id){run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',now(),b.id,u.id);}else run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),u.id);
  respond(res,200,{ok:true});return;
 }
 if(path==='/api/archives'&&req.method==='GET'){
  respond(res,200,{projects:all('SELECT id,space,title,updated_at FROM projects WHERE deleted_at IS NULL AND archived=1 ORDER BY updated_at DESC')});return;
 }
 const arch=path.match(/^\/api\/archives\/([a-f0-9-]{36})\/restore$/);
 if(arch&&req.method==='POST'){
  const p=project(arch[1]);if(!p.archived)fail(409,'El proyecto no está archivado');
  run('UPDATE projects SET archived=0,revision=revision+1,updated_at=? WHERE id=?',now(),p.id);
  logChange(p,u,'desarchivó un proyecto',p.title);respond(res,200,{project:project(p.id)});return;
 }
 if(path==='/api/trash'&&req.method==='GET'){
  respond(res,200,{projects:all('SELECT id,space,title,deleted_at FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')});return;
 }
 const trash=path.match(/^\/api\/trash\/([a-f0-9-]{36})\/(restore|purge)$/);
 if(trash&&req.method==='POST'){
  const p=get('SELECT * FROM projects WHERE id=? AND deleted_at IS NOT NULL',trash[1]);if(!p)fail(404,'Proyecto no encontrado en papelera');
  if(trash[2]==='restore'){run('UPDATE projects SET deleted_at=NULL,updated_at=? WHERE id=?',now(),p.id);logChange(p,u,'restauró el proyecto',p.title);respond(res,200,{project:project(p.id)});return;}
  const remnants=all('SELECT stored_name FROM assets WHERE project_id=?',p.id);run('DELETE FROM project_create_requests WHERE project_id=?',p.id);run('DELETE FROM projects WHERE id=?',p.id);for(const f of remnants)try{removeFile(f.stored_name);}catch{}
  notifyPartner(u.id,null,p.space,'eliminó definitivamente un proyecto',p.title);notify(p.space,p.id,u.id);respond(res,200,{ok:true});return;
 }
 const versions=path.match(/^\/api\/sections\/([a-f0-9-]{36})\/versions(?:\/([a-f0-9-]{36})\/restore)?$/);
 if(versions){const section=get('SELECT * FROM sections WHERE id=?',versions[1]);if(!section)fail(404,'Nota no encontrada');const p=project(section.project_id);
  if(req.method==='GET'&&!versions[2]){respond(res,200,{versions:all('SELECT v.*,u.name AS author FROM section_versions v LEFT JOIN users u ON u.id=v.edited_by WHERE v.section_id=? ORDER BY v.revision DESC LIMIT 40',section.id)});return;}
  if(req.method==='POST'&&versions[2]){
   const b=await readBody(req);if(b.revision!==section.revision)fail(409,'La nota cambió: recarga antes de restaurar');
   const old=get('SELECT * FROM section_versions WHERE id=? AND section_id=?',versions[2],section.id);if(!old)fail(404,'Versión inexistente');
   db.transactionSync(()=>{
    run('INSERT INTO section_versions VALUES(?,?,?,?,?,?,?)',uid(),section.id,section.revision,section.title,section.content,u.id,now());
    run('UPDATE sections SET title=?,content=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?',old.title,old.content,u.id,now(),section.id);
    
   });
   logChange(p,u,'restauró una versión de nota',section.title);respond(res,200,{item:get('SELECT * FROM sections WHERE id=?',section.id)});return;
  }
 }
 if(path==='/api/password'&&req.method==='POST'){
  const b=await readBody(req);const row=get('SELECT password_hash FROM users WHERE id=?',u.id);
  if(!await verifyPassword(String(b.current||''),row.password_hash))fail(403,'Contraseña actual incorrecta');
  if(typeof b.next!=='string'||b.next.length<12||b.next.length>128)fail(400,'Usa una contraseña de 12 a 128 caracteres');
  run('UPDATE users SET password_hash=? WHERE id=?',await hashPassword(b.next),u.id);run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?',u.id,u.token_hash);respond(res,200,{ok:true});return;
 }
 if(path==='/api/projects'&&req.method==='POST'){
  const b=await readBody(req);const space=choice(b.space,['work','couple']);const allowed=space==='work'?['blank','website','campaign','app','automation','ai_agent','freelance']:['blank','trip','dinner','shared','weekend','celebration'];if(!allowed.includes(b.template||'blank'))fail(400,'Plantilla incompatible con el espacio');const id=uid(),t=now();
  // Validate first: a rejected template must never leave a ghost project in SQLite.
  const title=requireText(b.title,'Título',120),description=optional(b.description,2500);
  const status=choice(b.status,['idea','planning','active','done'],'idea'),color=choice(b.color,['indigo','rose','emerald','amber','sky','violet'],'indigo');
  const requestId=b.client_request_id;
  if(requestId!==undefined && (typeof requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(requestId)))fail(400,'Identificador de creación inválido');
  if(requestId){const prior=get('SELECT project_id FROM project_create_requests WHERE request_id=? AND user_id=?',requestId,u.id);if(prior){const previous=get('SELECT * FROM projects WHERE id=?',prior.project_id);if(!previous)fail(409,'Esta creación ya fue procesada pero el proyecto no está disponible');respond(res,200,{project:previous,already_created:true});return;}}
  const preset=String(b.template||'blank');
  const TEMPLATES={
   work:{blank:null,
    automation:{sections:['Objetivo y proceso actual','Disparadores y entradas','Flujos y APIs','Seguridad y recuperación','Métricas y seguimiento'],tasks:['Documentar proceso manual y responsables','Definir disparadores, datos y permisos','Implementar flujo y pruebas de error','Validar idempotencia y reintentos','Publicar con métricas y alertas'],milestones:['Proceso validado','Automatización probada','Automatización en producción']},
    ai_agent:{sections:['Objetivo, límites y casos de uso','Datos y conocimiento','Herramientas y permisos','Evaluación y calidad','Despliegue y seguimiento'],tasks:['Definir entradas, salidas y evaluación','Preparar corpus y privacidad','Implementar agente con herramientas limitadas','Probar seguridad, coste y resultados','Publicar con trazabilidad y supervisión'],milestones:['Especificación aprobada','Evaluación superada','Piloto real validado']},
    freelance:{sections:['Brief y alcance','Entregables y aprobación','Cronograma y riesgos','Presupuesto y comunicación'],tasks:['Definir entregables y criterios de aceptación','Acordar responsables y fechas','Preparar primera entrega','Revisar con el cliente','Cerrar entrega y documentación'],milestones:['Alcance aprobado','Primera entrega','Cierre aceptado']},
    website:{sections:['Objetivo y briefing','Mapa de la web','Diseño y referencias','Estrategia de lanzamiento'],tasks:['Definir alcance y requisitos','Diseñar estructura y prototipo','Desarrollar web y contenidos','Preparar campaña y medir resultados'],milestones:['Brief validado','Prototipo aprobado','Lanzamiento']},campaign:{sections:['Objetivos y audiencia','Concepto creativo','Canales y presupuesto','Métricas y aprendizajes'],tasks:['Investigar audiencia','Diseñar creatividades y mensajes','Preparar calendario de publicaciones','Lanzar campaña y analizar'],milestones:['Estrategia definida','Creatividades aprobadas','Campaña publicada']},app:{sections:['Problema que queremos resolver','Funcionalidades y UX','Diseño y arquitectura','Lanzamiento y validación'],tasks:['Investigar usuarios y necesidades','Crear wireframes y mockups','Construir primera versión','Probar con usuarios'],milestones:['Alcance acordado','Prototipo funcional','Primera versión lista']}},
   couple:{blank:null,weekend:{sections:['Inspiración y opciones','Desplazamientos','Alojamiento','Itinerario por días','Presupuesto común'],tasks:['Elegir fin de semana','Votar opciones','Comparar precios y horarios','Reservar lo necesario','Preparar lista y documentación'],milestones:['Fechas elegidas','Reservas confirmadas','Escapada lista']},celebration:{sections:['Idea y detalles','Invitados o participantes','Lugar y reserva','Regalos y presupuesto'],tasks:['Elegir fecha','Organizar sorpresa o actividad','Confirmar lugar y horario','Preparar detalles y materiales'],milestones:['Plan decidido','Reserva confirmada','Todo preparado']},trip:{sections:['Destino e inspiración','Itinerario juntos','Alojamiento y transporte','Lugares y experiencias'],tasks:['Elegir fechas y destino','Comparar transporte y estancia','Preparar itinerario','Reservar actividades'],milestones:['Destino decidido','Reservas hechas','Viaje preparado']},dinner:{sections:['Ideas y lugares','Ambiente y detalles','Reservas y logística'],tasks:['Elegir el lugar','Decidir fecha y hora','Reservar','Preparar los detalles'],milestones:['Plan decidido','Reserva confirmada']},shared:{sections:['Qué queremos hacer','Ideas e inspiración','Cómo lo organizamos','Próximos pasos'],tasks:['Definir la idea juntos','Preparar materiales y opciones','Elegir siguiente paso'],milestones:['Idea clara','Plan en marcha']}}
  };
  if(!(preset in TEMPLATES[space]))fail(400,'Plantilla no válida para ese espacio');
  const structure=TEMPLATES[space][preset];
  db.transactionSync(()=>{
   run('INSERT INTO projects(id,space,title,description,status,color,created_by,created_at,updated_at,kind,destination,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,space,title,description,status,color,u.id,t,t,b.kind===undefined?preset:choice(b.kind,[...Object.keys(TEMPLATES[space])]),optional(b.destination,120).trim(),validDate(b.start_date),validDate(b.end_date));
   if(requestId)run('INSERT INTO project_create_requests(request_id,user_id,project_id,created_at) VALUES(?,?,?,?)',requestId,u.id,id,t);
   if(structure){
    let ord=1;for(const title of structure.sections)run('INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),id,title,'',ord++,1,u.id,u.id,t,t);
    for(const title of structure.tasks)run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),id,title,'','todo',null,'normal',null,u.id,t,t);
    for(const title of structure.milestones)run('INSERT INTO milestones(id,project_id,title,description,state,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,title,'','planned',null,u.id,t,t);
    
   }
  });
  const p=project(id);logChange(p,u,'creó el proyecto',p.title);
  // La portada del destino se descarga en segundo plano; al terminar se avisa a los dos navegadores.
  if(p.destination){const job=v6.autoCover(p);if(ctx.waitUntil)ctx.waitUntil(job);else await job;}
  respond(res,201,{project:p});return;
 }
 const pm=idMatch(path,/^\/api\/projects\/([a-f0-9-]{36})$/);
 if(pm){const p=project(pm[1]);if(req.method==='GET'){respond(res,200,{project:detail(p.id)});return;}
  if(req.method==='PATCH'){
   const b=await readBody(req);requireRevision(b,p);const title=b.title===undefined?p.title:requireText(b.title,'Título',120);const description=b.description===undefined?p.description:optional(b.description,2500);const status=choice(b.status,['idea','planning','active','done'],p.status);const color=choice(b.color,['indigo','rose','emerald','amber','sky','violet'],p.color);const archived=b.archived===undefined?p.archived:(b.archived?1:0);
   const changed=run('UPDATE projects SET title=?,description=?,status=?,color=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',title,description,status,color,archived,now(),p.id,p.revision);if(!changed.changes)fail(409,'Proyecto modificado por otra persona');logChange(p,u,'actualizó el proyecto',title);respond(res,200,{project:detail(p.id)});return;
  }
  if(req.method==='DELETE'){run('UPDATE projects SET deleted_at=? WHERE id=?',now(),p.id);logChange(p,u,'movió un proyecto a la papelera',p.title);respond(res,200,{ok:true});return;}
 }
 // DUPLA_INTEGRAL_47: lote manual de tareas de ambos espacios, atomico y sin servicios externos.
 const manualBulk=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/tasks\/manual-bulk$/);
 if(manualBulk&&req.method==='POST'){
  const p=project(manualBulk[1]);const b=await readBody(req);
  if(!Array.isArray(b.tasks)||b.tasks.length<1||b.tasks.length>25)fail(400,'Introduce entre 1 y 25 tareas');
  const titles=b.tasks.map(v=>requireText(v,'Tarea',220));
  if(new Set(titles.map(t=>t.toLocaleLowerCase('es'))).size!==titles.length)fail(400,'Las tareas del lote deben ser distintas');
  const priority=choice(b.priority,['low','normal','high'],'normal');
  const due=validDate(b.due_date);
  const assigned=b.assigned_to||null;
  if(assigned&&!get('SELECT id FROM users WHERE id=?',assigned))fail(400,'Responsable desconocido');
  const t=now();db.transactionSync(()=>{
   for(const title of titles)run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),p.id,title,'','todo',assigned,priority,due,u.id,t,t);
  });
  logChange(p,u,'creó un lote de tareas',titles.length+' tareas');respond(res,201,{ok:true,created:titles.length});return;
 }
 const taskBulk=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/tasks\/bulk$/);
 if(taskBulk&&req.method==='POST'){
  const p=project(taskBulk[1]);if(p.space!=='work')fail(403,'La importación IA solo está permitida en Trabajo');
  const b=await readBody(req);
  if(!Array.isArray(b.tasks)||b.tasks.length<1||b.tasks.length>12)fail(400,'Introduce de 1 a 12 tareas');
  const tasks=b.tasks.map(item=>({title:requireText(item?.title,'Título de tarea',220),description:optional(item?.description,1500),priority:choice(item?.priority,['normal','low','high'],'normal')}));
  const t=now();db.transactionSync(()=>{
   for(const task of tasks)run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),p.id,task.title,task.description,'todo',null,task.priority,null,u.id,t,t);
  });
  logChange(p,u,'importó tareas de IA',tasks.length+' tareas');respond(res,201,{ok:true,created:tasks.length});return;
 }
 const psub=idMatch(path,/^\/api\/projects\/([a-f0-9-]{36})\/(tasks|sections|events|comments|links|assets|ai|milestones|expenses|decisions)$/);
 if(psub&&req.method==='POST'){
  const p=project(psub[1]),kind=psub[2],b=await readBody(req),id=uid(),t=now();
  if(kind==='decisions'){
   const choices=b.choices;if(!Array.isArray(choices)||choices.length<2||choices.length>7||choices.some(c=>typeof c!=='string'||!c.trim()||c.trim().length>120))fail(400,'Introduce entre 2 y 7 opciones válidas');
   const names=choices.map(c=>c.trim());if(new Set(names).size!==names.length)fail(400,'Las opciones deben ser distintas');
   run('INSERT INTO decisions VALUES(?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Pregunta',180),optional(b.description,2000),JSON.stringify(names),0,u.id,t);
   logChange(p,u,'abrió una decisión',b.title);respond(res,201,{item:get('SELECT * FROM decisions WHERE id=?',id)});return;
  }
  if(kind==='milestones'){
   run('INSERT INTO milestones(id,project_id,title,description,state,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Hito',180),optional(b.description,3000),choice(b.state,['planned','doing','done'],'planned'),validDate(b.due_date),u.id,t,t);
   logChange(p,u,'añadió un hito',b.title);respond(res,201,{item:get('SELECT * FROM milestones WHERE id=?',id)});return;
  }
  if(kind==='expenses'){
   run('INSERT INTO expenses(id,project_id,title,category,estimated,actual,booked_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Concepto',160),choice(b.category,['general','design','development','marketing','flights','stay','transport','food','outings','activities','shopping','extras','other'],'general'),money(b.estimated),money(b.actual),validDate(b.booked_at),u.id,t,t);
   logChange(p,u,'añadió un gasto',b.title);respond(res,201,{item:get('SELECT * FROM expenses WHERE id=?',id)});return;
  }
  if(kind==='tasks'){
   const assigned=b.assigned_to||null;if(assigned&&!get('SELECT id FROM users WHERE id=?',assigned))fail(400,'Usuario desconocido');
   const initialState=choice(b.state,['todo','doing','done'],'todo'), blockedBy=validateBlocker(p.id,id,b.blocked_by||null);
   if(initialState==='done')requireUnblocked(blockedBy);
   run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at,recurrence,blocked_by,series_id,recurrence_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Tarea',220),optional(b.description,5000),initialState,assigned,choice(b.priority,['low','normal','high'],'normal'),validDate(b.due_date),u.id,t,t,recurrence(b.recurrence),blockedBy,id,b.due_date?Number(String(b.due_date).slice(8,10)):new Date().getUTCDate());
   logChange(p,u,'añadió una tarea',b.title);respond(res,201,{item:get('SELECT * FROM tasks WHERE id=?',id)});return;
  }
  if(kind==='sections'){
   const ord=Number(get('SELECT COALESCE(MAX(sort_order),0) AS n FROM sections WHERE project_id=?',p.id).n)+1;
   run('INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Sección',150),optional(b.content,40000),ord,1,u.id,u.id,t,t);
   logChange(p,u,'añadió una sección',b.title);respond(res,201,{item:get('SELECT * FROM sections WHERE id=?',id)});return;
  }
  if(kind==='events'){
   run('INSERT INTO events(id,project_id,title,event_date,location,notes,created_by,created_at,event_time,booking_status,booking_reference) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Plan o fecha',160),validDate(requireText(b.event_date,'Fecha')),optional(b.location,220),optional(b.notes,5000),u.id,t,validTime(b.event_time),booking(b.booking_status),optional(b.booking_reference,120));
   logChange(p,u,'añadió un plan',b.title);respond(res,201,{item:get('SELECT * FROM events WHERE id=?',id)});return;
  }
  if(kind==='comments'){
   run('INSERT INTO comments VALUES(?,?,?,?,?)',id,p.id,u.id,requireText(b.content,'Comentario',3000),t);
   logChange(p,u,'comentó el proyecto',String(b.content).slice(0,70));respond(res,201,{ok:true});return;
  }
  if(kind==='links'){
   const address=requireText(b.url,'URL',1500);let parsed;try{parsed=new URL(address);}catch{fail(400,'URL inválida');}if(!['https:','http:'].includes(parsed.protocol))fail(400,'Solo HTTP/HTTPS');
   run('INSERT INTO links VALUES(?,?,?,?,?,?)',id,p.id,requireText(b.label,'Nombre',120),parsed.toString(),u.id,t);
   logChange(p,u,'añadió un enlace',b.label);respond(res,201,{ok:true});return;
  }
  if(kind==='assets'){
   const name=requireText(b.name,'Nombre del archivo',180),mime=choice(b.mime,['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/markdown','application/octet-stream'],'application/octet-stream');
   // MIME provided by a browser is untrusted: verify binary signatures before serving inline.
   const signatures={'image/png':(f)=>f.length>=8&&f.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':(f)=>f.length>=3&&f[0]===255&&f[1]===216&&f[2]===255,'image/gif':(f)=>f.length>=6&&['GIF87a','GIF89a'].includes(f.subarray(0,6).toString('ascii')),'image/webp':(f)=>f.length>=12&&f.toString('ascii',0,4)==='RIFF'&&f.toString('ascii',8,12)==='WEBP','application/pdf':(f)=>f.length>=5&&f.toString('ascii',0,5)==='%PDF-'};
   if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64))fail(400,'Contenido base64 inválido');
   const file=Buffer.from(b.base64,'base64');if(!file.length||file.length>6*1024*1024)fail(413,'Máximo 6 MB por archivo');
   if(signatures[mime]&&!signatures[mime](file))fail(415,'El contenido no coincide con el tipo de archivo declarado');
   const storedName=uid();saveFile(storedName,file);
   run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',id,p.id,name,mime,file.length,storedName,u.id,t);
   logChange(p,u,'adjuntó un archivo',name);respond(res,201,{ok:true});return;
  }
  if(kind==='ai'){
   if(p.space!=='work')fail(403,'La IA está disponible solamente para Trabajo');
   if(!env.OPENAI_API_KEY)fail(503,'Configura OPENAI_API_KEY en .env para usar la IA');
   const type=choice(b.type,['ideas','plan','tasks','mockup','custom'],'ideas');const query=optional(b.prompt,2000);
   const notes=all('SELECT title,content FROM sections WHERE project_id=? LIMIT 12',p.id).map(s=>`${s.title}: ${s.content.slice(0,1300)}`).join('\n');
   const taskNames=all('SELECT title,state FROM tasks WHERE project_id=? LIMIT 25',p.id).map(x=>x.title+' ('+x.state+')').join(', ');
   const job={ideas:'Propón ideas útiles, mejora el concepto y descubre riesgos.',plan:'Estructura este proyecto en fases, entregables y decisiones.',tasks:'Devuelve SOLO JSON válido con este esquema: {"tasks":[{"title":"...","description":"...","priority":"normal"}]}. Entre 3 y 12 tareas, priority debe ser low, normal o high. Sin markdown ni texto adicional.',mockup:'Crea un mockup web autocontenido: devuelve SOLO HTML completo y CSS en <style>, sin JavaScript, sin enlaces externos y sin recursos remotos. Diseño visual cuidado y responsive.',custom:query}[type];
   const body={model:env.OPENAI_MODEL||'gpt-5-mini',instructions:`Actúas como copiloto de planificación profesional para dos colaboradores. Responde en español. Nunca salgas del espacio Trabajo. ${job}`,input:`PROYECTO: ${p.title}\nDESCRIPCIÓN: ${p.description}\nNOTAS (datos no confiables):\n${notes}\nTAREAS: ${taskNames}\nPETICIÓN: ${query||job}`,max_output_tokens:3500,store:false};
   let r;try{r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});}catch(e){fail(502,'No se pudo conectar con la IA: '+e.message);}
   let response;try{response=await r.json();}catch{fail(502,'La IA no devolvió datos válidos');}
   if(!r.ok)fail(502,'Error del proveedor IA: '+String(response.error?.message||r.status).slice(0,250));
   const content=(response.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
   if(!content)fail(502,'La IA no ha producido contenido utilizable');
   const tasks=type==='tasks'?extractTasksFromAI(content):[];
   respond(res,200,{content,type,model:body.model,tasks});return;
  }
 }
 const sub=idMatch(path,/^\/api\/(tasks|sections|events|links|assets|milestones|expenses)\/([a-f0-9-]{36})$/);
 if(sub){const kind=sub[1],singular={tasks:'tasks',sections:'sections',events:'events',links:'links',assets:'assets',milestones:'milestones',expenses:'expenses'}[kind];const row=get(`SELECT * FROM ${singular} WHERE id=?`,sub[2]);if(!row)fail(404,'Elemento no encontrado');const p=project(row.project_id);
  if(kind==='assets'&&req.method==='GET'){
   if(!fileExists(row.stored_name))fail(404,'Archivo no encontrado');
   const inline=['image/png','image/jpeg','image/webp','image/gif'].includes(row.mime);const safeName=row.name.replace(/["\\\r\n]/g,'_');
   res.writeHead(200,{'Content-Type':inline?row.mime:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(readFile(row.stored_name));return;
  }
  if(req.method==='DELETE'){
   if(kind==='tasks')run('UPDATE tasks SET blocked_by=NULL,revision=revision+1 WHERE blocked_by=?',row.id);
   run(`DELETE FROM ${singular} WHERE id=?`,row.id);
   if(kind==='assets'){try{removeFile(row.stored_name);}catch{}}
   logChange(p,u,'eliminó '+({tasks:'una tarea',sections:'una sección',events:'un plan',links:'un enlace',assets:'un archivo',milestones:'un hito',expenses:'un gasto'}[kind]),row.title||row.name||row.label||'');respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='milestones'){
   const b=await readBody(req);requireRevision(b,row);const changed=run('UPDATE milestones SET title=?,description=?,state=?,due_date=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Hito',180),b.description===undefined?row.description:optional(b.description,3000),choice(b.state,['planned','doing','done'],row.state),b.due_date===undefined?row.due_date:validDate(b.due_date),now(),row.id,row.revision);if(!changed.changes)fail(409,'Hito modificado por otra persona');
   logChange(p,u,'editó un hito',b.title||row.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='expenses'){
   const b=await readBody(req);requireRevision(b,row);const changed=run('UPDATE expenses SET booked_at=?,title=?,category=?,estimated=?,actual=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.booked_at===undefined?row.booked_at:validDate(b.booked_at),b.title===undefined?row.title:requireText(b.title,'Concepto',160),choice(b.category,['general','design','development','marketing','flights','stay','transport','food','outings','activities','shopping','extras','other'],row.category),b.estimated===undefined?row.estimated:money(b.estimated),b.actual===undefined?row.actual:money(b.actual),now(),row.id,row.revision);if(!changed.changes)fail(409,'Gasto modificado por otra persona');
   logChange(p,u,'editó un gasto',b.title||row.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='tasks'){
   const b=await readBody(req);requireRevision(b,row);const assigned=b.assigned_to===undefined?row.assigned_to:(b.assigned_to||null);if(assigned&&!get('SELECT id FROM users WHERE id=?',assigned))fail(400,'Usuario desconocido');
   const state=choice(b.state,['todo','doing','done'],row.state),rule=recurrence(b.recurrence,row.recurrence),blockedBy=b.blocked_by===undefined?row.blocked_by:validateBlocker(p.id,row.id,b.blocked_by||null);
   if(state==='done')requireUnblocked(blockedBy);
   let createdNext=null;
   db.transactionSync(()=>{
    const changed=run('UPDATE tasks SET title=?,description=?,state=?,assigned_to=?,priority=?,due_date=?,recurrence=?,blocked_by=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Tarea',220),b.description===undefined?row.description:optional(b.description,5000),state,assigned,choice(b.priority,['low','normal','high'],row.priority),b.due_date===undefined?row.due_date:validDate(b.due_date),rule,blockedBy,now(),row.id,row.revision);
    if(!changed.changes)fail(409,'Tarea modificada por otra persona');
    if(row.state!=='done'&&state==='done'&&rule!=='none'){
      const id=uid(),date=nextOccurrence(b.due_date===undefined?row.due_date:validDate(b.due_date),rule,b.due_date&&b.due_date!==row.due_date?Number(String(b.due_date).slice(8,10)):row.recurrence_day);
      run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at,recurrence,blocked_by,series_id,recurrence_day) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,p.id,b.title===undefined?row.title:requireText(b.title,'Tarea',220),b.description===undefined?row.description:optional(b.description,5000),'todo',assigned,choice(b.priority,['low','normal','high'],row.priority),date,u.id,now(),now(),rule,null,row.series_id||row.id,b.due_date&&b.due_date!==row.due_date?Number(String(b.due_date).slice(8,10)):row.recurrence_day);
      createdNext=id;
    }
   });
   logChange(p,u,createdNext?'completó tarea periódica y creó la siguiente':'editó una tarea',b.title||row.title);respond(res,200,{item:get('SELECT * FROM tasks WHERE id=?',row.id),next_task_id:createdNext});return;
  }
  if(req.method==='PATCH'&&kind==='sections'){
   const b=await readBody(req);if(b.revision!==row.revision){respond(res,409,{error:'Esta nota fue modificada por la otra persona. Copia tus cambios y recarga antes de guardar.',latest:row});return;}
   db.transactionSync(()=>{
    run('INSERT INTO section_versions VALUES(?,?,?,?,?,?,?)',uid(),row.id,row.revision,row.title,row.content,u.id,now());
    const result=run('UPDATE sections SET title=?,content=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Sección',150),b.content===undefined?row.content:optional(b.content,40000),u.id,now(),row.id,row.revision);
    if(!result.changes)fail(409,'La nota fue modificada por otra persona');
   });
   logChange(p,u,'editó una nota',b.title||row.title);respond(res,200,{item:get('SELECT * FROM sections WHERE id=?',row.id)});return;
  }
  if(req.method==='PATCH'&&kind==='events'){
   const b=await readBody(req);run('UPDATE events SET title=?,event_date=?,location=?,notes=?,event_time=?,booking_status=?,booking_reference=? WHERE id=?',b.title===undefined?row.title:requireText(b.title,'Plan',160),b.event_date===undefined?row.event_date:validDate(requireText(b.event_date,'Fecha')),b.location===undefined?row.location:optional(b.location,220),b.notes===undefined?row.notes:optional(b.notes,5000),b.event_time===undefined?row.event_time:validTime(b.event_time),booking(b.booking_status,row.booking_status),b.booking_reference===undefined?row.booking_reference:optional(b.booking_reference,120),row.id);logChange(p,u,'actualizó un plan',b.title||row.title);respond(res,200,{ok:true});return;
  }
 }
 const dm=path.match(/^\/api\/decisions\/([a-f0-9-]{36})(?:\/(vote|close))?$/);
 if(dm){const d=get('SELECT * FROM decisions WHERE id=?',dm[1]);if(!d)fail(404,'Decisión no encontrada');const p=project(d.project_id);
  if(req.method==='POST'&&dm[2]==='vote'){
   if(d.closed)fail(409,'La votación ya está cerrada');const b=await readBody(req);const choices=JSON.parse(d.choices_json);if(!Number.isInteger(b.choice_index)||b.choice_index<0||b.choice_index>=choices.length)fail(400,'Opción no válida');
   run('INSERT INTO decision_votes VALUES(?,?,?,?) ON CONFLICT(decision_id,user_id) DO UPDATE SET choice_index=excluded.choice_index,updated_at=excluded.updated_at',d.id,u.id,b.choice_index,now());
   logChange(p,u,'votó en una decisión',d.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='POST'&&dm[2]==='close'){
   const b=await readBody(req);run('UPDATE decisions SET closed=? WHERE id=?',b.closed?1:0,d.id);logChange(p,u,b.closed?'cerró una votación':'reabrió una votación',d.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='DELETE'&&!dm[2]){run('DELETE FROM decisions WHERE id=?',d.id);logChange(p,u,'eliminó una votación',d.title);respond(res,200,{ok:true});return;}
 }
 const taskList=path.match(/^\/api\/tasks\/([a-f0-9-]{36})\/checklist$/);
 if(taskList && req.method==='POST'){
  const t=get('SELECT * FROM tasks WHERE id=?',taskList[1]);if(!t)fail(404,'Tarea no encontrada');const p=project(t.project_id),b=await readBody(req),id=uid();
  run('INSERT INTO checklist_items VALUES(?,?,?,?,?,?)',id,t.id,requireText(b.title,'Subtarea',180),0,u.id,now());
  logChange(p,u,'añadió un paso a una tarea',b.title);respond(res,201,{item:get('SELECT * FROM checklist_items WHERE id=?',id)});return;
 }
 const checkMatch=path.match(/^\/api\/checklist\/([a-f0-9-]{36})$/);
 if(checkMatch){
  const c=get('SELECT * FROM checklist_items WHERE id=?',checkMatch[1]);if(!c)fail(404,'Paso no encontrado');const t=get('SELECT * FROM tasks WHERE id=?',c.task_id),p=project(t.project_id);
  if(req.method==='PATCH'){
   const b=await readBody(req);run('UPDATE checklist_items SET title=?,done=? WHERE id=?',b.title===undefined?c.title:requireText(b.title,'Paso',180),b.done===undefined?c.done:(b.done?1:0),c.id);
   logChange(p,u,'actualizó un paso',c.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='DELETE'){
   run('DELETE FROM checklist_items WHERE id=?',c.id);logChange(p,u,'eliminó un paso',c.title);respond(res,200,{ok:true});return;
  }
 }
 fail(404,'Ruta no encontrada');
}

return {api,userFromReq,isSessionActive,processReminders,processDailyBrief,processAgentAlerts,processGuardianReview,processAutomationRules,processScheduledBackup,flushExternalNotices,flushPushNotices,flushWebhookQueue};
}
