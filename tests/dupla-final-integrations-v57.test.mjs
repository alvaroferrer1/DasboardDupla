import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {tokenRequest} from '../edge/design-providers.mjs';

const root=new URL('../',import.meta.url);
const source=path=>readFileSync(new URL(path,root),'utf8');
const env={FIGMA_CLIENT_ID:'id',FIGMA_CLIENT_SECRET:'secret',CANVA_CLIENT_ID:'canva-id',CANVA_CLIENT_SECRET:'canva-secret'};

test('Figma: refresh uses documented separate endpoint, correct body and Basic auth',async t=>{
 const original=globalThis.fetch;let request;
 globalThis.fetch=async(url,options)=>{request={url,options};return new Response(JSON.stringify({access_token:'fresh',expires_in:3600}),{status:200,headers:{'content-type':'application/json'}})};
 t.after(()=>{globalThis.fetch=original});
 const response=await tokenRequest('figma',env,{grant_type:'refresh_token',refresh_token:'refresh-secret',redirect_uri:'https://not-sent'});
 assert.equal(response.access_token,'fresh');
 assert.equal(request.url,'https://api.figma.com/v1/oauth/refresh');
 assert.equal(new URLSearchParams(request.options.body).get('refresh_token'),'refresh-secret');
 assert.equal(new URLSearchParams(request.options.body).has('grant_type'),false);
 assert.equal(new URLSearchParams(request.options.body).has('redirect_uri'),false);
 assert.equal(request.options.headers.Authorization,'Basic '+Buffer.from('id:secret').toString('base64'));
 });

test('Figma: code exchange uses OAuth token endpoint and PKCE verifier',async t=>{
 const original=globalThis.fetch;let url,body;
 globalThis.fetch=async(u,o)=>{url=u;body=new URLSearchParams(o.body);return new Response(JSON.stringify({access_token:'new',refresh_token:'rotated'}),{status:200,headers:{'content-type':'application/json'}})};
 t.after(()=>{globalThis.fetch=original});
 await tokenRequest('figma',env,{grant_type:'authorization_code',code:'valid-code',code_verifier:'verifier',redirect_uri:'https://dupla.test/callback'});
 assert.equal(url,'https://api.figma.com/v1/oauth/token');assert.equal(body.get('code_verifier'),'verifier');
});

test('Canva: refresh retains grant_type and uses published token endpoint',async t=>{
 const original=globalThis.fetch;let url,body;
 globalThis.fetch=async(u,o)=>{url=u;body=new URLSearchParams(o.body);return new Response(JSON.stringify({access_token:'canva-new',refresh_token:'new-refresh'}),{status:200,headers:{'content-type':'application/json'}})};
 t.after(()=>{globalThis.fetch=original});
 await tokenRequest('canva',env,{grant_type:'refresh_token',refresh_token:'old-refresh'});
 assert.equal(url,'https://api.canva.com/rest/v1/oauth/token');assert.equal(body.get('grant_type'),'refresh_token');
});

test('Director General UI offers review, approve, discard and explicitly execute without automations',()=>{
 const client=source('edge/public/app.js');
 for(const action of ['guardian-review','guardian-approve','guardian-reject','guardian-execute']){
  assert(client.includes(`data-action="${action}"`)||client.includes(`case '${action}'`),`Missing ${action}`);
 }
 assert(client.includes("S.guardianActions=await api('/api/guardian/actions')"));
 assert(client.includes("operation==='execute'&&!window.confirm"));
 assert(client.includes("operation==='approve'&&!window.confirm"));
 const edge=source('edge/worker.mjs');assert(edge.includes("DUPLA_AUTOMATIONS_ENABLED==='true'"));
});

test('Mobile notifications guide and safe Worker body limit',()=>{
 const client=source('edge/public/app.js');
 assert.match(client,/Safari, pulsa Compartir/);
 assert.match(client,/subscription\.options\.applicationServerKey/);
 const edge=source('edge/worker.mjs');
 assert.match(edge,/maxBody=9\*1024\*1024/);
 assert.match(edge,/if\(total>maxBody\)/);
 const manifest=JSON.parse(source('edge/public/manifest.webmanifest'));
 assert.equal(manifest.id,'/');
});
