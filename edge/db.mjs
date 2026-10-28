import { randomBytes, randomUUID } from 'node:crypto';
import { schema } from './schema.mjs';

const hex = bytes => Array.from(bytes, b=>b.toString(16).padStart(2,'0')).join('');
const bytes = hexs => Uint8Array.from(hexs.match(/.{2}/g).map(x=>parseInt(x,16)));
const now = () => new Date().toISOString();
const uid = () => randomUUID();

// WebCrypto is asynchronous; it avoids blocking the edge runtime with synchronous scrypt.
export async function hashPassword(password) {
  const salt=randomBytes(16);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const digest=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256);
  return `pbkdf2-sha256$100000$${hex(salt)}$${hex(new Uint8Array(digest))}`;
}
export async function verifyPassword(password,stored) {
  try {
   const [algorithm, rounds, salt, expected]=String(stored).split('$');
   if(algorithm!=='pbkdf2-sha256'||+rounds!==100000||!/^([0-9a-f]{32})$/.test(salt)||!/^([0-9a-f]{64})$/.test(expected))return false;
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
   const digest=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:100000},key,256));
   const control=bytes(expected);let diff=0;
   for(let i=0;i<32;i++)diff|=digest[i]^control[i];return diff===0;
  }catch{return false;}
}
export function createDB(storage) {
 const sql=storage.sql;
 // Existing cloud deployments already have data. CREATE TABLE IF NOT EXISTS is non-destructive.
 sql.exec(schema);
 sql.exec('CREATE TABLE IF NOT EXISTS guardian_reports(id INTEGER PRIMARY KEY,json TEXT NOT NULL)');
 // Additive migration: stable idempotency keys prevent duplicate projects when mobile retries a save.
 sql.exec('CREATE TABLE IF NOT EXISTS project_create_requests(request_id TEXT NOT NULL,user_id TEXT NOT NULL,project_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(request_id,user_id))');
 const eventCols=sql.exec('PRAGMA table_info(events)').toArray().map(r=>r.name);
 if(!eventCols.includes('event_time'))sql.exec("ALTER TABLE events ADD COLUMN event_time TEXT NOT NULL DEFAULT ''");
 if(!eventCols.includes('booking_status'))sql.exec("ALTER TABLE events ADD COLUMN booking_status TEXT NOT NULL DEFAULT 'pending'");
 if(!eventCols.includes('booking_reference'))sql.exec("ALTER TABLE events ADD COLUMN booking_reference TEXT NOT NULL DEFAULT ''");
 sql.exec('CREATE TABLE IF NOT EXISTS throttles(key TEXT PRIMARY KEY,n INTEGER NOT NULL,since INTEGER NOT NULL)');
 // Non-destructive migrations: every existing Cloudflare account retains its tables and rows.
 const taskCols=sql.exec('PRAGMA table_info(tasks)').toArray().map(r=>r.name);
 if(!taskCols.includes('recurrence'))sql.exec("ALTER TABLE tasks ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'");
 if(!taskCols.includes('blocked_by'))sql.exec('ALTER TABLE tasks ADD COLUMN blocked_by TEXT');
 if(!taskCols.includes('series_id'))sql.exec('ALTER TABLE tasks ADD COLUMN series_id TEXT');
 if(!taskCols.includes('recurrence_day'))sql.exec('ALTER TABLE tasks ADD COLUMN recurrence_day INTEGER');
 // DUPLA 6: tipo, destino, fechas y portada del proyecto; preferencias; cachés externas; agente Dupla. Solo aditivo.
 const projectCols=sql.exec('PRAGMA table_info(projects)').toArray().map(r=>r.name);
 for(const [col,def] of [['kind',"TEXT NOT NULL DEFAULT 'blank'"],['destination',"TEXT NOT NULL DEFAULT ''"],['start_date','TEXT'],['end_date','TEXT'],['cover_file','TEXT'],['cover_credit',"TEXT NOT NULL DEFAULT ''"]])if(!projectCols.includes(col))sql.exec(`ALTER TABLE projects ADD COLUMN ${col} ${def}`);
 // Notificaciones (R0212-R0242): claves de cifrado por dispositivo y marca de importante por persona.
 sql.exec('CREATE TABLE IF NOT EXISTS notification_flags(notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,important INTEGER NOT NULL DEFAULT 0)');
 const sessionCols=sql.exec('PRAGMA table_info(sessions)').toArray().map(r=>r.name);
 if(!sessionCols.includes('device'))sql.exec("ALTER TABLE sessions ADD COLUMN device TEXT NOT NULL DEFAULT ''");
 if(!sessionCols.includes('created_at'))sql.exec("ALTER TABLE sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
 // Conexiones con alcance: global, por espacio o por proyecto, y permiso de ver o editar.
 sql.exec("CREATE TABLE IF NOT EXISTS connections(id TEXT PRIMARY KEY,provider TEXT NOT NULL,scope_type TEXT NOT NULL CHECK(scope_type IN ('global','space','project')),scope_id TEXT NOT NULL DEFAULT '',permission TEXT NOT NULL DEFAULT 'read' CHECK(permission IN ('read','write')),label TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',created_by TEXT,created_at TEXT NOT NULL)");
 sql.exec('CREATE TABLE IF NOT EXISTS shared_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS user_prefs(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,key TEXT NOT NULL,value TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,key))');
 sql.exec('CREATE TABLE IF NOT EXISTS place_cache(kind TEXT NOT NULL,query TEXT NOT NULL,json TEXT NOT NULL,fetched_at INTEGER NOT NULL,PRIMARY KEY(kind,query))');
 sql.exec("CREATE TABLE IF NOT EXISTS agent_messages(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,proposals TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL)");
 sql.exec('CREATE INDEX IF NOT EXISTS idx_agent_messages_user ON agent_messages(user_id,created_at)');
 sql.exec('CREATE TABLE IF NOT EXISTS agent_memory(id TEXT PRIMARY KEY,fact TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL)');
 // Ideas (R0329-R0340): archivada y a qué se convirtió. Nuestro espacio (R0443-R0453): deseos, regalos, metas, casa y recuerdos.
 const ideaCols=sql.exec('PRAGMA table_info(ideas)').toArray().map(r=>r.name);
 for(const [col,def] of [['archived_at','TEXT'],['converted_kind','TEXT'],['converted_ref','TEXT']])if(ideaCols.length&&!ideaCols.includes(col))sql.exec(`ALTER TABLE ideas ADD COLUMN ${col} ${def}`);
 sql.exec("CREATE TABLE IF NOT EXISTS couple_items(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('wish','gift','goal','home','memory')),title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',item_date TEXT,price REAL,url TEXT NOT NULL DEFAULT '',person TEXT NOT NULL DEFAULT '',progress INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,photo TEXT,project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,idea_id TEXT,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
 // Presupuesto freelance (R0428-R0438): parámetros guardados por proyecto de trabajo.
 sql.exec('CREATE TABLE IF NOT EXISTS project_quotes(project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,data TEXT NOT NULL,updated_by TEXT,updated_at TEXT NOT NULL)');
 // Reuniones (R0301-R0323): reunión vinculada a proyecto/viaje/idea, tramos transcritos por persona y análisis IA aparte.
 sql.exec("CREATE TABLE IF NOT EXISTS meetings(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','ended')),created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,started_at TEXT,ended_at TEXT,summary TEXT,tasks TEXT,decisions TEXT,summary_at TEXT)");
 sql.exec('CREATE TABLE IF NOT EXISTS meeting_segments(id TEXT PRIMARY KEY,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),t_start INTEGER NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS meeting_signals(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,from_user TEXT NOT NULL,data TEXT NOT NULL,created_at INTEGER NOT NULL)');
 // Director General (R0369-R0384): estado de cada sugerencia (propuesta, en revisión, aprobada, ejecutada, descartada).
 sql.exec("CREATE TABLE IF NOT EXISTS director_states(id TEXT PRIMARY KEY,space TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('proposal','review','approved','executed','discarded')),task_id TEXT,updated_by TEXT,updated_at TEXT NOT NULL)");
 // Calendarios personales fusionados (cada persona, solo lectura) y reuniones con Google Meet.
 sql.exec("CREATE TABLE IF NOT EXISTS google_personal(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,encrypted_token TEXT NOT NULL,expires_at INTEGER NOT NULL,email TEXT NOT NULL DEFAULT '',calendars TEXT NOT NULL DEFAULT '[]',connected_at TEXT NOT NULL)");
 const mtCols=sql.exec('PRAGMA table_info(meetings)').toArray().map(r=>r.name);for(const c of ['meet_url','google_event_id'])if(mtCols.length&&!mtCols.includes(c))sql.exec(`ALTER TABLE meetings ADD COLUMN ${c} TEXT`);
 // Historial de presupuestos: cuándo se compró/reservó cada gasto. Grabación de reuniones. Tablero de tareas independiente.
 const exCols=sql.exec('PRAGMA table_info(expenses)').toArray().map(r=>r.name);if(exCols.length&&!exCols.includes('booked_at'))sql.exec('ALTER TABLE expenses ADD COLUMN booked_at TEXT');if(exCols.length&&!exCols.includes('paid_by'))sql.exec('ALTER TABLE expenses ADD COLUMN paid_by TEXT');
 const sgCols=sql.exec('PRAGMA table_info(meeting_segments)').toArray().map(r=>r.name);if(sgCols.length&&!sgCols.includes('audio'))sql.exec('ALTER TABLE meeting_segments ADD COLUMN audio TEXT');
 sql.exec('CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,alg INTEGER NOT NULL,jwk TEXT NOT NULL,sign_count INTEGER NOT NULL DEFAULT 0,label TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT)');
 sql.exec('CREATE TABLE IF NOT EXISTS webauthn_challenges(challenge TEXT PRIMARY KEY,user_id TEXT,kind TEXT NOT NULL,expires_at INTEGER NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS drive_backup(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,encrypted_token TEXT NOT NULL,expires_at INTEGER NOT NULL,folder_id TEXT,last_at TEXT,last_file TEXT,last_check TEXT,last_error TEXT,connected_at TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS api_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT)');
 sql.exec("CREATE TABLE IF NOT EXISTS board_tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','blocked','done')),assignee TEXT REFERENCES users(id) ON DELETE SET NULL,priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),parent_id TEXT REFERENCES board_tasks(id) ON DELETE SET NULL,due_date TEXT,sort REAL NOT NULL DEFAULT 0,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,done_at TEXT)");
 // Avisos propios de cada destino (lo que vais aprendiendo: fiestas, ferias, subidas de precio…).
 sql.exec('CREATE TABLE IF NOT EXISTS dest_notes(id TEXT PRIMARY KEY,dest_key TEXT NOT NULL,dest TEXT NOT NULL,month INTEGER NOT NULL DEFAULT 0,text TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL)');
 // Viajes (R0284-R0295): día completado, actividad hecha/cancelada y reserva utilizada.
 sql.exec('CREATE TABLE IF NOT EXISTS trip_days(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,day_date TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(project_id,day_date))');
 // Calendario (R0261-R0264): evento vinculado a proyecto y completado, para eventos DUPLA y del calendario compartido.
 sql.exec("CREATE TABLE IF NOT EXISTS calendar_marks(source TEXT NOT NULL CHECK(source IN ('dupla','google')),ref_id TEXT NOT NULL,project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,done INTEGER NOT NULL DEFAULT 0,updated_by TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(source,ref_id))");
 sql.exec('CREATE TABLE IF NOT EXISTS reminder_sent(task_id TEXT NOT NULL,user_id TEXT NOT NULL,notice_date TEXT NOT NULL,PRIMARY KEY(task_id,user_id,notice_date))');
 sql.exec("CREATE TABLE IF NOT EXISTS integration_runs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)");
 // Persistent delivery queue for n8n/Make. No external secrets or URLs are stored here.
 sql.exec("CREATE TABLE IF NOT EXISTS webhook_outbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed')),attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,sent_at TEXT)");
 sql.exec('CREATE INDEX IF NOT EXISTS idx_webhook_outbox_due ON webhook_outbox(status,next_attempt_at)');
 sql.exec('CREATE INDEX IF NOT EXISTS idx_integration_runs_created ON integration_runs(created_at DESC)');
 sql.exec("CREATE TABLE IF NOT EXISTS guardian_daily_notices(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,issue_type TEXT NOT NULL,notice_date TEXT NOT NULL,PRIMARY KEY(user_id,project_id,issue_type,notice_date))");
 sql.exec("CREATE TABLE IF NOT EXISTS guardian_proposals(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,issue_type TEXT NOT NULL,notice_date TEXT NOT NULL,title TEXT NOT NULL,detail TEXT NOT NULL,task_title TEXT NOT NULL,severity TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','executed')),created_at TEXT NOT NULL,decided_by TEXT REFERENCES users(id),decided_at TEXT,executed_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,executed_by TEXT REFERENCES users(id),executed_at TEXT,UNIQUE(project_id,issue_type,notice_date))");
 // OAuth secrets never appear in snapshot/export: encrypted token at rest and state bound to one user.
 sql.exec('CREATE TABLE IF NOT EXISTS google_connections(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,encrypted_token TEXT NOT NULL,expires_at INTEGER NOT NULL,connected_at TEXT NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS google_oauth_states(state TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)');
 const stCols=sql.exec('PRAGMA table_info(google_oauth_states)').toArray().map(r=>r.name);if(stCols.length&&!stCols.includes('kind'))sql.exec("ALTER TABLE google_oauth_states ADD COLUMN kind TEXT NOT NULL DEFAULT 'shared'");
 sql.exec('CREATE TABLE IF NOT EXISTS google_event_map(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,google_id TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id))');
 // Exactly one private secondary Google calendar is shared by both DUPLA accounts.
 // Additive only: never drops users, hashes, cookies, projects or attachments.
 sql.exec("CREATE TABLE IF NOT EXISTS google_shared_calendar(singleton TEXT PRIMARY KEY CHECK(singleton='main'),calendar_id TEXT NOT NULL,owner_user_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,member_email_a TEXT NOT NULL,member_email_b TEXT NOT NULL,share_status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL)");
 sql.exec('CREATE TABLE IF NOT EXISTS google_shared_event_map(event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,google_id TEXT NOT NULL,updated_at TEXT NOT NULL)');
 // Per-account Figma/Canva OAuth. Connections are not exported with project backups.
 sql.exec("CREATE TABLE IF NOT EXISTS design_connections(provider TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,encrypted_token TEXT NOT NULL,expires_at INTEGER NOT NULL,connected_at TEXT NOT NULL,PRIMARY KEY(provider,user_id))");
 sql.exec("CREATE TABLE IF NOT EXISTS design_oauth_states(state TEXT PRIMARY KEY,provider TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL)");
 sql.exec("CREATE TABLE IF NOT EXISTS design_imports(provider TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,external_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,PRIMARY KEY(provider,user_id,external_id,project_id))");
 // Optional external email reminders: opt-in per person and per space; durable outbox for retry.
 sql.exec('CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,email_enabled INTEGER NOT NULL DEFAULT 0,work_enabled INTEGER NOT NULL DEFAULT 1,couple_enabled INTEGER NOT NULL DEFAULT 0)');
 sql.exec("CREATE TABLE IF NOT EXISTS notification_delivery(notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)");
 // Web Push is optional and off by default. Endpoints are stored privately, not exported.
 const preferenceCols=sql.exec('PRAGMA table_info(notification_preferences)').toArray().map(x=>x.name);
 if(!preferenceCols.includes('push_enabled'))sql.exec('ALTER TABLE notification_preferences ADD COLUMN push_enabled INTEGER NOT NULL DEFAULT 0');
 sql.exec('CREATE TABLE IF NOT EXISTS push_subscriptions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,endpoint TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,endpoint))');
 const pushCols=sql.exec('PRAGMA table_info(push_subscriptions)').toArray().map(r=>r.name);
 if(!pushCols.includes('p256dh'))sql.exec("ALTER TABLE push_subscriptions ADD COLUMN p256dh TEXT NOT NULL DEFAULT ''");
 if(!pushCols.includes('auth'))sql.exec("ALTER TABLE push_subscriptions ADD COLUMN auth TEXT NOT NULL DEFAULT ''");
 sql.exec("CREATE TABLE IF NOT EXISTS push_delivery(notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,subscription_id TEXT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,last_error TEXT NOT NULL DEFAULT '',PRIMARY KEY(notification_id,subscription_id))");
 // DUPLA 5: project operations. Additive migrations retain production IDs and existing records.
 sql.exec("CREATE TABLE IF NOT EXISTS work_deliverables(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','approved')),due_date TEXT,created_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1)");
 sql.exec("CREATE INDEX IF NOT EXISTS idx_deliverables_project ON work_deliverables(project_id)");
 sql.exec("CREATE TABLE IF NOT EXISTS time_entries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,user_id TEXT NOT NULL REFERENCES users(id),minutes INTEGER NOT NULL CHECK(minutes>0 AND minutes<=1440),work_date TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)");
 sql.exec("CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id)");
 sql.exec("CREATE TABLE IF NOT EXISTS trip_stops(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,visit_date TEXT NOT NULL,visit_time TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',details TEXT NOT NULL DEFAULT '',booking_state TEXT NOT NULL DEFAULT 'pending',reference TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL REFERENCES users(id),updated_at TEXT NOT NULL)");
 const stopCols=sql.exec('PRAGMA table_info(trip_stops)').toArray().map(r=>r.name);
 if(stopCols.length&&!stopCols.includes('state'))sql.exec("ALTER TABLE trip_stops ADD COLUMN state TEXT NOT NULL DEFAULT 'planned'");
 if(stopCols.length&&!stopCols.includes('booking_used'))sql.exec('ALTER TABLE trip_stops ADD COLUMN booking_used INTEGER NOT NULL DEFAULT 0');
 sql.exec("CREATE INDEX IF NOT EXISTS idx_trip_project_date ON trip_stops(project_id,visit_date,visit_time)");
 sql.exec("CREATE TABLE IF NOT EXISTS brief_imports(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,brief_hash TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(project_id,brief_hash))");
 sql.exec("CREATE TABLE IF NOT EXISTS automation_rules(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','daily','weekly')),week_day INTEGER NOT NULL DEFAULT 1 CHECK(week_day>=0 AND week_day<=6),action_type TEXT NOT NULL CHECK(action_type IN ('task','notify')),payload TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 0,last_run_date TEXT,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL)");
 sql.exec("CREATE TABLE IF NOT EXISTS automation_executions(id TEXT PRIMARY KEY,rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,run_date TEXT NOT NULL,run_at TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',UNIQUE(rule_id,run_date))");
 sql.exec("CREATE INDEX IF NOT EXISTS idx_auto_project ON automation_rules(project_id)");
 const get=(query,...a)=>sql.exec(query,...a).toArray()[0];
 const all=(query,...a)=>sql.exec(query,...a).toArray();
 const run=(query,...a)=>{const cursor=sql.exec(query,...a);cursor.toArray();return {changes:cursor.rowsWritten};};
 const db={transactionSync:(callback)=>storage.transactionSync(callback)};
 function touch(projectId){run('UPDATE projects SET updated_at=? WHERE id=?',now(),projectId);}
 function activity(projectId,space,userId,action,detail=''){
  run('INSERT INTO activities(id,project_id,space,user_id,action,detail,created_at) VALUES(?,?,?,?,?,?,?)',uid(),projectId,space,userId,action,detail.slice(0,220),now());
  run('INSERT INTO audit_events(id,space,project_id,actor_id,action,occurred_at) VALUES(?,?,?,?,?,?)',uid(),space,projectId,userId,action.slice(0,120),now());
  if(projectId)touch(projectId);
 }
 function saveFile(name,file){
  if(!/^[a-f0-9-]{36}$/.test(name))throw Error('Nombre de archivo inválido');
  storage.transactionSync(()=>{
   const chunkSize=384*1024;let seq=0;
   for(let pos=0;pos<file.length;pos+=chunkSize){
    run('INSERT INTO upload_chunks(name,seq,data) VALUES(?,?,?)',name,seq++,new Uint8Array(file.subarray(pos,pos+chunkSize)));
   }
  });
 }
 const fileExists=(name)=>Boolean(get('SELECT 1 AS ok FROM upload_chunks WHERE name=? LIMIT 1',name));
 function readFile(name){const chunks=all('SELECT data FROM upload_chunks WHERE name=? ORDER BY seq',name).map(x=>Buffer.from(x.data));return Buffer.concat(chunks);}
 const removeFile=(name)=>run('DELETE FROM upload_chunks WHERE name=?',name);
 function makeRateMap(){return {
  get(key){const row=get('SELECT n,since FROM throttles WHERE key=?',key);return row?{n:row.n,since:row.since}:undefined;},
  set(key,v){run('INSERT INTO throttles(key,n,since) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET n=excluded.n,since=excluded.since',key,v.n,v.since);},
  delete(key){run('DELETE FROM throttles WHERE key=?',key);},
  clear(){run('DELETE FROM throttles');}
 };}
 return {db,get,all,run,now,uid,touch,activity,hashPassword,verifyPassword,saveFile,readFile,fileExists,removeFile,makeRateMap};
}
