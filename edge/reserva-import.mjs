// Servidor de reserva: carga en el SQLite local la copia completa descargada de Cloudflare (/api/snapshot).
// Mismas cuentas (mismos id y correo); las contraseñas no viajan en la copia: la del dueño de la credencial se pone
// con la suya y la del otro queda sin poder entrar hasta que se le ponga una (npm run reserva:clave).
import { randomBytes } from 'node:crypto';
import { createDB } from './db.mjs';

const SKIP=new Set(['users','sessions','google_connections','google_personal','google_oauth_states','drive_backup','api_tokens','passkeys','push_subscriptions','upload_chunks','_kv']);

export async function importSnapshot(storage,snapshot,{email='',password=''}={}){
 if(!snapshot||snapshot.format!=='dos-espacios-edge-v1'||!snapshot.data||!Array.isArray(snapshot.users)||!Array.isArray(snapshot.files))throw Error('La copia no tiene el formato de DUPLA');
 const {hashPassword}=createDB(storage),db=storage.db;
 const hashes=new Map();for(const u of snapshot.users){const own=email&&u.email.toLowerCase()===email.toLowerCase()&&password;hashes.set(u.id,own?await hashPassword(password):null);}
 const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
 let rows=0;
 db.exec('PRAGMA foreign_keys=OFF');
 try{storage.transactionSync(()=>{
  const keep=snapshot.users.map(u=>u.id);
  db.prepare(`DELETE FROM users WHERE id NOT IN (${keep.map(()=>'?').join(',')||"''"})`).run(...keep);
  for(const u of snapshot.users){const cur=db.prepare('SELECT id FROM users WHERE id=?').get(u.id),h=hashes.get(u.id);
   if(cur){db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(u.name,u.email,u.id);if(h)db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(h,u.id);}
   else db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(u.id,u.name,u.email,h||'sin-clave:'+randomBytes(24).toString('hex'),u.created_at||new Date().toISOString());}
  for(const [table,records] of Object.entries(snapshot.data)){
   if(SKIP.has(table)||!tables.has(table)||!Array.isArray(records))continue;
   const cols=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
   db.exec(`DELETE FROM ${table}`);
   for(const r of records){const keys=Object.keys(r).filter(k=>cols.has(k));if(!keys.length)continue;
    db.prepare(`INSERT OR REPLACE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>r[k]===undefined?null:r[k]));rows++;}
  }
  db.exec('DELETE FROM upload_chunks');
  for(const f of snapshot.files){if(!f?.stored_name||typeof f.base64!=='string')continue;const raw=Buffer.from(f.base64,'base64');let seq=0;
   for(let o=0;o<raw.length;o+=384*1024)db.prepare('INSERT INTO upload_chunks(name,seq,data) VALUES(?,?,?)').run(f.stored_name,seq++,new Uint8Array(raw.subarray(o,o+384*1024)));}
 });}finally{db.exec('PRAGMA foreign_keys=ON');}
 await storage.put('reserva_sync',{at:new Date().toISOString(),exported_at:snapshot.exported_at||null,rows,files:snapshot.files.length});
 await storage.delete('reserva_cambios');
 return {rows,files:snapshot.files.length,users:snapshot.users.length};
}
