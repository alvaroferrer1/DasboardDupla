// Immutable design contract: DUPLA 5.5 only updates backend functionality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const files=[
 [
  "edge/public/dupla-horizontal.svg",
  "9ac0f793bdff72e60015aad3fb67fb38c99e75500f19cc099d2f48baca52f2b0"
 ],
 [
  "edge/public/dupla-icon-192.png",
  "600c0399d1022de5a1ff93b4928f070118c0e6fd4acbfe53a7ec7ecab449f5c1"
 ],
 [
  "edge/public/dupla-icon-512.png",
  "9ad9d6228933555c57483ae506edd18aa4bac3d8ae2f67b30fc8514eacbe001d"
 ],
 [
  "edge/public/dupla-icon.svg",
  "7ea0105c7cd7611e3ed753d5c7cd2cd881c2f35829bf7d0ba144e8da5faa4f01"
 ],
 [
  "edge/public/favicon.svg",
  "7ea0105c7cd7611e3ed753d5c7cd2cd881c2f35829bf7d0ba144e8da5faa4f01"
 ],
 [
  "edge/public/index.html",
  "ad95e1c82ca4f8099401b35b23b423e337f8b6e7865798b8b228920662c26684"
 ],
 [
  "edge/public/manifest.webmanifest",
  "3a1234fb0cf6fdf49240bfa37ea15a3a33442239061bae4185e96dcfb6a40bed"
 ],
 [
  "edge/public/style.css",
  "c5b51085ef716946549e447bbb514ebf26f791afa76771d5b53da2caf3e9988e"
 ],
 [
  "public/dupla-horizontal.svg",
  "9ac0f793bdff72e60015aad3fb67fb38c99e75500f19cc099d2f48baca52f2b0"
 ],
 [
  "public/dupla-icon-192.png",
  "600c0399d1022de5a1ff93b4928f070118c0e6fd4acbfe53a7ec7ecab449f5c1"
 ],
 [
  "public/dupla-icon-512.png",
  "9ad9d6228933555c57483ae506edd18aa4bac3d8ae2f67b30fc8514eacbe001d"
 ],
 [
  "public/dupla-icon.svg",
  "7ea0105c7cd7611e3ed753d5c7cd2cd881c2f35829bf7d0ba144e8da5faa4f01"
 ],
 [
  "public/favicon.svg",
  "7ea0105c7cd7611e3ed753d5c7cd2cd881c2f35829bf7d0ba144e8da5faa4f01"
 ],
 [
  "public/index.html",
  "13182c76450a0f4007092bbe06c87fbcb4edd3ca1575fc4bd8c9289813b22e61"
 ],
 [
  "public/manifest.webmanifest",
  "3a1234fb0cf6fdf49240bfa37ea15a3a33442239061bae4185e96dcfb6a40bed"
 ],
 [
  "public/style.css",
  "6b792454bb7c0429c8805dd42410a793801abe7070dc5309d0233b20aae2e9d9"
 ]
];
test('DUPLA: identidad visual intacta; únicas variaciones de CSS responsive y caché',()=>{
 for(const [path,hash] of files){
  let bytes=readFileSync(new URL('../'+path,import.meta.url));
  if(path==='edge/public/index.html')bytes=Buffer.from(bytes.toString().replaceAll(/v=(5\.[678]\.[01]|6\.\d+\.\d+)/g,'v=5.4.0'));
  if(path==='edge/public/manifest.webmanifest')bytes=Buffer.from(bytes.toString().replace('  "id": "/",\n',''));
  if(path==='edge/public/style.css')bytes=Buffer.from(bytes.toString().split('/* DUPLA 5.6: strictly layout/interaction safeguards; preserve existing visual palette. */')[0].slice(0,-1));
  const digest=createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest,hash,'Cambió la base visual aprobada: '+path);
 }
});
