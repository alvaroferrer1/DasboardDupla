import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {DATA} from '../db.mjs';
const source=process.argv[2]||join(process.cwd(),'guardian-output','report.json');
if(!existsSync(source))throw Error('No se encontró el informe');
const report=JSON.parse(readFileSync(source,'utf8'));
if(report.format!=='guardian-report/v1'||!report.evaluation)throw Error('Formato de informe no válido');
writeFileSync(join(DATA,'guardian-report.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log('Informe técnico privado disponible en el dashboard. No representa aprobación de producción.');
