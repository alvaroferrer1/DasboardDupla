// Pone (o cambia) la contraseña de una cuenta SOLO en el servidor de reserva del PC. Uso: npm run reserva:clave
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeStorage } from '../edge/node-storage.mjs';
import { createDB } from '../edge/db.mjs';

const file=join(fileURLToPath(new URL('..',import.meta.url)),'data','reserva','dupla.sqlite');
const storage=createNodeStorage(file),{hashPassword}=createDB(storage),users=storage.db.prepare('SELECT id,name,email FROM users ORDER BY name').all();
if(!users.length){console.log('La reserva aún no tiene datos: arráncala una vez con «npm run reserva».');process.exit(1);}
const rl=createInterface({input:process.stdin,output:process.stdout});
const ask=(q,hidden)=>new Promise(ok=>{if(hidden){const w=rl._writeToOutput;rl._writeToOutput=s=>{if(s.includes(q))w.call(rl,s);else w.call(rl,'*');};rl.question(q,a=>{rl._writeToOutput=w;process.stdout.write('\n');ok(a);});}else rl.question(q,ok);});
users.forEach((u,i)=>console.log(`${i+1}. ${u.name} (${u.email})`));
const n=Number(await ask('¿A qué cuenta le pones contraseña? (número): '))-1,u=users[n];
if(!u){console.log('Número no válido.');process.exit(1);}
const a=await ask('Nueva contraseña (mínimo 10 caracteres): ',true),b=await ask('Repítela: ',true);rl.close();
if(a.length<10||a!==b){console.log('No coinciden o es demasiado corta. No se ha cambiado nada.');process.exit(1);}
storage.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashPassword(a),u.id);storage.db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
console.log(`Listo: ${u.name} ya puede entrar en la reserva con esa contraseña (solo en este PC; la de la web no cambia).`);storage.close();
