// Payload-free VAPID Web Push. Service worker displays a generic message only;
// no personal project data, email, cookies or API keys are sent to push providers.
const b64url=x=>Buffer.from(x).toString('base64url');
const msg=s=>new TextEncoder().encode(s);
export function isAllowedPushEndpoint(value){
 try{
  const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search)return false;
  const allowed=u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com'||u.hostname==='web.push.apple.com'||u.hostname.endsWith('.push.apple.com');
  return allowed&&u.pathname.length>=10&&u.pathname.length<1500;
 }catch{return false;}
}
export function config(env){
 try{
  const k=JSON.parse(env.PUSH_VAPID_PRIVATE_JWK||'{}');return !!(env.PUSH_VAPID_PUBLIC_KEY&&/^(mailto:|https:\/\/)/.test(env.PUSH_VAPID_SUBJECT||'')&&k.kty==='EC'&&k.crv==='P-256'&&k.x&&k.y&&k.d);
 }catch{return false;}
}
// RFC 8291 (aes128gcm): el contenido va cifrado de extremo a extremo; Apple/Google solo ven bytes opacos.
const fromB64=s=>new Uint8Array(Buffer.from(String(s),'base64url'));
const concat=(...a)=>{const out=new Uint8Array(a.reduce((n,x)=>n+x.length,0));let o=0;for(const x of a){out.set(x,o);o+=x.length;}return out;};
async function hkdf(salt,ikm,info,len){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8));}
export function validKeys(keys){try{return fromB64(keys?.p256dh).length===65&&fromB64(keys.p256dh)[0]===4&&fromB64(keys?.auth).length===16;}catch{return false;}}
// testing: {salt, asKeys} permiten fijar valores para comprobar contra una implementación independiente.
export async function encryptPayload(keys,plaintext,testing={}){
 const uaPublic=fromB64(keys.p256dh),authSecret=fromB64(keys.auth);
 const as=testing.asKeys||await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const asPublic=new Uint8Array(await crypto.subtle.exportKey('raw',as.publicKey));
 const uaKey=await crypto.subtle.importKey('raw',uaPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},as.privateKey,256));
 const ikm=await hkdf(authSecret,shared,concat(msg('WebPush: info\0'),uaPublic,asPublic),32);
 const salt=testing.salt||crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(salt,ikm,msg('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(salt,ikm,msg('Content-Encoding: nonce\0'),12);
 const key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,concat(msg(plaintext),new Uint8Array([2]))));
 const rs=new Uint8Array(4);new DataView(rs.buffer).setUint32(0,4096);
 return concat(salt,rs,new Uint8Array([asPublic.length]),asPublic,cipher);
}
// payload opcional: {title, body, path, tag}. Sin claves del dispositivo se envía el aviso genérico de siempre.
export async function sendPush(env,endpoint,keys=null,payload=null,urgency='normal'){
 if(!config(env))throw Error('La firma VAPID no está configurada');
 if(!isAllowedPushEndpoint(endpoint))throw Error('Servicio Push no autorizado');
 const u=new URL(endpoint);
 const header=b64url(msg(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const claims=b64url(msg(JSON.stringify({aud:u.origin,exp:Math.floor(Date.now()/1000)+3600,sub:env.PUSH_VAPID_SUBJECT})));
 const data=header+'.'+claims;
 const jwk=JSON.parse(env.PUSH_VAPID_PRIVATE_JWK);
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const signature=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,msg(data)));
 const token=data+'.'+b64url(signature);
 const headers={Authorization:'vapid t='+token+', k='+env.PUSH_VAPID_PUBLIC_KEY,TTL:'86400',Urgency:urgency==='high'?'high':'normal'};let body;
 if(payload&&validKeys(keys)){body=await encryptPayload(keys,JSON.stringify(payload));Object.assign(headers,{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Content-Length':String(body.length)});}else headers['Content-Length']='0';
 const res=await fetch(endpoint,{method:'POST',headers,body,signal:AbortSignal.timeout(15000)});
 return {ok:res.ok,status:res.status,remove:res.status===404||res.status===410};
}
