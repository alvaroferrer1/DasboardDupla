import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROOT = dirname(fileURLToPath(import.meta.url));
// Read configuration before resolving the database directory.
const envFile=join(ROOT,'.env');
if(existsSync(envFile)) for(const line of readFileSync(envFile,'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
 if(m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].trim().replace(/^([\"'])(.*)\1$/,'$2');
}

export const DATA = process.env.DOS_DATA_DIR ? resolve(process.env.DOS_DATA_DIR) : join(ROOT, 'data');
mkdirSync(DATA,{recursive:true});
export const db = new DatabaseSync(join(DATA, 'dos.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, space TEXT NOT NULL CHECK(space IN ('work','couple')),title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea','planning','active','done')),color TEXT NOT NULL DEFAULT 'indigo',created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'todo' CHECK(state IN ('todo','doing','done')),assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL,priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),due_date TEXT,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sections(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES users(id),updated_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,event_date TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),content TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,label TEXT NOT NULL,url TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,stored_name TEXT NOT NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS milestones(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','doing','done')),due_date TEXT,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS expenses(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,category TEXT NOT NULL DEFAULT 'general',estimated REAL NOT NULL DEFAULT 0,actual REAL NOT NULL DEFAULT 0,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS checklist_items(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,title TEXT NOT NULL,done INTEGER NOT NULL DEFAULT 0,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id);
CREATE TABLE IF NOT EXISTS activities(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,space TEXT NOT NULL,user_id TEXT REFERENCES users(id),action TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_activities_project ON activities(project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);
CREATE TABLE IF NOT EXISTS ideas(id TEXT PRIMARY KEY,space TEXT NOT NULL CHECK(space IN ('work','couple')),title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'inbox' CHECK(state IN ('inbox','considering','converted')),project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS section_versions(id TEXT PRIMARY KEY,section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,revision INTEGER NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,edited_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_section_versions ON section_versions(section_id,revision DESC);
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',choices_json TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision_votes(decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,choice_index INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(decision_id,user_id));
CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,space TEXT NOT NULL CHECK(space IN ('work','couple')),project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,title TEXT NOT NULL,question TEXT NOT NULL DEFAULT '',answer TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','reviewed','validated')),tags TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1,created_by TEXT REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at DESC);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,space TEXT NOT NULL,project_id TEXT,actor_id TEXT,action TEXT NOT NULL,occurred_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(occurred_at DESC);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,project_id TEXT,space TEXT NOT NULL,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,read_at TEXT);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id,created_at DESC);

`);
// Non-destructive migration for data created with V2.
const projectCols=allTableColumns('projects');
if(!projectCols.includes('deleted_at')) db.exec('ALTER TABLE projects ADD COLUMN deleted_at TEXT');
for(const table of ['projects','tasks','ideas','milestones','expenses']){
 if(!allTableColumns(table).includes('revision')) db.exec(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`);
}
function allTableColumns(name){return db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name);}
export const now = () => new Date().toISOString();
export const uid = () => randomUUID();
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
export function verifyPassword(password,stored){try{const [salt,hex]=stored.split(':');const actual=scryptSync(password,salt,64);return timingSafeEqual(Buffer.from(hex,'hex'),actual);}catch{return false;}}
export const get=(sql,...args)=>db.prepare(sql).get(...args);
export const all=(sql,...args)=>db.prepare(sql).all(...args);
export const run=(sql,...args)=>db.prepare(sql).run(...args);
export function touch(projectId){run('UPDATE projects SET updated_at=? WHERE id=?',now(),projectId);}
export function activity(projectId,space,userId,action,detail=''){
 run('INSERT INTO activities(id,project_id,space,user_id,action,detail,created_at) VALUES(?,?,?,?,?,?,?)',uid(),projectId,space,userId,action,detail.slice(0,220),now());
 run('INSERT INTO audit_events(id,space,project_id,actor_id,action,occurred_at) VALUES(?,?,?,?,?,?)',uid(),space,projectId,userId,action.slice(0,120),now());
 if(projectId)touch(projectId);
 return undefined;
}
