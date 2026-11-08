// Nosotros: pregunta del día con respuesta oculta, ánimo, notas, hábitos con racha, test y copia de seguridad.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApi } from '../edge/api.mjs';
function fixture(ai,extraEnv={}){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const storage={sql:{exec(sql,...b){if(!b.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}const st=db.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?st.all(...b):[];return {toArray:()=>rows,rowsWritten:reader?0:st.run(...b).changes};}},transactionSync(fn){db.exec('BEGIN');try{const x=fn();db.exec('COMMIT');return x;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const jobs=[];const app=createApi(storage,{SETUP_TOKEN:'A'.repeat(64),AI:ai,...extraEnv},{getWebSockets:()=>[],waitUntil(p){jobs.push(p);}});
 async function call(path,method='GET',body,cookie){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test'});if(cookie)headers.set(cookie.startsWith('Bearer ')?'authorization':'cookie',cookie);if(body!==undefined)headers.set('content-type','application/json');
  const request=new Request('https://dupla.test'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  let consumed=false,resolve,code=200;const h=new Headers(),promise=new Promise(r=>resolve=r);
  const req={method,headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){if(consumed)return;consumed=true;const bytes=await request.arrayBuffer();if(bytes.byteLength)yield Buffer.from(bytes);}};
  const res={headersSent:false,writableEnded:false,writeHead(n,hs={}){code=n;this.headersSent=true;for(const[k,v]of Object.entries(hs))h.set(k,v);},end(b){this.writableEnded=true;resolve(new Response(b??null,{status:code,headers:h}));}};
  try{await app.api(req,res,new URL(request.url));}catch(e){if(!res.headersSent)res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:String(e)}));}
  const response=await promise;const type=response.headers.get('content-type')||'';const data=type.includes('json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data,type};
 }
 async function loginAs(email,password){
  const headers=new Headers({origin:'https://dupla.test',host:'dupla.test','content-type':'application/json'});
  let cookie='';const res={headersSent:false,writableEnded:false,writeHead(n,hs={}){this.headersSent=true;cookie=String(hs['Set-Cookie']||hs['set-cookie']||'').split(';')[0];},end(){this.writableEnded=true;}};
  const body=Buffer.from(JSON.stringify({email,password}));
  await app.api({method:'POST',headers:Object.fromEntries(headers),socket:{remoteAddress:'127.0.0.1'},async *[Symbol.asyncIterator](){yield body;}},res,new URL('https://dupla.test/api/login'));
  assert.match(cookie,/^dos_session=/);return cookie;
 }
 async function login(){
  assert.equal((await call('/api/initialize','POST',{setup_token:'A'.repeat(64),email_a:'a@dupla.test',email_b:'b@dupla.test',password_a:'clave-super-a-1234',password_b:'clave-super-b-2345'})).status,201);
  return loginAs('a@dupla.test','clave-super-a-1234');
 }
 return {call,login,loginAs,db,jobs,app};
}

test('Nosotros: la respuesta del otro se ve solo al responder tú',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 let r=await f.call('/api/us','GET',undefined,a);assert.equal(r.status,200);assert.ok(r.data.question.length>5);assert.equal(r.data.answers.length,0);
 r=await f.call('/api/us/answer','POST',{answer:'Tu risa en Budapest'},b);assert.equal(r.status,200);
 r=await f.call('/api/us','GET',undefined,a);assert.equal(r.data.answers[0].hidden,true);assert.equal(r.data.answers[0].answer,undefined);
 r=await f.call('/api/us/answer','POST',{answer:'El viaje a Lisboa'},a);assert.equal(r.data.answers.length,2);assert.ok(r.data.answers.every(x=>x.answer));
 assert.equal((await f.call('/api/us/answer','POST',{answer:''},a)).status,400);
});

test('Nosotros: ánimo, notas privadas y permisos',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 assert.equal((await f.call('/api/us/checkin','POST',{mood:6},a)).status,400);
 let r=await f.call('/api/us/checkin','POST',{mood:4,note:'Cansado pero bien'},a);assert.equal(r.data.checkins[0].mood,4);
 r=await f.call('/api/us/checkin','POST',{mood:5},a);assert.equal(r.data.checkins.length,1);assert.equal(r.data.checkins[0].mood,5);
 r=await f.call('/api/us/notes','POST',{text:'Te quiero, que vaya bien la reunión'},a);assert.equal(r.status,201);
 const id=r.data.notes[0].id;
 assert.equal((await f.call('/api/us/notes/'+id+'/read','POST',{},a)).status,403);
 r=await f.call('/api/us/notes/'+id+'/read','POST',{},b);assert.ok(r.data.notes[0].read_at);
 assert.equal((await f.call('/api/us/notes/'+id,'DELETE',undefined,b)).status,403);
 assert.equal((await f.call('/api/us/notes/'+id,'DELETE',undefined,a)).data.notes.length,0);
});

test('Nosotros: hábito con racha de los dos, test del amor y copia',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 let r=await f.call('/api/us/habits','POST',{title:'Paseo de 20 minutos'},a);const h=r.data.habits[0];assert.equal(h.streak,0);
 await f.call('/api/us/habits/'+h.id+'/toggle','POST',{},a);r=await f.call('/api/us/habits/'+h.id+'/toggle','POST',{},b);
 assert.equal(r.data.habits[0].today.length,2);assert.equal(r.data.habits[0].streak,1);
 r=await f.call('/api/us/habits/'+h.id+'/toggle','POST',{},b);assert.equal(r.data.habits[0].streak,0);
 assert.equal((await f.call('/api/us/love','PUT',{result:'otro'},a)).status,400);
 r=await f.call('/api/us/love','PUT',{result:'tiempo',scores:{tiempo:7,palabras:3,regalos:99}},a);
 assert.equal(r.data.profiles[0].love_language,'tiempo');assert.equal(r.data.profiles[0].scores.regalos,20);
 await f.call('/api/us/answer','POST',{answer:'Copia'},a);
 const snap=await f.call('/api/snapshot','GET',undefined,a);assert.equal(snap.status,200);
 const data=JSON.parse(Buffer.isBuffer(snap.data)?snap.data.toString():JSON.stringify(snap.data)).data;
 assert.equal(data.us_habits.length,1);assert.equal(data.us_answers.length,1);assert.equal(data.us_profiles.length,1);
 r=await f.call('/api/us/habits/'+h.id,'DELETE',undefined,a);assert.equal(r.data.habits.length,0);
});

test('Finanzas: bloque de cada uno, conjunto y análisis con hechos reales',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const me=(await f.call('/api/me','GET',undefined,a)).data.user.id,other=(await f.call('/api/me','GET',undefined,b)).data.user.id;
 const hoy=new Date().toISOString().slice(0,10);
 assert.equal((await f.call('/api/finance/moves','POST',{kind:'in',amount:2000,title:'Nómina',date:hoy,paid_by:me,fixed:true},a)).status,201);
 await f.call('/api/finance/moves','POST',{kind:'in',amount:300,title:'Encargo',date:hoy,paid_by:me},a);
 await f.call('/api/finance/moves','POST',{kind:'out',amount:100,category:'comida',title:'Súper',date:hoy,paid_by:me,split:'half'},a);
 await f.call('/api/finance/moves','POST',{kind:'out',amount:40,category:'ocio',title:'Cine',date:hoy,paid_by:other,split:'payer'},b);
 const s=(await f.call('/api/finance?period=month','GET',undefined,a)).data;
 const pa=s.people.find(p=>p.id===me),pb=s.people.find(p=>p.id===other);
 assert.equal(pa.income,2300);assert.equal(pa.income_fixed,2000);assert.equal(pa.income_var,300);assert.equal(pa.paid,100);assert.equal(pa.share,50);
 assert.equal(pb.share,90);assert.equal(s.joint.common,100);
 const ins=(await f.call('/api/finance/insights?period=month','GET',undefined,a)).data;
 assert.ok(ins.facts.length>0);assert.equal(ins.generated,false);assert.ok(ins.facts.some(x=>/Ahorráis/.test(x.texto)));
});

test('Cuaderno: importa los dos cuadernos sin duplicar, regalos y metas, y cada uno edita lo suyo',async()=>{
 let data=null;const ASSETS={async fetch(r){return new URL(r.url).pathname==='/private/cuaderno.json'&&data?Response.json(data):new Response('',{status:404});}};
 const f=fixture(undefined,{ASSETS});const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const na=(await f.call('/api/me','GET',undefined,a)).data.user.name,nb=(await f.call('/api/me','GET',undefined,b)).data.user.name;
 const k=n=>n.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().split(' ')[0];
 const lists=n=>Array.from({length:11},(_,i)=>[{text:n+' respuesta '+(i+1)},{text:n+' segunda '+(i+1),detail:'detalle'}]);
 data={personas:{[k(na)]:lists('A'),[k(nb)]:lists('B')}};
 let r=await f.call('/api/us/book','GET',undefined,a);assert.equal(r.data.lists.length,11);assert.equal(r.data.imported,false);
 r=await f.call('/api/us/book/import','POST',{},a);assert.equal(r.status,200);assert.equal(r.data.added.entries,44);assert.equal(r.data.added.gifts,4);assert.equal(r.data.added.goals,4);
 r=await f.call('/api/us/book/import','POST',{},a);assert.equal(r.data.added.entries,0);assert.equal(r.data.added.gifts,0);assert.equal(r.data.imported,true);
 const items=(await f.call('/api/couple-items','GET',undefined,a)).data.items;assert.equal(items.filter(x=>x.kind==='gift').length,4);
 r=await f.call('/api/us/book','PUT',{list_no:8,pos:3,text:'Lomo saltado',detail:'el de mamá'},b);assert.ok(r.data.entries.some(e=>e.list_no===8&&e.pos===3&&e.text==='Lomo saltado'));
 r=await f.call('/api/us/book','PUT',{list_no:8,pos:3,text:''},b);assert.ok(!r.data.entries.some(e=>e.list_no===8&&e.pos===3));
 assert.equal((await f.call('/api/us/book','PUT',{list_no:12,pos:1,text:'x'},a)).status,400);
 const snap=await f.call('/api/snapshot','GET',undefined,a);const d=JSON.parse(Buffer.isBuffer(snap.data)?snap.data.toString():JSON.stringify(snap.data)).data;assert.equal(d.us_book.length,44);
});

test('Chat con Dupla: la llamada escrita como texto se ejecuta y el razonamiento en inglés no llega a la persona',async()=>{
 const steps=[{response:'analysis The user wants to recall anniversary. Let us call it.<|end|><|start|>assistant<|channel|>commentary to=functions.listar_proyectos <|constrain|>json<|message|>{}<|call|>'},
  {response:'The user asked about projects. We should answer that they have one project and maybe suggest.'},
  {response:'Tenéis un proyecto en marcha: el viaje a Budapest.'}];
 const seen=[];const ai={async run(model,input){seen.push(input.messages.at(-1));const s=steps.shift();if(!s)throw Error('sin más pasos');return s;}};
 const f=fixture(ai);const c=await f.login();
 const r=await f.call('/api/agent','POST',{message:'¿Qué proyectos tenemos?',scope:'couple'},c);
 assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(r.data.message.content,'Tenéis un proyecto en marcha: el viaje a Budapest.');
 assert.ok(seen.some(m=>m.role==='tool'),'la herramienta se ejecutó');assert.ok(!/analysis|<\|/.test(r.data.message.content));
});

test('Banco: conecta con Enable Banking firmando, importa sin duplicar, categoriza y el state no se reutiliza',async()=>{
 const {generateKeyPairSync,createVerify}=await import('node:crypto');const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
 const calls=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,opts={})=>{const u=new URL(String(url));if(u.host!=='api.enablebanking.com')return original(url,opts);const auth=String(opts.headers?.Authorization||'');const [h,p,sig]=auth.slice(7).split('.');
  const ok=createVerify('RSA-SHA256').update(h+'.'+p).verify(publicKey,Buffer.from(sig.replace(/-/g,'+').replace(/_/g,'/'),'base64'));calls.push({path:u.pathname,ok,kid:JSON.parse(Buffer.from(h,'base64url')).kid});
  if(u.pathname==='/auth')return Response.json({url:'https://banco.test/login'});
  if(u.pathname==='/sessions')return Response.json({session_id:'ses-1',accounts:[{uid:'acc-1',name:'Cuenta nómina',account_id:{iban:'ES9121000418450200051332'}}],access:{valid_until:'2027-05-01T00:00:00Z'}});
  if(u.pathname==='/accounts/acc-1/transactions')return Response.json({transactions:[{entry_reference:'t1',booking_date:'2026-11-03',transaction_amount:{amount:'42.30',currency:'EUR'},credit_debit_indicator:'DBIT',remittance_information:['MERCADONA ZARAGOZA']},{entry_reference:'t2',booking_date:'2026-11-01',transaction_amount:{amount:'1900',currency:'EUR'},credit_debit_indicator:'CRDT',remittance_information:['NOMINA OCTUBRE']},{entry_reference:'t3',booking_date:'2026-11-04',transaction_amount:{amount:'12.99',currency:'EUR'},credit_debit_indicator:'DBIT',creditor:{name:'Netflix'}}]});
  return Response.json({},{status:404});};
 try{
  const f=fixture(undefined,{ENABLE_BANKING_APP_ID:'app-123',ENABLE_BANKING_KEY:privateKey,PUBLIC_ORIGIN:'https://dupla.test'});const a=await f.login();
  let r=await f.call('/api/bank/status','GET',undefined,a);assert.equal(r.data.configured,true);assert.equal(r.data.redirect,'https://dupla.test/api/bank/callback');
  r=await f.call('/api/bank/connect','POST',{bank:'BBVA'},a);assert.equal(r.data.url,'https://banco.test/login');assert.ok(calls.every(c=>c.ok&&c.kid==='app-123'),'JWT firmado con la clave y el id de la app');
  const state=f.db.prepare('SELECT state FROM bank_pending').get().state;
  r=await f.call('/api/bank/callback?code=abc&state='+state,'GET');assert.equal(r.status,302);
  const moves=f.db.prepare("SELECT kind,amount,category,title FROM fin_moves ORDER BY amount").all();assert.equal(moves.length,3);
  assert.deepEqual(moves.map(m=>m.category),['ocio','comida','ingreso']);
  r=await f.call('/api/bank/sync','POST',{},a);assert.equal(r.data.added,0);assert.equal(r.data.links[0].imported,3);assert.match(r.data.links[0].accounts[0].iban,/•+1332$/);
  r=await f.call('/api/bank/callback?code=abc&state='+state,'GET');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM bank_links').get().n,1,'el state no sirve dos veces');
  const b=await f.loginAs('b@dupla.test','clave-super-b-2345');const lid=f.db.prepare('SELECT id FROM bank_links').get().id;assert.equal((await f.call('/api/bank/links/'+lid,'DELETE',undefined,b)).status,403,'solo quien conectó lo desconecta');assert.equal((await f.call('/api/bank/links/'+lid,'DELETE',undefined,a)).data.links.length,0);
 }finally{globalThis.fetch=original;}
});

test('Banco: sin claves la pantalla explica qué falta y no llama a nadie',async()=>{
 const f=fixture();const a=await f.login();const r=await f.call('/api/bank/status','GET',undefined,a);assert.equal(r.data.configured,false);
 assert.equal((await f.call('/api/bank/connect','POST',{bank:'BBVA'},a)).status,503);
});

test('Finanzas 2: facturas de cada uno, fijos y últimos por persona, análisis por ámbito con acciones y pregunta',async()=>{
 const f=fixture();const a=await f.login();const b=await f.loginAs('b@dupla.test','clave-super-b-2345');
 const me=(await f.call('/api/me','GET',undefined,a)).data.user.id,other=(await f.call('/api/me','GET',undefined,b)).data.user.id,hoy=new Date().toISOString().slice(0,10);
 await f.call('/api/finance/moves','POST',{kind:'in',amount:1800,title:'Nómina',date:hoy,paid_by:other,fixed:true},b);
 await f.call('/api/finance/moves','POST',{kind:'out',amount:60,category:'ocio',title:'Cine',date:hoy,paid_by:other,split:'payer'},b);
 assert.equal((await f.call('/api/finance/bills','POST',{title:'Gimnasio',amount:35,due_date:hoy,owner:other},a)).status,201);
 assert.equal((await f.call('/api/finance/bills','POST',{title:'Luz',amount:50,due_date:hoy},a)).status,201);
 let s=(await f.call('/api/finance?period=month','GET',undefined,a)).data;const pb=s.people.find(p=>p.id===other);
 assert.equal(pb.fixed[0].title,'Nómina');assert.equal(pb.recent.length,2);assert.equal(pb.bills[0].title,'Gimnasio');assert.equal(s.joint.bills[0].title,'Luz');
 await f.call('/api/finance/bills/'+pb.bills[0].id+'/pay','POST',{},a);
 const mv=f.db.prepare("SELECT paid_by,split FROM fin_moves WHERE title='Gimnasio'").get();assert.equal(mv.paid_by,other);assert.equal(mv.split,'payer');
 const ip=(await f.call('/api/finance/insights?period=month&who='+other,'GET',undefined,a)).data;assert.ok(ip.facts.some(x=>x.action));assert.ok(ip.facts.some(x=>/le quedan|gasta/.test(x.texto)));
 const ij=(await f.call('/api/finance/insights?period=month&who=joint','GET',undefined,a)).data;assert.ok(ij.facts.some(x=>x.action?.do==='pay'));
 assert.equal((await f.call('/api/finance/insights?who=nadie','GET',undefined,a)).status,400);
 const q=(await f.call('/api/finance/ask','POST',{question:'¿Cómo ahorramos más?'},a)).data;assert.equal(q.generated,false);assert.match(q.answer,/veo/);
});
