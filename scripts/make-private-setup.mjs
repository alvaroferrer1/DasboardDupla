// Creates one installation secret on the host machine, never in the delivered ZIP.
import {existsSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dest=join(project,'.local-private','setup-token.txt');
mkdirSync(dirname(dest),{recursive:true,mode:0o700});
if(!existsSync(dest)){writeFileSync(dest,randomBytes(32).toString('hex')+'\n',{mode:0o600,flag:'wx'});}
try{chmodSync(dest,0o600)}catch{}
const secret=readFileSync(dest,'utf8').trim();
if(!/^[0-9a-f]{64}$/.test(secret))throw new Error('Clave de instalación local inválida');
if(process.argv.includes('--print'))console.log(secret);
else console.log(dest);
