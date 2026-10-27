// Google Calendar OAuth2/PKCE and encrypted, per-account tokens.
import { createHash, randomBytes } from 'node:crypto';
const base64url=(data)=>Buffer.from(data).toString('base64url');
export const randomState=()=>base64url(randomBytes(32));
export const codeChallenge=(verifier)=>base64url(createHash('sha256').update(verifier).digest());
export function configured(env){return Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&String(env.INTEGRATION_ENCRYPTION_KEY||'').length>=32&&/^https:\/\//.test(env.PUBLIC_ORIGIN||''));}
export function authorizationUrl(env,state,verifier,kind='shared'){
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:env.PUBLIC_ORIGIN.replace(/\/$/,'')+'/api/google/callback',response_type:'code',scope:(kind==='personal'?['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events']:['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.owned']).join(' '),access_type:'offline',prompt:'consent',state,code_challenge:codeChallenge(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);
 return u.toString();
}
async function key(env){const secret=String(env.INTEGRATION_ENCRYPTION_KEY||'');if(secret.length<32)throw Error('INTEGRATION_ENCRYPTION_KEY debe tener 32 caracteres o más');const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
export async function encryptToken(env,data){const iv=randomBytes(12);const bytes=new TextEncoder().encode(JSON.stringify(data));const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),bytes);return `${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;}
export async function decryptToken(env,blob){const [iv,body]=String(blob||'').split('.');if(!iv||!body)throw Error('Token cifrado inválido');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url')},await key(env),Buffer.from(body,'base64url'));return JSON.parse(new TextDecoder().decode(plain));}
export async function tokenRequest(env,params){
 const auth=new URLSearchParams({...params,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET});
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:auth,signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('Google rechazó el intercambio OAuth (HTTP '+r.status+')');const json=await r.json();if(!json.access_token)throw Error('Google no devolvió un access_token');return json;
}
// Fixed Google API host and constrained paths: never accept remote URLs from clients.
export async function googleRequest(accessToken,method,path,body,headers={}){
 const ok=/^\/calendars(?:\/primary)?$/.test(path)||
  /^\/calendars\/[A-Za-z0-9._%+@-]+$/.test(path)||
  /^\/users\/me\/calendarList\/[A-Za-z0-9._%+@-]+$/.test(path)||
  /^\/users\/me\/calendarList(?:\?[A-Za-z0-9&%=+_.:-]+)?$/.test(path)||
  /^\/calendars\/[A-Za-z0-9._%+@-]+\/(?:events(?:\/[A-Za-z0-9_-]+)?|acl)(?:\?[A-Za-z0-9&%=+_.:-]+)?$/.test(path)||
  /^\/calendars\/primary\/events(?:\/[A-Za-z0-9_-]+)?(?:\?[A-Za-z0-9&%=+_.:-]+)?$/.test(path);
 if(!ok||!['GET','POST','PUT','PATCH','DELETE'].includes(method))throw Error('Ruta de Calendar no admitida');
 const r=await fetch('https://www.googleapis.com/calendar/v3'+path,{method,headers:{Authorization:`Bearer ${accessToken}`,...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
 if(!r.ok){const e=new Error('Google Calendar respondió HTTP '+r.status);e.statusCode=r.status;throw e;}
 if(r.status===204)return {ok:true};return await r.json();
}
export function validSharedCalendarId(id){return typeof id==='string'&&id.length>=3&&id.length<=250&&/^[A-Za-z0-9._@+-]+$/.test(id);}
export function validSharedEventId(id){return typeof id==='string'&&id.length>=1&&id.length<=180&&/^[A-Za-z0-9_-]+$/.test(id);}
export function normalizedSharedEvent(input){
 const title=String(input?.title||'').trim();
 if(!title||title.length>160)throw Error('Introduce un título de hasta 160 caracteres');
 const event_date=String(input?.date||'');
 const event_time=String(input?.time||'');
 const notes=String(input?.notes||'');const location=String(input?.location||'');
 if(notes.length>2000||location.length>220)throw Error('Descripción o lugar demasiado largo');
 const event_end=String(input?.end_time||'');
 return toGoogleEvent({title,event_date,event_time,event_end,notes,location});
}
export function toGoogleEvent(item){
 const title=String(item.title||'').slice(0,160);
 const description=String(item.notes||'').slice(0,2000);
 const location=String(item.location||'').slice(0,220);
 const day=String(item.event_date||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Fecha del plan inválida');
 const [year,month,calendarDay]=day.split('-').map(Number);
 const validDate=new Date(Date.UTC(year,month-1,calendarDay));
 if(validDate.getUTCFullYear()!==year||validDate.getUTCMonth()+1!==month||validDate.getUTCDate()!==calendarDay)throw Error('Fecha del plan inválida');
 const value={summary:title,description,location};
 if(item.event_time){
  const time=String(item.event_time);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Hora del plan inválida');
  // Google Calendar's timeZone handles Spanish DST and converts these wall times.
  // Compute the 1-hour end using calendar arithmetic so midnight crosses the date.
  const start=new Date(day+'T'+time+':00Z');
  const endTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.event_end||''))&&String(item.event_end)>time?String(item.event_end):'';
  const end=endTime?new Date(day+'T'+endTime+':00Z'):new Date(start.getTime()+60*60*1000);
  value.start={dateTime:day+'T'+time+':00',timeZone:'Europe/Madrid'};
  value.end={dateTime:end.toISOString().slice(0,19),timeZone:'Europe/Madrid'};
 } else {
  const next=new Date(Date.UTC(year,month-1,calendarDay+1));
  value.start={date:day};value.end={date:next.toISOString().slice(0,10)};
 }
 return value;
}
