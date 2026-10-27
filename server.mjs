import http from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, all, get, run, now, uid, touch, activity, verifyPassword, hashPassword, ROOT, DATA } from './db.mjs';

const envPath=join(ROOT,'.env');
if(existsSync(envPath))for(const line of readFileSync(envPath,'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2');
}
const PORT=Number(process.env.PORT)||3077;
const HOST=process.env.HOST||(process.env.RAILWAY_ENVIRONMENT?'0.0.0.0':'127.0.0.1');
const SECURE=process.env.COOKIE_SECURE==='true'||(Boolean(process.env.RAILWAY_ENVIRONMENT)&&process.env.COOKIE_SECURE===undefined);
const clients=new Set();
const uploads=join(DATA,'uploads');mkdirSync(uploads,{recursive:true});
const loginAttempts=new Map();
const setupAttempts=new Map();
const SETUP_TOKEN=String(process.env.SETUP_TOKEN||'');
const PUBLIC_ORIGIN=String(process.env.PUBLIC_ORIGIN||'').replace(/\/$/,'');
if(PUBLIC_ORIGIN && (!/^https:\/\/[^\s/?#]+$/.test(PUBLIC_ORIGIN)))throw Error('PUBLIC_ORIGIN debe ser un origen HTTPS, sin ruta final.');
if(SETUP_TOKEN && SETUP_TOKEN.length<32)throw Error('SETUP_TOKEN debe contener al menos 32 caracteres. Usa un valor aleatorio y secreto.');
if(process.env.RAILWAY_ENVIRONMENT && !SECURE)throw Error('En Railway configura COOKIE_SECURE=true para proteger las sesiones.');

function respond(res,status,data,extra={}){if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data));}
function fail(status,message){const error=new Error(message);error.status=status;throw error;}
function requireText(value,name,max=250){if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,`${name}: obligatorio, máximo ${max} caracteres`);return value.trim();}
function optional(value,max=12000){if(value===null||value===undefined)return '';if(typeof value!=='string'||value.length>max)fail(400,`Texto demasiado largo (máximo ${max})`);return value;}
function choice(value,options,defaultValue){const v=value??defaultValue;if(!options.includes(v))fail(400,'Valor no permitido');return v;}
function money(value){const n=Number(value??0);if(!Number.isFinite(n)||n<0||n>100000000)fail(400,'Introduce un importe válido');return Math.round(n*100)/100;}
function validDate(value){if(!value)return null;if(typeof value!=='string'||!/\d{4}-\d{2}-\d{2}/.test(value)||Number.isNaN(Date.parse(value)))fail(400,'Fecha no válida');return value.slice(0,10);}
function sha(token){return createHash('sha256').update(token).digest('hex');}
function userFromReq(req){const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('dos_session='));if(!cookie)return null;const token=cookie.slice(12);if(!/^[a-f0-9]{64}$/.test(token))return null;return get(`SELECT users.id,users.name,users.email,sessions.token_hash FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`,sha(token),now())||null;}
function auth(req){const user=userFromReq(req);if(!user)fail(401,'Inicia sesión para continuar');return user;}
function checkSpace(row){if(!row)fail(404,'Proyecto no encontrado');return row;}
function project(id){return checkSpace(get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',id));}
function projectList(){return all(`SELECT p.*,u.name AS creator,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id) AS tasks_total,(SELECT count(*) FROM tasks t WHERE t.project_id=p.id AND t.state='done') AS tasks_done FROM projects p LEFT JOIN users u ON p.created_by=u.id WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC`);}
function detail(id){const p=project(id);if(p.deleted_at)fail(404,'Proyecto en la papelera');return {...p,tasks:all('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at DESC',id),checklists:all('SELECT c.* FROM checklist_items c JOIN tasks t ON c.task_id=t.id WHERE t.project_id=? ORDER BY c.created_at ASC',id),milestones:all('SELECT * FROM milestones WHERE project_id=? ORDER BY due_date ASC,created_at ASC',id),decisions:all('SELECT * FROM decisions WHERE project_id=? ORDER BY created_at DESC',id).map(d=>({...d,choices:JSON.parse(d.choices_json),votes:all('SELECT v.*,u.name AS voter FROM decision_votes v JOIN users u ON u.id=v.user_id WHERE v.decision_id=?',d.id)})),expenses:all('SELECT * FROM expenses WHERE project_id=? ORDER BY created_at ASC',id),sections:all('SELECT * FROM sections WHERE project_id=? ORDER BY sort_order ASC,created_at ASC',id),events:all('SELECT * FROM events WHERE project_id=? ORDER BY event_date ASC',id),links:all('SELECT * FROM links WHERE project_id=? ORDER BY created_at DESC',id),assets:all('SELECT id,project_id,name,mime,size,created_by,created_at FROM assets WHERE project_id=? ORDER BY created_at DESC',id),comments:all('SELECT c.*,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE project_id=? ORDER BY c.created_at ASC',id),activities:all('SELECT a.*,u.name AS author FROM activities a LEFT JOIN users u ON u.id=a.user_id WHERE a.project_id=? ORDER BY a.created_at DESC LIMIT 80',id)};}
function notify(space,projectId,actor){const data=`event: change\ndata: ${JSON.stringify({space,projectId,actor,at:now()})}\n\n`;for(const c of clients){try{c.write(data);}catch{clients.delete(c);}}}
function notifyPartner(actorId,projectId,space,action,detailText=''){
 for(const user of all('SELECT id FROM users WHERE id!=?',actorId))run('INSERT INTO notifications VALUES(?,?,?,?,?,?,?,?,?)',uid(),user.id,projectId,space,actorId,action,String(detailText).slice(0,220),now(),null);
}
function logChange(p,user,action,detailText){activity(p.id,p.space,user.id,action,detailText);notifyPartner(user.id,p.id,p.space,action,detailText);notify(p.space,p.id,user.id); if(p.space==='work')sendWebhook({projectId:p.id,action,actor:user.name,at:now()});}
function logIdea(idea,user,action){activity(null,idea.space,user.id,action,idea.title);notifyPartner(user.id,idea.project_id||null,idea.space,action,idea.title);notify(idea.space,idea.project_id||null,user.id);}

function sendWebhook(payload){const url=process.env.WORK_WEBHOOK_URL;if(!url)return;try{const parsed=new URL(url);if(parsed.protocol!=='https:')return;fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(4000),redirect:'error'}).catch(e=>console.warn('Webhook:',e.message));}catch(e){console.warn('Webhook inválido:',e.message);}}
async function readBody(req){if(!['POST','PATCH','PUT'].includes(req.method))return {};if(!(req.headers['content-type']||'').startsWith('application/json'))fail(415,'Se necesita application/json');let chunks=[],bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>9*1024*1024)fail(413,'El archivo o contenido supera el límite de 8 MB');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{fail(400,'JSON inválido');}}
function requireRevision(b,row){if(!Number.isInteger(b.revision)||b.revision!==row.revision)fail(409,'Este elemento ha cambiado en la otra cuenta. Copia tu texto, recarga y vuelve a intentarlo.');}
function idMatch(path,regex){const m=path.match(regex);return m||null;}
function cookie(token,maxAge){return `dos_session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${SECURE?'; Secure':''}`;}
function csrf(req){
 if(!['POST','PATCH','DELETE'].includes(req.method))return;
 const origin=req.headers.origin;
 // Public TLS terminates at a reverse proxy. Do not trust X-Forwarded-Host headers
 // supplied by an arbitrary client; allow only an explicitly configured HTTPS origin.
 if(origin){
  let parsed;try{parsed=new URL(origin);}catch{fail(403,'Origen no permitido');}
  const isDirect=parsed.host===req.headers.host;
  const isPublic=Boolean(PUBLIC_ORIGIN)&&origin===PUBLIC_ORIGIN;
  if(!isDirect&&!isPublic)fail(403,'Origen no permitido');
 }
 if(req.headers['sec-fetch-site']==='cross-site')fail(403,'Solicitud no permitida');
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
  db.exec('BEGIN');try{
   if(get('SELECT COUNT(*) AS n FROM users').n>0)fail(409,'Las cuentas ya están creadas.');
   run('INSERT INTO users VALUES(?,?,?,?,?)',uid(),'Álvaro',emailA,hashPassword(passwordA),now());
   run('INSERT INTO users VALUES(?,?,?,?,?)',uid(),'Angie',emailB,hashPassword(passwordB),now());
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  setupAttempts.clear();respond(res,201,{ok:true,message:'Las dos cuentas se han creado. Ya podéis iniciar sesión.'});return;
 }
 if(path==='/api/login'&&req.method==='POST'){
  const b=await readBody(req);const email=String(b.email||'').toLowerCase().trim();const key=(req.socket.remoteAddress||'')+':'+email;
  const a=loginAttempts.get(key)||{n:0,since:Date.now()};if(Date.now()-a.since>15*60*1000){a.n=0;a.since=Date.now();}
  if(a.n>=10)fail(429,'Demasiados intentos. Prueba en 15 minutos.');
  const u=get('SELECT * FROM users WHERE email=?',email);
  if(!u||!verifyPassword(String(b.password||''),u.password_hash)){a.n++;loginAttempts.set(key,a);fail(401,'Correo o contraseña incorrectos');}
  loginAttempts.delete(key);const token=randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',sha(token),u.id,new Date(Date.now()+30*864e5).toISOString());
  respond(res,200,{user:{id:u.id,name:u.name,email:u.email}},{'Set-Cookie':cookie(token,30*86400)});return;
 }
 if(path==='/api/me'&&req.method==='GET'){const u=userFromReq(req);respond(res,200,{user:u?{id:u.id,name:u.name,email:u.email}:null,configured:get('SELECT COUNT(*) AS n FROM users').n===2,setupAvailable:Boolean(SETUP_TOKEN)&&get('SELECT COUNT(*) AS n FROM users').n===0});return;}
 const u=auth(req);
 if(path==='/api/logout'&&req.method==='POST'){run('DELETE FROM sessions WHERE token_hash=?',u.token_hash);respond(res,200,{ok:true},{'Set-Cookie':cookie('',0)});return;}
 if(path==='/api/stream'&&req.method==='GET'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': conectado\n\n');clients.add(res);const tick=setInterval(()=>{try{res.write(': latido\n\n');}catch{clearInterval(tick);clients.delete(res);}},25000);req.on('close',()=>{clearInterval(tick);clients.delete(res);});return;
 }
 if(path==='/api/dashboard'&&req.method==='GET'){
  const projects=projectList();const recent=all('SELECT a.*,u.name AS author,p.title AS project_title FROM activities a LEFT JOIN users u ON a.user_id=u.id LEFT JOIN projects p ON a.project_id=p.id ORDER BY a.created_at DESC LIMIT 18');
  const upcoming=all(`SELECT t.id,t.title,t.due_date AS date,t.state,p.id AS project_id,p.title AS project_title,p.space,'task' AS kind FROM tasks t JOIN projects p ON t.project_id=p.id WHERE p.deleted_at IS NULL AND t.due_date IS NOT NULL AND t.state!='done' UNION ALL SELECT e.id,e.title,e.event_date AS date,'' AS state,p.id AS project_id,p.title AS project_title,p.space,'event' AS kind FROM events e JOIN projects p ON e.project_id=p.id WHERE p.deleted_at IS NULL ORDER BY date ASC LIMIT 40`);
  respond(res,200,{projects,recent,upcoming,ideas:all('SELECT * FROM ideas ORDER BY updated_at DESC LIMIT 100'),unread:get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',u.id).n,users:all('SELECT id,name,email FROM users ORDER BY name'),integrations:{ai:!!process.env.OPENAI_API_KEY,webhook:!!process.env.WORK_WEBHOOK_URL,model:process.env.OPENAI_MODEL||'gpt-5-mini'}});return;
 }
 if(path==='/api/export'&&req.method==='GET'){
  const space=url.searchParams.get('space');if(space&&!['work','couple'].includes(space))fail(400,'Espacio inválido');const projects=projectList().filter(p=>!space||p.space===space).map(p=>detail(p.id));respond(res,200,{exported_at:now(),projects},{'Content-Disposition':'attachment; filename="dos-espacios-backup.json"'});return;
 }
 if(path==='/api/calendar.ics'&&req.method==='GET'){
  const escapeICS=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/[,;]/g,c=>'\\'+c);
  const tasks=all(`SELECT t.id,t.title,t.due_date AS date,p.title AS project FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.due_date IS NOT NULL AND p.deleted_at IS NULL`);
  const events=all(`SELECT e.id,e.title,e.event_date AS date,p.title AS project FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL`);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//DOS ESPACIOS//ES','CALSCALE:GREGORIAN'];
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
 if(path==='/api/guardian/report'&&req.method==='GET'){
  const reportPath=join(DATA,'guardian-report.json');if(!existsSync(reportPath)){respond(res,200,{available:false,reason:'No hay informe. Ejecútalo en terminal mediante npm run guardian:private y cópialo a la ruta configurada.'});return;}
  let report;try{report=JSON.parse(readFileSync(reportPath,'utf8'));}catch{fail(500,'Informe no válido');}
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
   if(idea.project_id)fail(409,'Esta idea ya se convirtió en proyecto');
   const id=uid(),t=now();db.exec('BEGIN');try{
    run('INSERT INTO projects(id,space,title,description,status,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,idea.space,idea.title,idea.body,'idea',idea.space==='work'?'indigo':'rose',u.id,t,t);
    const updated=run('UPDATE ideas SET state=?,project_id=?,revision=revision+1,updated_at=? WHERE id=? AND project_id IS NULL','converted',id,t,idea.id);if(!updated.changes)fail(409,'La idea ya está convertida');
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   logIdea(idea,u,'convirtió una idea en proyecto');respond(res,201,{project:project(id)});return;
  }
  if(req.method==='PATCH'){
   const b=await readBody(req);requireRevision(b,idea);const changed=run('UPDATE ideas SET title=?,body=?,state=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?idea.title:requireText(b.title,'Idea',160),b.body===undefined?idea.body:optional(b.body,6000),choice(b.state,['inbox','considering','converted'],idea.state),now(),idea.id,idea.revision);if(!changed.changes)fail(409,'Idea modificada por otra persona');
   logIdea(get('SELECT * FROM ideas WHERE id=?',idea.id),u,'actualizó una idea');respond(res,200,{idea:get('SELECT * FROM ideas WHERE id=?',idea.id)});return;
  }
  if(req.method==='DELETE'){run('DELETE FROM ideas WHERE id=?',idea.id);logIdea(idea,u,'eliminó una idea');respond(res,200,{ok:true});return;}
 }
 if(path==='/api/search'&&req.method==='GET'){
  const query=String(url.searchParams.get('q')||'').trim();if(query.length<2||query.length>100)fail(400,'Busca entre 2 y 100 caracteres');
  const pattern='%'+query.replace(/[\%_]/g,c=>'\\'+c)+'%';
  const rows=(sql)=>all(sql,pattern,pattern).slice(0,30);
  const found={projects:rows("SELECT id AS project_id,title,description AS snippet,space,'project' AS type FROM projects WHERE deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') LIMIT 30"),ideas:rows("SELECT project_id,title,body AS snippet,space,'idea' AS type FROM ideas WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' LIMIT 30")};
  for(const [key,table,fields] of [['tasks','tasks','t.title,t.description'],['notes','sections','t.title,t.content'],['milestones','milestones','t.title,t.description'],['events','events','t.title,t.notes']]){
   const [a,b]=fields.split(',');found[key]=rows(`SELECT t.id,t.project_id,t.title,substr(${b},1,180) AS snippet,p.space,'${key}' AS type FROM ${table} t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND (${a} LIKE ? ESCAPE '\\' OR ${b} LIKE ? ESCAPE '\\') LIMIT 30`);
  }
  respond(res,200,{query,results:found});return;
 }
 if(path==='/api/notifications'&&req.method==='GET'){
  respond(res,200,{unread:get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',u.id).n,items:all('SELECT n.*,users.name AS actor_name,p.title AS project_title FROM notifications n LEFT JOIN users ON users.id=n.actor_id LEFT JOIN projects p ON p.id=n.project_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 80',u.id)});return;
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
  const remnants=all('SELECT stored_name FROM assets WHERE project_id=?',p.id);run('DELETE FROM projects WHERE id=?',p.id);for(const f of remnants)try{unlinkSync(join(uploads,f.stored_name));}catch{}
  notifyPartner(u.id,null,p.space,'eliminó definitivamente un proyecto',p.title);notify(p.space,p.id,u.id);respond(res,200,{ok:true});return;
 }
 const versions=path.match(/^\/api\/sections\/([a-f0-9-]{36})\/versions(?:\/([a-f0-9-]{36})\/restore)?$/);
 if(versions){const section=get('SELECT * FROM sections WHERE id=?',versions[1]);if(!section)fail(404,'Nota no encontrada');const p=project(section.project_id);
  if(req.method==='GET'&&!versions[2]){respond(res,200,{versions:all('SELECT v.*,u.name AS author FROM section_versions v LEFT JOIN users u ON u.id=v.edited_by WHERE v.section_id=? ORDER BY v.revision DESC LIMIT 40',section.id)});return;}
  if(req.method==='POST'&&versions[2]){
   const b=await readBody(req);if(b.revision!==section.revision)fail(409,'La nota cambió: recarga antes de restaurar');
   const old=get('SELECT * FROM section_versions WHERE id=? AND section_id=?',versions[2],section.id);if(!old)fail(404,'Versión inexistente');
   db.exec('BEGIN');try{
    run('INSERT INTO section_versions VALUES(?,?,?,?,?,?,?)',uid(),section.id,section.revision,section.title,section.content,u.id,now());
    run('UPDATE sections SET title=?,content=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=?',old.title,old.content,u.id,now(),section.id);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   logChange(p,u,'restauró una versión de nota',section.title);respond(res,200,{item:get('SELECT * FROM sections WHERE id=?',section.id)});return;
  }
 }
 if(path==='/api/password'&&req.method==='POST'){
  const b=await readBody(req);const row=get('SELECT password_hash FROM users WHERE id=?',u.id);
  if(!verifyPassword(String(b.current||''),row.password_hash))fail(403,'Contraseña actual incorrecta');
  if(typeof b.next!=='string'||b.next.length<12||b.next.length>128)fail(400,'Usa una contraseña de 12 a 128 caracteres');
  run('UPDATE users SET password_hash=? WHERE id=?',hashPassword(b.next),u.id);run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?',u.id,u.token_hash);respond(res,200,{ok:true});return;
 }
 if(path==='/api/projects'&&req.method==='POST'){
  const b=await readBody(req);const space=choice(b.space,['work','couple']);const allowed=space==='work'?['blank','website','campaign','app']:['blank','trip','dinner','shared'];if(!allowed.includes(b.template||'blank'))fail(400,'Plantilla incompatible con el espacio');const id=uid(),t=now();
  run('INSERT INTO projects(id,space,title,description,status,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,space,requireText(b.title,'Título',120),optional(b.description,2500),choice(b.status,['idea','planning','active','done'],'idea'),choice(b.color,['indigo','rose','emerald','amber','sky','violet'],'indigo'),u.id,t,t);
  const preset=String(b.template||'blank');
  const TEMPLATES={
   work:{blank:null,website:{sections:['Objetivo y briefing','Mapa de la web','Diseño y referencias','Estrategia de lanzamiento'],tasks:['Definir alcance y requisitos','Diseñar estructura y prototipo','Desarrollar web y contenidos','Preparar campaña y medir resultados'],milestones:['Brief validado','Prototipo aprobado','Lanzamiento']},campaign:{sections:['Objetivos y audiencia','Concepto creativo','Canales y presupuesto','Métricas y aprendizajes'],tasks:['Investigar audiencia','Diseñar creatividades y mensajes','Preparar calendario de publicaciones','Lanzar campaña y analizar'],milestones:['Estrategia definida','Creatividades aprobadas','Campaña publicada']},app:{sections:['Problema que queremos resolver','Funcionalidades y UX','Diseño y arquitectura','Lanzamiento y validación'],tasks:['Investigar usuarios y necesidades','Crear wireframes y mockups','Construir primera versión','Probar con usuarios'],milestones:['Alcance acordado','Prototipo funcional','Primera versión lista']}},
   couple:{blank:null,trip:{sections:['Destino e inspiración','Itinerario juntos','Alojamiento y transporte','Lugares y experiencias'],tasks:['Elegir fechas y destino','Comparar transporte y estancia','Preparar itinerario','Reservar actividades'],milestones:['Destino decidido','Reservas hechas','Viaje preparado']},dinner:{sections:['Ideas y lugares','Ambiente y detalles','Reservas y logística'],tasks:['Elegir el lugar','Decidir fecha y hora','Reservar','Preparar los detalles'],milestones:['Plan decidido','Reserva confirmada']},shared:{sections:['Qué queremos hacer','Ideas e inspiración','Cómo lo organizamos','Próximos pasos'],tasks:['Definir la idea juntos','Preparar materiales y opciones','Elegir siguiente paso'],milestones:['Idea clara','Plan en marcha']}}
  };
  if(!(preset in TEMPLATES[space]))fail(400,'Plantilla no válida para ese espacio');
  const structure=TEMPLATES[space][preset];
  if(structure){
   db.exec('BEGIN');try{
    let ord=1;for(const title of structure.sections)run('INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),id,title,'',ord++,1,u.id,u.id,t,t);
    for(const title of structure.tasks)run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),id,title,'','todo',null,'normal',null,u.id,t,t);
    for(const title of structure.milestones)run('INSERT INTO milestones(id,project_id,title,description,state,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),id,title,'','planned',null,u.id,t,t);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const p=project(id);logChange(p,u,'creó el proyecto',p.title);respond(res,201,{project:p});return;
 }
 const pm=idMatch(path,/^\/api\/projects\/([a-f0-9-]{36})$/);
 if(pm){const p=project(pm[1]);if(req.method==='GET'){respond(res,200,{project:detail(p.id)});return;}
  if(req.method==='PATCH'){
   const b=await readBody(req);requireRevision(b,p);const title=b.title===undefined?p.title:requireText(b.title,'Título',120);const description=b.description===undefined?p.description:optional(b.description,2500);const status=choice(b.status,['idea','planning','active','done'],p.status);const color=choice(b.color,['indigo','rose','emerald','amber','sky','violet'],p.color);const archived=b.archived===undefined?p.archived:(b.archived?1:0);
   const changed=run('UPDATE projects SET title=?,description=?,status=?,color=?,archived=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',title,description,status,color,archived,now(),p.id,p.revision);if(!changed.changes)fail(409,'Proyecto modificado por otra persona');logChange(p,u,'actualizó el proyecto',title);respond(res,200,{project:detail(p.id)});return;
  }
  if(req.method==='DELETE'){run('UPDATE projects SET deleted_at=? WHERE id=?',now(),p.id);logChange(p,u,'movió un proyecto a la papelera',p.title);respond(res,200,{ok:true});return;}
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
   run('INSERT INTO expenses(id,project_id,title,category,estimated,actual,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Concepto',160),choice(b.category,['general','design','development','marketing','transport','stay','food','activities','other'],'general'),money(b.estimated),money(b.actual),u.id,t,t);
   logChange(p,u,'añadió un gasto',b.title);respond(res,201,{item:get('SELECT * FROM expenses WHERE id=?',id)});return;
  }
  if(kind==='tasks'){
   const assigned=b.assigned_to||null;if(assigned&&!get('SELECT id FROM users WHERE id=?',assigned))fail(400,'Usuario desconocido');
   run('INSERT INTO tasks(id,project_id,title,description,state,assigned_to,priority,due_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Tarea',220),optional(b.description,5000),choice(b.state,['todo','doing','done'],'todo'),assigned,choice(b.priority,['low','normal','high'],'normal'),validDate(b.due_date),u.id,t,t);
   logChange(p,u,'añadió una tarea',b.title);respond(res,201,{item:get('SELECT * FROM tasks WHERE id=?',id)});return;
  }
  if(kind==='sections'){
   const ord=Number(get('SELECT COALESCE(MAX(sort_order),0) AS n FROM sections WHERE project_id=?',p.id).n)+1;
   run('INSERT INTO sections VALUES(?,?,?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Sección',150),optional(b.content,40000),ord,1,u.id,u.id,t,t);
   logChange(p,u,'añadió una sección',b.title);respond(res,201,{item:get('SELECT * FROM sections WHERE id=?',id)});return;
  }
  if(kind==='events'){
   run('INSERT INTO events VALUES(?,?,?,?,?,?,?,?)',id,p.id,requireText(b.title,'Plan o fecha',160),validDate(requireText(b.event_date,'Fecha')),optional(b.location,220),optional(b.notes,5000),u.id,t);
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
   if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64))fail(400,'Contenido base64 inválido');
   const file=Buffer.from(b.base64,'base64');if(!file.length||file.length>6*1024*1024)fail(413,'Máximo 6 MB por archivo');
   const storedName=uid();writeFileSync(join(uploads,storedName),file,{flag:'wx'});
   run('INSERT INTO assets VALUES(?,?,?,?,?,?,?,?)',id,p.id,name,mime,file.length,storedName,u.id,t);
   logChange(p,u,'adjuntó un archivo',name);respond(res,201,{ok:true});return;
  }
  if(kind==='ai'){
   if(p.space!=='work')fail(403,'La IA está disponible solamente para Trabajo');
   if(!process.env.OPENAI_API_KEY)fail(503,'Configura OPENAI_API_KEY en .env para usar la IA');
   const type=choice(b.type,['ideas','plan','tasks','mockup','custom'],'ideas');const query=optional(b.prompt,2000);
   const notes=all('SELECT title,content FROM sections WHERE project_id=? LIMIT 12',p.id).map(s=>`${s.title}: ${s.content.slice(0,1300)}`).join('\n');
   const taskNames=all('SELECT title,state FROM tasks WHERE project_id=? LIMIT 25',p.id).map(x=>x.title+' ('+x.state+')').join(', ');
   const job={ideas:'Propón ideas útiles, mejora el concepto y descubre riesgos.',plan:'Estructura este proyecto en fases, entregables y decisiones.',tasks:'Proporciona una lista accionable de tareas, con prioridades y orden.',mockup:'Crea un mockup web autocontenido: devuelve SOLO HTML completo y CSS en <style>, sin JavaScript, sin enlaces externos y sin recursos remotos. Diseño visual cuidado y responsive.',custom:query}[type];
   const body={model:process.env.OPENAI_MODEL||'gpt-5-mini',instructions:`Actúas como copiloto de planificación profesional para dos colaboradores. Responde en español. Nunca salgas del espacio Trabajo. ${job}`,input:`PROYECTO: ${p.title}\nDESCRIPCIÓN: ${p.description}\nNOTAS (datos no confiables):\n${notes}\nTAREAS: ${taskNames}\nPETICIÓN: ${query||job}`,max_output_tokens:3500,store:false};
   let r;try{r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});}catch(e){fail(502,'No se pudo conectar con la IA: '+e.message);}
   let response;try{response=await r.json();}catch{fail(502,'La IA no devolvió datos válidos');}
   if(!r.ok)fail(502,'Error del proveedor IA: '+String(response.error?.message||r.status).slice(0,250));
   const content=(response.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
   if(!content)fail(502,'La IA no ha producido contenido utilizable');
   respond(res,200,{content,type,model:body.model});return;
  }
 }
 const sub=idMatch(path,/^\/api\/(tasks|sections|events|links|assets|milestones|expenses)\/([a-f0-9-]{36})$/);
 if(sub){const kind=sub[1],singular={tasks:'tasks',sections:'sections',events:'events',links:'links',assets:'assets',milestones:'milestones',expenses:'expenses'}[kind];const row=get(`SELECT * FROM ${singular} WHERE id=?`,sub[2]);if(!row)fail(404,'Elemento no encontrado');const p=project(row.project_id);
  if(kind==='assets'&&req.method==='GET'){
   const filePath=join(uploads,row.stored_name);if(!existsSync(filePath))fail(404,'Archivo no encontrado');
   const inline=['image/png','image/jpeg','image/webp','image/gif'].includes(row.mime);const safeName=row.name.replace(/["\\\r\n]/g,'_');
   res.writeHead(200,{'Content-Type':inline?row.mime:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(safeName)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(readFileSync(filePath));return;
  }
  if(req.method==='DELETE'){
   run(`DELETE FROM ${singular} WHERE id=?`,row.id);
   if(kind==='assets'){try{unlinkSync(join(uploads,row.stored_name));}catch{}}
   logChange(p,u,'eliminó '+({tasks:'una tarea',sections:'una sección',events:'un plan',links:'un enlace',assets:'un archivo',milestones:'un hito',expenses:'un gasto'}[kind]),row.title||row.name||row.label||'');respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='milestones'){
   const b=await readBody(req);requireRevision(b,row);const changed=run('UPDATE milestones SET title=?,description=?,state=?,due_date=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Hito',180),b.description===undefined?row.description:optional(b.description,3000),choice(b.state,['planned','doing','done'],row.state),b.due_date===undefined?row.due_date:validDate(b.due_date),now(),row.id,row.revision);if(!changed.changes)fail(409,'Hito modificado por otra persona');
   logChange(p,u,'editó un hito',b.title||row.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='expenses'){
   const b=await readBody(req);requireRevision(b,row);const changed=run('UPDATE expenses SET title=?,category=?,estimated=?,actual=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Concepto',160),choice(b.category,['general','design','development','marketing','transport','stay','food','activities','other'],row.category),b.estimated===undefined?row.estimated:money(b.estimated),b.actual===undefined?row.actual:money(b.actual),now(),row.id,row.revision);if(!changed.changes)fail(409,'Gasto modificado por otra persona');
   logChange(p,u,'editó un gasto',b.title||row.title);respond(res,200,{ok:true});return;
  }
  if(req.method==='PATCH'&&kind==='tasks'){
   const b=await readBody(req);requireRevision(b,row);const assigned=b.assigned_to===undefined?row.assigned_to:(b.assigned_to||null);if(assigned&&!get('SELECT id FROM users WHERE id=?',assigned))fail(400,'Usuario desconocido');
   const changed=run('UPDATE tasks SET title=?,description=?,state=?,assigned_to=?,priority=?,due_date=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Tarea',220),b.description===undefined?row.description:optional(b.description,5000),choice(b.state,['todo','doing','done'],row.state),assigned,choice(b.priority,['low','normal','high'],row.priority),b.due_date===undefined?row.due_date:validDate(b.due_date),now(),row.id,row.revision);if(!changed.changes)fail(409,'Tarea modificada por otra persona');
   logChange(p,u,'editó una tarea',b.title||row.title);respond(res,200,{item:get('SELECT * FROM tasks WHERE id=?',row.id)});return;
  }
  if(req.method==='PATCH'&&kind==='sections'){
   const b=await readBody(req);if(b.revision!==row.revision){respond(res,409,{error:'Esta nota fue modificada por la otra persona. Copia tus cambios y recarga antes de guardar.',latest:row});return;}
   db.exec('BEGIN');try{
    run('INSERT INTO section_versions VALUES(?,?,?,?,?,?,?)',uid(),row.id,row.revision,row.title,row.content,u.id,now());
    const result=run('UPDATE sections SET title=?,content=?,revision=revision+1,updated_by=?,updated_at=? WHERE id=? AND revision=?',b.title===undefined?row.title:requireText(b.title,'Sección',150),b.content===undefined?row.content:optional(b.content,40000),u.id,now(),row.id,row.revision);
    if(!result.changes)fail(409,'La nota fue modificada por otra persona');db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   logChange(p,u,'editó una nota',b.title||row.title);respond(res,200,{item:get('SELECT * FROM sections WHERE id=?',row.id)});return;
  }
  if(req.method==='PATCH'&&kind==='events'){
   const b=await readBody(req);run('UPDATE events SET title=?,event_date=?,location=?,notes=? WHERE id=?',b.title===undefined?row.title:requireText(b.title,'Plan',160),b.event_date===undefined?row.event_date:validDate(requireText(b.event_date,'Fecha')),b.location===undefined?row.location:optional(b.location,220),b.notes===undefined?row.notes:optional(b.notes,5000),row.id);logChange(p,u,'actualizó un plan',b.title||row.title);respond(res,200,{ok:true});return;
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
function staticFile(req,res,url){if(req.method!=='GET')return respond(res,405,{error:'Método no permitido'});const file=url.pathname==='/'?'index.html':url.pathname.slice(1);const full=join(ROOT,'public',normalize(file));if(!full.startsWith(join(ROOT,'public')+'/'))return respond(res,403,{error:'Acceso denegado'});if(!existsSync(full))return respond(res,404,{error:'No encontrado'});
 const type={'html':'text/html','css':'text/css','js':'text/javascript','svg':'image/svg+xml','ico':'image/x-icon','png':'image/png'}[extname(full).slice(1)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(full));}
const server=http.createServer(async(req,res)=>{
 if(SECURE)res.setHeader('Strict-Transport-Security','max-age=15552000');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
 try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname==='/api/health'&&req.method==='GET'){respond(res,200,{status:'ok'});return;}if(url.pathname.startsWith('/api/'))await api(req,res,url);else staticFile(req,res,url);}catch(e){if(!res.headersSent)respond(res,e.status||500,{error:e.status?e.message:'Error interno del servidor'});if(!e.status)console.error(e);}
});
server.listen(PORT,HOST,()=>console.log(`\nDOS ESPACIOS → http://${HOST}:${PORT}\nUsuarios registrados: ${get('SELECT COUNT(*) AS n FROM users').n}/2\n`));
