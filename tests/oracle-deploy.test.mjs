import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=f=>readFileSync(join(root,f),'utf8');
test('Oracle Always Free: public HTTPS, private Node, persistent volumes and protected setup',async t=>{
 await t.test('Docker only exposes Caddy; app stays private and retains SQLite data',()=>{
  const y=read('compose.yaml');
  assert.match(y,/caddy:/);assert.match(y,/"80:80"/);assert.match(y,/"443:443"/);
  assert.match(y,/dos_data:\/app\/data/);assert.match(y,/restart: unless-stopped/);
  assert.doesNotMatch(y,/3077:3077|"3077:3077"/);
  assert.match(y,/COOKIE_SECURE:\s*"true"/);assert.match(y,/PUBLIC_ORIGIN: https:\/\//);
 });
 await t.test('No secrets or data in Docker image',()=>{
  const ignore=read('.dockerignore');
  for(const field of ['.env','data/','node_modules/'])assert.ok(ignore.includes(field));
  const docker=read('Dockerfile');assert.match(docker,/ENTRYPOINT.*entrypoint\.sh/);
  const init=read('scripts/entrypoint.sh');assert.match(init,/exec gosu node/);
 });
 await t.test('Oracle installation and backups have protective checks',()=>{
  const install=read('ops/INSTALAR_ORACLE_ALWAYS_FREE.sh');
  assert.match(install,/if \[\[ -e \.env \]\]/);
  assert.match(install,/od -An -N32/);
  assert.match(install,/docker compose up -d --build/);
  assert.match(install,/dos-espacios-backup\.timer/);
  const backup=read('ops/backup-oracle.sh');assert.match(backup,/docker compose exec/);
  assert.match(backup,/node scripts\/backup\.mjs/);
  assert.ok(existsSync(join(root,'PUBLICAR_EN_ORACLE_DESDE_WINDOWS.ps1')));
 });
});
