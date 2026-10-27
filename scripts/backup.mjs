// Consistent on-demand SQLite backup. Run in a private environment.
import { backup } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { db, DATA, now } from '../db.mjs';
const stamp = now().replace(/[:.]/g,'-');
const dest=resolve(process.env.DOS_BACKUP_DIR || join(DATA,'..','private-backups'),`backup-${stamp}`);
mkdirSync(dest,{recursive:true});
const file=join(dest,'dos.sqlite');
await backup(db,file);
const attachments=join(DATA,'uploads');
if(existsSync(attachments))cpSync(attachments,join(dest,'uploads'),{recursive:true,errorOnExist:true,force:false});
writeFileSync(join(dest,'manifest.json'),JSON.stringify({created_at:now(),database:'dos.sqlite',uploads:'uploads',format:'DOS ESPACIOS 3',restore:'Detener app, guardar copia de data/ y sustituir los contenidos desde este backup.'},null,2));
console.log(`Copia coherente creada en: ${dest}`);
console.log('Contiene información privada y hashes de contraseñas. Guardar de forma segura.');
