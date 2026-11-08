// Banco conectado (Enable Banking, PSD2): cada uno conecta su cuenta y los movimientos entran solos en Finanzas.
// Necesita ENABLE_BANKING_APP_ID y ENABLE_BANKING_KEY (clave privada PKCS#8 en PEM). Sin ellas, la pantalla explica cómo darse de alta.
const API='https://api.enablebanking.com';
const REGLAS=[['comida',/mercadona|carrefour|lidl|aldi|dia\b|eroski|alcampo|consum|supermerc|glovo|just eat|uber eats|restaur|bar\b|cafeter/i],['transporte',/renfe|metro|emt|uber|cabify|bolt|gasolin|repsol|cepsa|bp\b|galp|parking|peaje|ryanair|vueling|iberia|easyjet/i],['ocio',/netflix|spotify|hbo|max\b|disney|prime video|cine|teatro|steam|playstation|booking|airbnb|hotel/i],['salud',/farmacia|clinic|hospital|dentist|optica|sanitas|adeslas|asisa/i],['hogar',/iberdrola|endesa|naturgy|holaluz|aguas|canal de isabel|movistar|vodafone|orange|digi|masmovil|alquiler|comunidad|ikea|leroy/i],['bienestar',/gimnasio|gym|basic-fit|yoga|peluquer|estetica/i],['trabajo',/adobe|figma|github|google workspace|microsoft|notion|openai|anthropic|cloudflare|hosting|dominio/i]];
export const categoriaBanco=t=>{for(const [c,re] of REGLAS)if(re.test(t))return c;return 'otros';};
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64uTxt=s=>b64u(new TextEncoder().encode(s));

export function createBanco(d){
 const {env,all,get,run,now,uid,respond,fail,readBody,logFree}=d;
 const listo=()=>!!(env.ENABLE_BANKING_APP_ID&&env.ENABLE_BANKING_KEY);
 let clave=null;
 async function jwt(){if(!clave){const pem=String(env.ENABLE_BANKING_KEY).replace(/\\n/g,'\n').replace(/-----[^-]+-----/g,'').replace(/\s+/g,'');const der=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
   clave=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);}
  const t=Math.floor(Date.now()/1000),cuerpo=b64uTxt(JSON.stringify({typ:'JWT',alg:'RS256',kid:env.ENABLE_BANKING_APP_ID}))+'.'+b64uTxt(JSON.stringify({iss:'enablebanking.com',aud:'api.enablebanking.com',iat:t,exp:t+3600}));
  return cuerpo+'.'+b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',clave,new TextEncoder().encode(cuerpo)));}
 async function eb(path,opts={}){const r=await fetch(API+path,{...opts,headers:{Authorization:'Bearer '+await jwt(),'Content-Type':'application/json',...(opts.headers||{})},signal:AbortSignal.timeout(30000)});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(data.message||data.error||('El banco respondió '+r.status)),{status:r.status});return data;}
 const origen=()=>String(env.PUBLIC_ORIGIN||'').replace(/\/$/,'');
 const estado=()=>({configured:listo(),redirect:origen()+'/api/bank/callback',links:all('SELECT l.id,l.user_id,l.bank,l.accounts,l.valid_until,l.last_sync,l.last_error,l.created_at,us.name FROM bank_links l JOIN users us ON us.id=l.user_id ORDER BY l.created_at').map(l=>({...l,accounts:JSON.parse(l.accounts||'[]'),imported:get('SELECT COUNT(*) AS n FROM bank_tx WHERE link_id=?',l.id).n}))});
 // Importa los movimientos de una conexión. La referencia del banco evita duplicados aunque se sincronice mil veces.
 async function sincronizar(link){let nuevos=0;const desde=link.last_sync?new Date(Date.parse(link.last_sync)-5*864e5).toISOString().slice(0,10):new Date(Date.now()-90*864e5).toISOString().slice(0,10);
  for(const acc of JSON.parse(link.accounts||'[]')){let cont=null,vueltas=0;
   do{const q=new URLSearchParams({date_from:desde});if(cont)q.set('continuation_key',cont);const data=await eb(`/accounts/${encodeURIComponent(acc.uid)}/transactions?${q}`);
    for(const tx of data.transactions||[]){const amt=Math.abs(Number(tx.transaction_amount?.amount));if(!(amt>0))continue;
     const texto=[...(tx.remittance_information||[]),tx.creditor?.name,tx.debtor?.name].filter(Boolean).join(' · ').slice(0,160)||'Movimiento del banco',fecha=String(tx.booking_date||tx.value_date||tx.transaction_date||'').slice(0,10);
     const ref=link.id+':'+(tx.entry_reference||tx.transaction_id||`${fecha}|${amt}|${texto}`);if(!/^\d{4}-\d{2}-\d{2}$/.test(fecha)||get('SELECT 1 FROM bank_tx WHERE ref=?',ref))continue;
     const entra=tx.credit_debit_indicator==='CRDT',id=uid(),t=now();
     run("INSERT INTO fin_moves(id,kind,amount,category,title,date,paid_by,group_id,split,fixed,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,NULL,'payer',0,?,?,?)",id,entra?'in':'out',amt,entra?'ingreso':categoriaBanco(texto),texto,fecha,link.user_id,link.user_id,t,t);
     run('INSERT INTO bank_tx(ref,move_id,link_id,created_at) VALUES(?,?,?,?)',ref,id,link.id,t);nuevos++;}
    cont=data.continuation_key||null;}while(cont&&++vueltas<20);}
  run('UPDATE bank_links SET last_sync=?,last_error=NULL WHERE id=?',now(),link.id);return nuevos;}
 async function sincronizarTodo(){if(!listo())return 0;let n=0;for(const l of all('SELECT * FROM bank_links')){try{n+=await sincronizar(l);}catch(e){run('UPDATE bank_links SET last_error=? WHERE id=?',String(e.message||e).slice(0,200),l.id);}}return n;}
 // Vuelta del banco: llega sin cookie (navegación desde otro dominio), así que se identifica por el «state» de un solo uso.
 async function rutaPublica(req,res,url){if(url.pathname!=='/api/bank/callback'||req.method!=='GET')return false;
  const state=url.searchParams.get('state')||'',p=get('SELECT * FROM bank_pending WHERE state=?',state);run('DELETE FROM bank_pending WHERE state=? OR created_at<?',state,new Date(Date.now()-3600e3).toISOString());
  const volver=q=>{res.writeHead(302,{Location:'/conexiones?banco='+q,'Cache-Control':'no-store'});res.end('');return true;};
  if(!p||!listo())return volver('caducado');if(url.searchParams.get('error'))return volver('cancelado');
  try{const s=await eb('/sessions',{method:'POST',body:JSON.stringify({code:url.searchParams.get('code')||''})});
   const accounts=(s.accounts||[]).map(a=>({uid:a.uid,name:a.name||a.product||'Cuenta',iban:(a.account_id?.iban||'').replace(/.(?=.{4})/g,'•')}));
   const id=uid();run('INSERT INTO bank_links(id,user_id,session_id,bank,accounts,valid_until,created_at,last_sync,last_error) VALUES(?,?,?,?,?,?,?,NULL,NULL)',id,p.user_id,s.session_id,p.bank,JSON.stringify(accounts),s.access?.valid_until||null,now());
   const user=get('SELECT id,name FROM users WHERE id=?',p.user_id);let n=0;try{n=await sincronizar(get('SELECT * FROM bank_links WHERE id=?',id));}catch(e){run('UPDATE bank_links SET last_error=? WHERE id=?',String(e.message||e).slice(0,200),id);}
   if(user)logFree(user,'couple','conectó su banco',`${p.bank} · ${n} movimientos importados`);return volver('ok');}catch{return volver('error');}}
 async function route(req,res,url,u){const path=url.pathname;if(!path.startsWith('/api/bank'))return false;
  if(path==='/api/bank/status'&&req.method==='GET'){respond(res,200,estado());return true;}
  // Lo que depende de una clave del usuario: qué está listo y qué falta.
  if(path==='/api/bank/setup'&&req.method==='GET'){respond(res,200,{bank:listo(),email:!!env.RESEND_API_KEY,turn:!!(env.TURN_KEY_ID&&env.TURN_KEY_API_TOKEN),google:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),redirect:origen()+'/api/bank/callback'});return true;}
  if(!listo())fail(503,'Falta conectar Enable Banking: mirad la guía en Conexiones.');
  if(path==='/api/bank/banks'&&req.method==='GET'){const data=await eb('/aspsps?country=ES');respond(res,200,{banks:(data.aspsps||[]).map(a=>({name:a.name,logo:a.logo||'',beta:!!a.beta})).sort((a,b)=>a.name.localeCompare(b.name,'es'))});return true;}
  if(path==='/api/bank/connect'&&req.method==='POST'){const b=await readBody(req),bank=String(b.bank||'').trim().slice(0,120);if(!bank)fail(400,'Elige tu banco.');
   const state=uid()+uid().slice(0,8);run('INSERT INTO bank_pending(state,user_id,bank,created_at) VALUES(?,?,?,?)',state,u.id,bank,now());
   const r=await eb('/auth',{method:'POST',body:JSON.stringify({access:{valid_until:new Date(Date.now()+179*864e5).toISOString()},aspsp:{name:bank,country:'ES'},state,redirect_url:origen()+'/api/bank/callback',psu_type:'personal'})});
   respond(res,200,{url:r.url});return true;}
  if(path==='/api/bank/sync'&&req.method==='POST'){const n=await sincronizarTodo();respond(res,200,{...estado(),added:n});return true;}
  const del=path.match(/^\/api\/bank\/links\/([a-f0-9-]{36})$/);
  if(del&&req.method==='DELETE'){const l=get('SELECT * FROM bank_links WHERE id=?',del[1])||fail(404,'Conexión no encontrada');if(l.user_id!==u.id)fail(403,'Solo quien conectó el banco puede desconectarlo.');
   try{await eb('/sessions/'+encodeURIComponent(l.session_id),{method:'DELETE'});}catch{}run('DELETE FROM bank_links WHERE id=?',l.id);logFree(u,'couple','desconectó su banco',l.bank);respond(res,200,estado());return true;}
  fail(404,'Ruta no encontrada');}
 return {route,rutaPublica,sincronizarTodo};
}
