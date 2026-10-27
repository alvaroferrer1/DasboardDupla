import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync } from 'node:fs';
import { db, get, run, uid, now, hashPassword } from '../db.mjs';

if(get('SELECT COUNT(*) AS n FROM users').n){console.error('Ya hay cuentas creadas. No se permiten altas públicas.');process.exit(1);}
const piped = !input.isTTY ? readFileSync(0,'utf8').split(/\r?\n/) : null;
const rl = input.isTTY ? createInterface({input,output}) : null;
async function ask(question,def='') {
 const x = (piped ? (piped.shift()||'') : await rl.question(`${question}${def?' ['+def+']':''}: `)).trim();
 return x||def;
}
console.log('\nDOS ESPACIOS | Alta privada de dos cuentas\n');
const users=[];
try{
 for(const name of ['Álvaro','Angie']){
  const email=(await ask(`Correo de ${name}`)).toLowerCase();
  const password=await ask(`Contraseña para ${name} (mínimo 12 caracteres)`);
  if(!/^\S+@\S+\.\S+$/.test(email)||password.length<12)throw new Error('Correo inválido o contraseña de menos de 12 caracteres.');
  users.push({name,email,password});
 }
 if(users[0].email===users[1].email)throw new Error('Los correos deben ser diferentes.');
 rl?.close();
 db.exec('BEGIN');
 for(const u of users)run('INSERT INTO users VALUES(?,?,?,?,?)',uid(),u.name,u.email,hashPassword(u.password),now());
 db.exec('COMMIT');
 console.log('\nCuentas creadas. Arranca con: npm start\n');
}catch(e){try{db.exec('ROLLBACK');}catch{}rl?.close();console.error(e.message);process.exit(1);}
