import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const conf=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const script=readFileSync(new URL('../PUBLICAR_CLOUDFLARE_PASO_2.ps1',import.meta.url),'utf8');

test('Cloudflare routes static assets through Worker security headers',()=>{
 assert.equal(conf.assets.binding,'ASSETS');
 assert.equal(conf.assets.run_worker_first,true);
 assert.ok(conf.durable_objects.bindings.some(x=>x.class_name==='DosRoom'));
});
test('Windows setup token is compatible with preinstalled PowerShell 5.1',()=>{
 assert.match(script,/RandomNumberGenerator\]::Create\(\)/);
 assert.match(script,/\.GetBytes\(\$bytes\)/);
 assert.match(script,/BitConverter\]::ToString/);
 assert.doesNotMatch(script,/\[Convert\]::ToHexString\(/);
 assert.doesNotMatch(script,/RandomNumberGenerator\]::GetBytes\(32\)/);
});

test('Windows launcher checks Node version before publishing',()=>{
 const cmd=readFileSync(new URL('../PUBLICAR_CLOUDFLARE_GRATIS_WINDOWS.cmd',import.meta.url),'utf8');
 assert.match(cmd,/node scripts\\check-node-version\.mjs/);
 assert.match(cmd,/if errorlevel 1 goto :failure/);
});
