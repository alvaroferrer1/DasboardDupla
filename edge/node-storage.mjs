// Almacenamiento para el servidor de reserva (fuera de Cloudflare): la misma forma que ctx.storage del Durable Object
// (sql.exec, transactionSync, get/put/delete) sobre un archivo SQLite con node:sqlite.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createNodeStorage(file){
 if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});
 const db=new DatabaseSync(file);
 db.exec('PRAGMA journal_mode=WAL');db.exec('PRAGMA busy_timeout=8000');db.exec('PRAGMA foreign_keys=ON');
 db.exec('CREATE TABLE IF NOT EXISTS _kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const sql={exec(text,...bindings){
  if(!bindings.length&&/;\s*\S/.test(text.trim().replace(/;\s*$/,''))){db.exec(text);return {toArray:()=>[],rowsWritten:0};}
  const stmt=db.prepare(text),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(text),rows=reader?stmt.all(...bindings):[];
  return {toArray:()=>rows,rowsWritten:reader?0:Number(stmt.run(...bindings).changes)};
 }};
 let depth=0;
 return {db,sql,
  transactionSync(f){if(depth)return f();depth++;db.exec('BEGIN');try{const r=f();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}finally{depth--;}},
  async get(key){const r=db.prepare('SELECT value FROM _kv WHERE key=?').get(String(key));return r?JSON.parse(r.value):undefined;},
  async put(key,value){db.prepare('INSERT INTO _kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(String(key),JSON.stringify(value));},
  async delete(key){return Number(db.prepare('DELETE FROM _kv WHERE key=?').run(String(key)).changes)>0;},
  close(){db.close();}};
}
