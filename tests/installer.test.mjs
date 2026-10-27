import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await test('Lanzador privado genera el mismo token una sola vez',()=>{
 const script=readFileSync(join(ROOT,'scripts','make-private-setup.mjs'),'utf8');
 assert.match(script,/randomBytes\(32\)/);
 assert.match(script,/flag:'wx'/);
 assert.match(script,/mode:0o600/);
});
await test('Configuración HTTPS proxy y persistencia del despliegue gratis',()=>{
 const compose=readFileSync(join(ROOT,'compose.yaml'),'utf8');
 assert.match(compose,/dos_data:\/app\/data/);
 assert.match(compose,/PUBLIC_ORIGIN: https:\/\//);
 assert.match(compose,/SETUP_TOKEN:/);
 const windows=readFileSync(join(ROOT,'COMPARTIR_GRATIS_WINDOWS.ps1'),'utf8');
 assert.match(windows,/HOST = '127.0.0.1'/);
 assert.match(windows,/COOKIE_SECURE = 'true'/);
 assert.match(windows,/funnel --bg --yes 3077/);
});
