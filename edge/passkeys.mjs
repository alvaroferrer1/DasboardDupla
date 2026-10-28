// DUPLA · Passkeys (WebAuthn): entrar con Face ID, Touch ID, huella o Windows Hello. Sin librerías externas.
// Registro con attestation 'none'; se guarda solo la clave pública. Algoritmos: ES256 (-7) y RS256 (-257).
const enc=new TextEncoder();
export const b64u=bytes=>Buffer.from(bytes).toString('base64url');
export const fromB64u=s=>{if(typeof s!=='string'||!/^[A-Za-z0-9_-]*$/.test(s))throw Error('Dato WebAuthn no válido');return new Uint8Array(Buffer.from(s,'base64url'));};
const sha256=async b=>new Uint8Array(await crypto.subtle.digest('SHA-256',b));

// CBOR mínimo (lo que usan attestationObject y las claves COSE).
export function cbor(bytes){let i=0;const u8=bytes,dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
 const len=ai=>{if(ai<24)return ai;if(ai===24)return u8[i++];if(ai===25){const v=dv.getUint16(i);i+=2;return v;}if(ai===26){const v=dv.getUint32(i);i+=4;return v;}throw Error('CBOR no soportado');};
 const item=()=>{if(i>=u8.length)throw Error('CBOR truncado');const b=u8[i++],mt=b>>5,ai=b&31;
  if(mt===0)return len(ai);if(mt===1)return -1-len(ai);
  if(mt===2){const n=len(ai);const v=u8.slice(i,i+n);i+=n;if(v.length!==n)throw Error('CBOR truncado');return v;}
  if(mt===3){const n=len(ai);const v=new TextDecoder().decode(u8.slice(i,i+n));i+=n;return v;}
  if(mt===4){const n=len(ai),a=[];for(let k=0;k<n;k++)a.push(item());return a;}
  if(mt===5){const n=len(ai),m=new Map();for(let k=0;k<n;k++){const key=item();m.set(key,item());}return m;}
  if(mt===7){if(ai===20)return false;if(ai===21)return true;if(ai===22)return null;}
  throw Error('CBOR no soportado');};
 const v=item();return {value:v,end:i};}

export function parseAuthData(ad){if(ad.length<37)throw Error('authenticatorData corto');const flags=ad[32],signCount=new DataView(ad.buffer,ad.byteOffset+33,4).getUint32(0);
 const out={rpIdHash:ad.slice(0,32),up:!!(flags&1),uv:!!(flags&4),signCount};
 if(flags&64){const l=(ad[53]<<8)|ad[54];out.credId=ad.slice(55,55+l);const {value}=cbor(ad.slice(55+l));out.cose=value;}return out;}

export function coseToJwk(m){const kty=m.get(1),alg=m.get(3);
 if(kty===2&&alg===-7&&m.get(-1)===1)return {alg:-7,jwk:{kty:'EC',crv:'P-256',x:b64u(m.get(-2)),y:b64u(m.get(-3)),ext:true}};
 if(kty===3&&alg===-257)return {alg:-257,jwk:{kty:'RSA',n:b64u(m.get(-1)),e:b64u(m.get(-2)),alg:'RS256',ext:true}};
 throw Error('Tipo de clave no soportado por DUPLA');}

// ECDSA de WebAuthn llega en DER; WebCrypto quiere r||s de 32+32 bytes.
function derToRaw(der){let i=2;if(der[0]!==0x30)throw Error('Firma no válida');if(der[1]&0x80)i=2+(der[1]&0x7f);
 const part=()=>{if(der[i++]!==2)throw Error('Firma no válida');const n=der[i++];let v=der.slice(i,i+n);i+=n;while(v.length>32&&v[0]===0)v=v.slice(1);const o=new Uint8Array(32);o.set(v,32-v.length);return o;};
 const r=part(),s=part(),raw=new Uint8Array(64);raw.set(r);raw.set(s,32);return raw;}

function checkClient(cd,type,challenge,origins){const c=JSON.parse(new TextDecoder().decode(cd));
 if(c.type!==type)throw Error('Tipo de operación incorrecto');if(c.challenge!==challenge)throw Error('Desafío no válido o caducado');
 if(!origins.includes(c.origin))throw Error('Origen no permitido');return c;}

export async function verifyRegistration({clientDataJSON,attestationObject},{challenge,origins,rpId}){
 const cd=fromB64u(clientDataJSON);checkClient(cd,'webauthn.create',challenge,origins);
 const att=cbor(fromB64u(attestationObject)).value,ad=parseAuthData(att.get('authData'));
 if(b64u(ad.rpIdHash)!==b64u(await sha256(enc.encode(rpId))))throw Error('Dominio de la passkey incorrecto');
 if(!ad.up||!ad.uv)throw Error('Hace falta Face ID, huella o PIN del dispositivo');if(!ad.credId)throw Error('La passkey no trae credencial');
 const {alg,jwk}=coseToJwk(ad.cose);return {credId:b64u(ad.credId),alg,jwk,signCount:ad.signCount};}

export async function verifyAssertion({clientDataJSON,authenticatorData,signature},{challenge,origins,rpId,alg,jwk,signCount}){
 const cd=fromB64u(clientDataJSON);checkClient(cd,'webauthn.get',challenge,origins);
 const adb=fromB64u(authenticatorData),ad=parseAuthData(adb);
 if(b64u(ad.rpIdHash)!==b64u(await sha256(enc.encode(rpId))))throw Error('Dominio de la passkey incorrecto');
 if(!ad.up||!ad.uv)throw Error('Hace falta Face ID, huella o PIN del dispositivo');
 const data=new Uint8Array([...adb,...await sha256(cd)]),sig=fromB64u(signature);
 const ok=alg===-7?await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']),derToRaw(sig),data)
  :await crypto.subtle.verify({name:'RSASSA-PKCS1-v1_5'},await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']),sig,data);
 if(!ok)throw Error('La firma de la passkey no es válida');
 if(signCount&&ad.signCount&&ad.signCount<=signCount)throw Error('Passkey clonada o repetida: bórrala y crea otra');
 return {signCount:ad.signCount};}
