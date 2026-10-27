import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {config,sendPush,isAllowedPushEndpoint} from '../edge/web-push.mjs';

test('Push: JWT VAPID signed cryptographically, scoped to destination and payload-free',async t=>{
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),pub=pair.publicKey.export({format:'jwk'}),privateJwk=pair.privateKey.export({format:'jwk'});
 const env={PUSH_VAPID_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'),PUSH_VAPID_PRIVATE_JWK:JSON.stringify(privateJwk),PUSH_VAPID_SUBJECT:'mailto:ops@example.test'};
 assert.equal(config(env),true);
 const previous=globalThis.fetch;let sent;
 globalThis.fetch=async(url,init)=>{sent={url,init};return new Response(null,{status:201})};
 t.after(()=>{globalThis.fetch=previous});
 const endpoint='https://fcm.googleapis.com/fcm/send/mock-subscription-id';
 const response=await sendPush(env,endpoint);
 assert.equal(response.ok,true);assert.equal(sent.url,endpoint);
 assert.equal(sent.init.body,undefined);
 assert.equal(sent.init.headers['Content-Length'],'0');
 const match=sent.init.headers.Authorization.match(/^vapid t=(.*), k=(.*)$/);
 assert(match);assert.equal(match[2],env.PUSH_VAPID_PUBLIC_KEY);
 const [header,payload,signature]=match[1].split('.');
 const content=JSON.parse(Buffer.from(payload,'base64url'));
 assert.equal(content.aud,'https://fcm.googleapis.com');
 assert.equal(content.sub,env.PUSH_VAPID_SUBJECT);
 assert(verify('sha256',Buffer.from(header+'.'+payload),{key:pair.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
});

test('Push: rejects unauthorised destinations and URL query exfiltration',()=>{
 for(const link of ['http://fcm.googleapis.com/fcm/send/test','https://fcm.googleapis.com.evil.test/fcm/send/test','https://fcm.googleapis.com/fcm/send/test?token=x','https://user:pass@web.push.apple.com/x'])assert(!isAllowedPushEndpoint(link),link);
});
