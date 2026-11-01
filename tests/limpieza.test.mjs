import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';
import { hourlyJobs } from '../edge/jobs.mjs';

const withSql = () => {
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const sql={exec(sql,...bindings){
  if(!bindings.length && /;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(sql);const reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?stmt.all(...bindings):[];
  const changes=reader?0:stmt.run(...bindings).changes;
  return {toArray:()=>rows,rowsWritten:changes};
 }};
 return {db,sql,transactionSync(f){db.exec('BEGIN');try{const result=f();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
};

test('limpieza de cada hora: borra lo caducado y conserva lo no leído y la actividad', () => {
 const storage=withSql(),app=createApi(storage,{SETUP_TOKEN:'Q'.repeat(48)},{getWebSockets:()=>[]}),db=storage.db;
 assert.ok(hourlyJobs(app,{}).some(([n])=>n==='limpieza'));
 const old=new Date(Date.now()-200*864e5).toISOString(),recent=new Date().toISOString(),future=new Date(Date.now()+864e5).toISOString();
 db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run('u1','Álvaro','a@t.test','x',old);
 const ses=db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,device,created_at) VALUES(?,?,?,?,?)');ses.run('caducada','u1',old,'',old);ses.run('viva','u1',future,'',recent);
 const no=db.prepare("INSERT INTO notifications(id,user_id,space,action,detail,created_at,read_at) VALUES(?,?,'work','x','',?,?)");no.run('leida-vieja','u1',old,old);no.run('sin-leer-vieja','u1',old,null);no.run('leida-nueva','u1',recent,recent);
 db.prepare("INSERT INTO activities(id,space,user_id,action,detail,created_at) VALUES('act','work','u1','x','',?)").run(old);
 const out=app.processCleanup();
 assert.equal(out.sesiones,1);assert.equal(out.avisos,1);
 assert.deepEqual(db.prepare('SELECT token_hash FROM sessions').all().map(r=>r.token_hash),['viva']);
 assert.deepEqual(db.prepare('SELECT id FROM notifications ORDER BY id').all().map(r=>r.id),['leida-nueva','sin-leer-vieja']);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n,1);
 const idx=db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name);
 for(const n of ['idx_events_project_date','idx_expenses_project','idx_activities_time','idx_notif_unread','idx_sessions_expiry'])assert.ok(idx.includes(n),n);
});
