// DUPLA · Finanzas de la cuenta compartida: movimientos (ingresos y gastos), presupuesto mensual por categoría,
// objetivos de ahorro y facturas pendientes. Los gastos reales de los proyectos (viajes, planes) también cuentan.
export const FIN_CATS={hogar:['Hogar','#2f6fd8'],comida:['Comida','#22a05a'],trabajo:['Trabajo y software','#7c4ddb'],ocio:['Ocio y viajes','#e04848'],bienestar:['Bienestar','#d6408a'],transporte:['Transporte','#e08a1e'],salud:['Salud','#14a3a3'],otros:['Otros','#7d8597'],ingreso:['Ingreso','#22a05a']};
export const FIN_TABLES=['fin_groups','fin_moves','fin_budgets','fin_goals','fin_bills','fin_settles','fin_project_settles'];
const OUT=Object.keys(FIN_CATS).filter(k=>k!=='ingreso'),ICONS=['plane','heart','lock','home','gift','star','camera','briefcase','sun','wallet'];
const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const ym=(y,m)=>{const d=new Date(Date.UTC(y,m,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
const lastDay=k=>{const [y,m]=k.split('-').map(Number);return k+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');};
const r2=n=>Math.round(n*100)/100;
// Gastos de los proyectos con su categoría de Finanzas. Reparto: half=a medias, payer=solo de quien paga, other=todo del otro, pNN=quien paga asume el NN %.
const PCAT="CASE e.category WHEN 'food' THEN 'comida' WHEN 'flights' THEN 'transporte' WHEN 'transport' THEN 'transporte' WHEN 'design' THEN 'trabajo' WHEN 'development' THEN 'trabajo' WHEN 'marketing' THEN 'trabajo' ELSE 'ocio' END";
// Gastos de plan: «para quién es» (vacío = a medias) se traduce al mismo reparto.
const PSPLIT="CASE WHEN e.for_user IS NULL THEN 'half' WHEN e.for_user=e.paid_by THEN 'payer' ELSE 'other' END";
const SPLIT=/^(half|payer|other|p[1-9]\d?)$/,share=s=>s==='payer'?1:s==='other'?0:/^p\d/.test(s||'')?Number(s.slice(1))/100:0.5;
export function addMonth(date){const [y,m,d]=date.split('-').map(Number),t=new Date(Date.UTC(y,m,1)),max=new Date(Date.UTC(y,m+1,0)).getUTCDate();return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,max)).padStart(2,'0')}`;}

export function createFinanzas(d){
 const {all,get,run,now,uid,respond,fail,readBody,requireText,choice,validDate,money,logFree,env,model}=d;
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Movimientos propios + gastos reales de los proyectos (solo lectura aquí: se editan en su proyecto).
 const moves=(from,to)=>[...all('SELECT m.*,us.name AS who FROM fin_moves m LEFT JOIN users us ON us.id=m.paid_by WHERE m.date BETWEEN ? AND ?',from,to),
  ...all(`SELECT e.id,'out' AS kind,e.actual AS amount,${PCAT} AS category,p.title||' · '||e.title AS title,substr(COALESCE(e.booked_at,e.created_at),1,10) AS date,e.paid_by,e.for_user,${PSPLIT} AS split,us.name AS who,p.id AS project_id FROM expenses e JOIN projects p ON p.id=e.project_id LEFT JOIN users us ON us.id=e.paid_by WHERE p.deleted_at IS NULL AND e.actual>0 AND substr(COALESCE(e.booked_at,e.created_at),1,10) BETWEEN ? AND ?`,from,to)];
 const sum=(xs,k)=>r2(xs.filter(x=>x.kind===k).reduce((a,x)=>a+Number(x.amount||0),0));
 function periods(period,t){const y=+t.slice(0,4),m=+t.slice(5,7)-1;
  if(period==='year')return {from:`${y}-01-01`,to:`${y}-12-31`,prev:[`${y-1}-01-01`,`${y-1}-12-31`],months:12,label:String(y),vs:String(y-1),
   series:Array.from({length:12},(_,i)=>({label:MES[i],from:`${ym(y,i)}-01`,to:lastDay(ym(y,i)),current:i===m}))};
  if(period==='quarter'){const q=Math.floor(m/3),start=ym(y,q*3),end=ym(y,q*3+2),ps=ym(y,q*3-3),pe=ym(y,q*3-1);
   return {from:start+'-01',to:lastDay(end),prev:[ps+'-01',lastDay(pe)],months:3,label:`${q+1}.º trimestre ${y}`,vs:'el trimestre anterior',
    series:Array.from({length:4},(_,i)=>{const s=ym(y,(q-3+i)*3),e=ym(y,(q-3+i)*3+2);return {label:`T${(((q-3+i)%4)+4)%4+1} ${s.slice(2,4)}`,from:s+'-01',to:lastDay(e),current:i===3};})};}
  const k=ym(y,m),pk=ym(y,m-1);
  return {from:k+'-01',to:lastDay(k),prev:[pk+'-01',lastDay(pk)],months:1,label:`${MESL[m][0].toUpperCase()+MESL[m].slice(1)} ${y}`,vs:MESL[(m+11)%12],
   series:Array.from({length:6},(_,i)=>{const s=ym(y,m-5+i);return {label:MES[+s.slice(5,7)-1],from:s+'-01',to:lastDay(s),current:i===5};})};}
 function summary(period){const t=today(),p=periods(period,t),cur=moves(p.from,p.to),prev=moves(...p.prev);
  const income=sum(cur,'in'),expense=sum(cur,'out'),limits=Object.fromEntries(all('SELECT category,monthly FROM fin_budgets').map(x=>[x.category,x.monthly]));
  const bills=all('SELECT * FROM fin_bills WHERE paid_at IS NULL ORDER BY due_date,title');
  const recent=moves('0000-01-01','9999-12-31').sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||''))).slice(0,6);
  return {period,label:p.label,vs:p.vs,from:p.from,to:p.to,today:t,
   kpis:{income,expense,saving:r2(income-expense),saving_pct:income>0?Math.round((income-expense)/income*100):null,income_prev:sum(prev,'in'),expense_prev:sum(prev,'out'),bills_pending:bills.length,bill_next:bills[0]?.due_date||null},
   series:p.series.map(s=>{const xs=moves(s.from,s.to);return {label:s.label,current:s.current,income:sum(xs,'in'),expense:sum(xs,'out')};}),
   budgets:OUT.map(c=>({category:c,label:FIN_CATS[c][0],color:FIN_CATS[c][1],limit:limits[c]?r2(limits[c]*p.months):0,monthly:limits[c]||0,spent:r2(cur.filter(x=>x.kind==='out'&&x.category===c).reduce((a,x)=>a+Number(x.amount),0))})).filter(b=>b.limit||b.spent),
   goals:all('SELECT * FROM fin_goals ORDER BY created_at'),bills,recent,debts:debts(),cats:FIN_CATS,icons:ICONS,...porPersona(cur,prev)};}

 // Bloque de cada uno: lo que gana (fijo y variable), lo que paga y lo que le toca de verdad según el reparto.
 function cuentaDe(id,xs,ids){const r={income:0,income_fixed:0,income_var:0,paid:0,share:0,fixed_out:0,cats:{}};
  for(const x of xs){const a=Number(x.amount)||0;if(x.kind==='in'){if(x.paid_by===id){r.income+=a;if(x.fixed)r.income_fixed+=a;else r.income_var+=a;}continue;}
   const p=x.paid_by;let mine;if(!p||!ids.includes(p))mine=x.for_user?(x.for_user===id?a:0):a/ids.length;else{const s=share(x.split);mine=p===id?a*s:a*(1-s);}
   if(p===id){r.paid+=a;if(x.fixed)r.fixed_out+=a;}r.share+=mine;if(mine>0)r.cats[x.category]=(r.cats[x.category]||0)+mine;}
  return r;}
 function porPersona(cur,prev){const users=all('SELECT id,name FROM users ORDER BY name'),ids=users.map(x=>x.id);
  const people=users.map(us=>{const c=cuentaDe(us.id,cur,ids),pv=cuentaDe(us.id,prev,ids);
   return {id:us.id,name:us.name,income:r2(c.income),income_fixed:r2(c.income_fixed),income_var:r2(c.income_var),paid:r2(c.paid),share:r2(c.share),fixed_out:r2(c.fixed_out),share_prev:r2(pv.share),income_prev:r2(pv.income),left:r2(c.income-c.share),
    top:Object.entries(c.cats).sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>({category:k,label:FIN_CATS[k]?.[0]||k,color:FIN_CATS[k]?.[1]||'#7d8597',amount:r2(v)}))};});
  const shared=cur.filter(x=>x.kind==='out'&&(!x.paid_by||x.split==='half')),groups=groupList();
  return {people,joint:{common:r2(shared.reduce((a,x)=>a+Number(x.amount||0),0)),common_count:shared.length,shared_income:r2(cur.filter(x=>x.kind==='in'&&!x.paid_by).reduce((a,x)=>a+Number(x.amount||0),0)),
   groups:groups.slice(0,4).map(g=>({id:g.id,title:g.title,icon:g.icon,color:g.color,total:g.total,count:g.count,owes:g.owes,start_date:g.start_date})),groups_total:r2(groups.reduce((a,g)=>a+(g.total||0),0))}};}
 // Análisis: primero hechos calculados (siempre ciertos); la IA solo los cuenta como una persona.
 const pct=(a,b)=>b>0?Math.round((a-b)/b*100):null;
 function hechos(s){const f=[],k=s.kpis;
  if(k.expense_prev>0){const v=pct(k.expense,k.expense_prev);if(v!==null&&Math.abs(v)>=5)f.push({tipo:v<0?'bien':'ojo',texto:`Gastáis un ${Math.abs(v)} % ${v<0?'menos':'más'} que en ${s.vs} (${eur(k.expense)} frente a ${eur(k.expense_prev)}).`});}
  if(k.income>0)f.push({tipo:k.saving>=0?'bien':'ojo',texto:k.saving>=0?`Ahorráis ${eur(k.saving)}, el ${k.saving_pct} % de lo que entra.`:`Este periodo sale ${eur(-k.saving)} más de lo que entra.`});
  for(const b of s.budgets){if(b.limit&&b.spent>b.limit)f.push({tipo:'ojo',texto:`${b.label} pasa del presupuesto: ${eur(b.spent)} de ${eur(b.limit)}.`});else if(b.limit&&b.spent>b.limit*0.85)f.push({tipo:'aviso',texto:`${b.label} va por el ${Math.round(b.spent/b.limit*100)} % del presupuesto.`});}
  const top=s.people.flatMap(p=>p.top.slice(0,1).map(t=>({p,t})));for(const {p,t} of top)if(t.amount>0)f.push({tipo:'info',texto:`Donde más se le va el dinero a ${p.name.split(' ')[0]} es ${t.label.toLowerCase()} (${eur(t.amount)}).`});
  for(const p of s.people){const v=pct(p.share,p.share_prev);if(p.share_prev>0&&v!==null&&v<=-15)f.push({tipo:'bien',texto:`${p.name.split(' ')[0]} ha recortado su gasto un ${-v} % respecto a ${s.vs}.`});if(p.income>0&&p.income_fixed===0)f.push({tipo:'idea',texto:`${p.name.split(' ')[0]} no tiene ingresos marcados como fijos: marcadlos para ver cuánto queda seguro cada mes.`});}
  if(k.bills_pending)f.push({tipo:'aviso',texto:`Tenéis ${k.bills_pending} ${k.bills_pending===1?'factura pendiente':'facturas pendientes'}${k.bill_next?`, la próxima el ${k.bill_next.split('-').reverse().join('/')}`:''}.`});
  if(s.debts?.owes)f.push({tipo:'info',texto:`Queda por saldar ${eur(s.debts.owes.amount)} entre vosotros.`});
  for(const g of s.goals){if(g.target>0&&g.saved<g.target){const falta=r2(g.target-g.saved);f.push({tipo:'idea',texto:`Para «${g.title}» faltan ${eur(falta)}; con ${eur(Math.ceil(falta/6))} al mes lo tenéis en medio año.`});}}
  if(!f.length)f.push({tipo:'info',texto:'Aún hay pocos movimientos este periodo. Apuntad ingresos y gastos y aquí veréis el análisis.'});
  return f.slice(0,10);}
 async function analisis(period){const s=summary(period),facts=hechos(s),key=JSON.stringify(facts);
  const cache=get("SELECT value FROM shared_settings WHERE key='fin_ai'");const c=cache?JSON.parse(cache.value):null;
  if(c&&c.key===key&&c.period===period)return {facts,text:c.text,generated:true,cached:true,label:s.label};
  if(!env?.AI)return {facts,text:null,generated:false,label:s.label};
  try{const r=await env.AI.run(env.AI_MODEL||model,{messages:[{role:'system',content:'Eres Dupla, la asesora financiera cercana de una pareja (Álvaro y Angie). Escribe en español de España, como una amiga que sabe de dinero: cálida, directa y concreta, sin tecnicismos ni frases hechas. Usa SOLO los datos que te doy; no inventes cifras. Formato: un párrafo corto de resumen (2-3 frases) y luego 3 a 5 consejos prácticos, cada uno en una línea que empiece por «- ». Felicita lo que va bien y di claramente dónde se puede mejorar. Sin markdown ni títulos.'},{role:'user',content:`Periodo: ${s.label}. Datos:\n${facts.map(x=>'- '+x.texto).join('\n')}\nIngresos ${eur(s.kpis.income)}, gastos ${eur(s.kpis.expense)}.\n${s.people.map(p=>`${p.name.split(' ')[0]}: gana ${eur(p.income)} (fijo ${eur(p.income_fixed)}), le corresponde gastar ${eur(p.share)}, ha pagado ${eur(p.paid)}.`).join('\n')}`}],max_tokens:700});
   const text=String(r.choices?.[0]?.message?.content||r.response||'').trim().slice(0,2500);if(!text)return {facts,text:null,generated:false,label:s.label};
   run("INSERT INTO shared_settings(key,value,updated_by,updated_at) VALUES('fin_ai',?,NULL,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",JSON.stringify({key,period,text}),now());
   return {facts,text,generated:true,label:s.label};}catch{return {facts,text:null,generated:false,label:s.label};}}

 function moveFields(b,prev={}){const kind=b.kind===undefined?prev.kind:choice(b.kind,['in','out']);
  return {kind,amount:b.amount===undefined?prev.amount:(money(b.amount)||fail(400,'El importe tiene que ser mayor que 0')),category:kind==='in'?'ingreso':choice(b.category===undefined?(prev.category==='ingreso'?'otros':prev.category):b.category,OUT),
   title:b.title===undefined?prev.title:requireText(b.title,'Concepto',160),date:b.date===undefined?prev.date:(validDate(b.date)||fail(400,'Pon la fecha')),
   paid_by:b.paid_by===undefined?(prev.paid_by||null):(b.paid_by?(get('SELECT id FROM users WHERE id=?',String(b.paid_by))?.id||fail(400,'Persona no válida')):null),
   group_id:b.group_id===undefined?(prev.group_id||null):(b.group_id?(get('SELECT id FROM fin_groups WHERE id=?',String(b.group_id))?.id||fail(404,'Carpeta no encontrada')):null),
   split:b.split===undefined?(prev.split||'half'):(SPLIT.test(String(b.split))?String(b.split):fail(400,'Reparto no válido')),
   fixed:b.fixed===undefined?(prev.fixed?1:0):(b.fixed?1:0)};}
 // ---- Carpetas (tipo Tricount) ----
 function groupItems(g){const own=all('SELECT m.*,us.name AS who FROM fin_moves m LEFT JOIN users us ON us.id=m.paid_by WHERE m.group_id=?',g.id);
  const proj=g.project_id?projRows(g.project_id):[];
  return [...own,...proj].sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||'')));}
 const projRows=id=>all(`SELECT e.id,'out' AS kind,e.actual AS amount,${PCAT} AS category,e.title,substr(COALESCE(e.booked_at,e.created_at),1,10) AS date,e.paid_by,us.name AS who,${PSPLIT} AS split,e.for_user,e.project_id,e.created_at FROM expenses e JOIN projects p ON p.id=e.project_id LEFT JOIN users us ON us.id=e.paid_by WHERE p.id=? AND p.deleted_at IS NULL AND e.actual>0`,id);
 function balance(items,settles){const users=all('SELECT id,name FROM users ORDER BY name'),ids=users.map(x=>x.id),z=()=>Object.fromEntries(ids.map(i=>[i,0])),paid=z(),cons=z(),net=z(),cats={},days={};let total=0,common=0;
  for(const x of items){if(x.kind!=='out')continue;const a=Number(x.amount)||0,p=x.paid_by;total+=a;cats[x.category]=(cats[x.category]||0)+a;days[x.date]=(days[x.date]||0)+a;
   if(!p||!(p in paid)){common+=a;if(x.for_user in cons)cons[x.for_user]+=a;else for(const i of ids)cons[i]+=a/ids.length;continue;}
   const s=share(x.split),o=ids.find(i=>i!==p);paid[p]+=a;cons[p]+=a*s;if(o){cons[o]+=a*(1-s);net[p]+=a*(1-s);net[o]-=a*(1-s);}}
  for(const s of settles){if(s.from_user in net)net[s.from_user]+=s.amount;if(s.to_user in net)net[s.to_user]-=s.amount;}
  const d=r2(net[ids[0]]||0),owes=ids.length===2&&Math.abs(d)>=0.01?{from:d>0?ids[1]:ids[0],to:d>0?ids[0]:ids[1],amount:Math.abs(d)}:null;
  return {total:r2(total),common:r2(common),count:items.length,owes,settled:r2(settles.reduce((a,x)=>a+x.amount,0)),people:users.map(x=>({id:x.id,name:x.name,paid:r2(paid[x.id]),share:r2(cons[x.id]),net:r2(net[x.id])})),
   cats:Object.entries(cats).map(([k,v])=>({category:k,label:FIN_CATS[k]?.[0]||k,color:FIN_CATS[k]?.[1]||'#7d8597',amount:r2(v)})).sort((x,y)=>y.amount-x.amount),
   days:Object.entries(days).sort(([x],[y])=>x.localeCompare(y)).map(([date,amount])=>({date,amount:r2(amount)}))};}
 // Lo que os debéis en total: carpetas (con sus pagos) y viajes o planes de pareja sin carpeta.
 // Pagos apuntados desde el propio viaje: cuentan igual tenga carpeta o no.
 const projSettles=id=>all('SELECT * FROM fin_project_settles WHERE project_id=? ORDER BY date DESC,created_at DESC',id);
 const fullSettles=g=>[...settlesOf(g.id),...(g.project_id?projSettles(g.project_id):[])];
 function debts(){const users=all('SELECT id FROM users ORDER BY name'),net=Object.fromEntries(users.map(x=>[x.id,0])),sources=[];let any=false;const add=(st,o)=>{any=true;for(const x of st.people)net[x.id]+=x.net;if(st.owes)sources.push({...o,owes:st.owes});};
  for(const g of all('SELECT * FROM fin_groups'))add(balance(groupItems(g),fullSettles(g)),{kind:'group',id:g.id,title:g.title});
  for(const p of all("SELECT p.id,p.title FROM projects p WHERE p.deleted_at IS NULL AND p.space='couple' AND p.id NOT IN (SELECT project_id FROM fin_groups WHERE project_id IS NOT NULL) AND EXISTS(SELECT 1 FROM expenses e WHERE e.project_id=p.id AND e.actual>0 AND e.paid_by IS NOT NULL)"))add(balance(projRows(p.id),projSettles(p.id)),{kind:'project',id:p.id,title:p.title});
  const a=users[0]?.id,b=users[1]?.id,d=r2(net[a]||0);return {owes:users.length===2&&Math.abs(d)>=0.01?{from:d>0?b:a,to:d>0?a:b,amount:Math.abs(d)}:null,sources:sources.sort((x,y)=>y.owes.amount-x.owes.amount).slice(0,5),trips:tripDebts(),any};}
 // Cada viaje o plan por separado: lo que queda, lo ya pagado y en qué estado está.
 function tripDebts(){return all("SELECT p.id,p.title,p.start_date FROM projects p WHERE p.deleted_at IS NULL AND p.space='couple' AND EXISTS(SELECT 1 FROM expenses e WHERE e.project_id=p.id AND e.actual>0 AND e.paid_by IS NOT NULL) ORDER BY COALESCE(p.start_date,p.created_at) DESC").map(p=>{const g=get('SELECT * FROM fin_groups WHERE project_id=?',p.id),paid=g?fullSettles(g):projSettles(p.id),st=g?balance(groupItems(g),paid):balance(projRows(p.id),paid),settled=r2(paid.reduce((a,x)=>a+x.amount,0));return {id:p.id,title:p.title,owes:st.owes,settled,status:st.owes?(settled>0?'partial':'pending'):(settled>0?'settled':'even')};}).filter(x=>x.status!=='even').sort((a,b)=>(b.owes?.amount||0)-(a.owes?.amount||0));}
 const groupRow=id=>get('SELECT g.*,p.title AS project_title FROM fin_groups g LEFT JOIN projects p ON p.id=g.project_id AND p.deleted_at IS NULL WHERE g.id=?',id);
 const settlesOf=id=>all('SELECT s.*,a.name AS from_name,b.name AS to_name FROM fin_settles s LEFT JOIN users a ON a.id=s.from_user LEFT JOIN users b ON b.id=s.to_user WHERE s.group_id=? ORDER BY s.date DESC,s.created_at DESC,s.rowid DESC',id);
 function groupDetail(id){const g=groupRow(id)||fail(404,'Carpeta no encontrada'),items=groupItems(g),settles=settlesOf(g.id);return {group:g,items,settles,stats:balance(items,fullSettles(g))};}
 function groupList(){return all('SELECT g.*,p.title AS project_title FROM fin_groups g LEFT JOIN projects p ON p.id=g.project_id AND p.deleted_at IS NULL ORDER BY COALESCE(g.start_date,substr(g.created_at,1,10)) DESC').map(g=>{const st=balance(groupItems(g),settlesOf(g.id));return {...g,total:st.total,count:st.count,owes:st.owes,people:st.people};});}
 function groupFields(b,p={}){const pid=b.project_id===undefined?(p.project_id||null):(b.project_id?(get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL",String(b.project_id))?.id||fail(404,'Viaje o plan no encontrado')):null);
  const proj=pid?get('SELECT title,start_date,end_date FROM projects WHERE id=?',pid):null;
  const f={title:b.title===undefined||(!String(b.title).trim()&&proj)?(p.title||proj?.title):requireText(b.title,'Nombre de la carpeta',120),icon:b.icon===undefined?(p.icon||'plane'):choice(b.icon,ICONS),color:b.color===undefined?(p.color||'#2f6fd8'):(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:fail(400,'Color no válido')),project_id:pid,
   start_date:b.start_date===undefined?(p.start_date||proj?.start_date||null):(validDate(b.start_date)||null),end_date:b.end_date===undefined?(p.end_date||proj?.end_date||null):(validDate(b.end_date)||null)};
  if(!f.title)fail(400,'Ponle un nombre a la carpeta');if(f.start_date&&f.end_date&&f.end_date<f.start_date)fail(400,'La fecha final es anterior a la inicial');return f;}
 const eur=n=>{const v=Number(n);return v.toLocaleString('es-ES',{minimumFractionDigits:Number.isInteger(v)?0:2,maximumFractionDigits:2,useGrouping:'always'})+' €';};

 async function route(req,res,url,u){const path=url.pathname;if(!path.startsWith('/api/finance'))return false;
  if(path==='/api/finance/insights'&&req.method==='GET'){respond(res,200,await analisis(choice(url.searchParams.get('period')||'month',['month','quarter','year'])));return true;}
  if(path==='/api/finance'&&req.method==='GET'){respond(res,200,summary(choice(url.searchParams.get('period')||'month',['month','quarter','year'])));return true;}
  if(path==='/api/finance/moves'&&req.method==='GET'){const t=today(),from=validDate(url.searchParams.get('from'))||`${+t.slice(0,4)-1}${t.slice(4)}`,to=validDate(url.searchParams.get('to'))||t;
   respond(res,200,{items:moves(from,to).sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||''))),from,to});return true;}
  const mv=path.match(/^\/api\/finance\/moves(?:\/([a-f0-9-]{36}))?$/);
  if(mv&&['POST','PATCH','DELETE'].includes(req.method)){const row=mv[1]?get('SELECT * FROM fin_moves WHERE id=?',mv[1])||fail(404,'Movimiento no encontrado'):null;if(!!row!==(req.method!=='POST'))fail(405,'Método no permitido');
   if(req.method==='DELETE'){run('DELETE FROM fin_moves WHERE id=?',row.id);logFree(u,'couple','borró un movimiento de Finanzas',`${row.title} · ${eur(row.amount)}`);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),f=moveFields(b,row||{kind:'out',category:'otros',date:today()});if(!row&&(f.amount===undefined||!f.title))fail(400,'Faltan el concepto o el importe');
   if(f.group_id&&f.kind!=='out')fail(400,'En una carpeta solo se apuntan gastos');
   const t=now(),g=f.group_id?groupRow(f.group_id):null;if(row)run('UPDATE fin_moves SET kind=?,amount=?,category=?,title=?,date=?,paid_by=?,group_id=?,split=?,fixed=?,updated_at=? WHERE id=?',f.kind,f.amount,f.category,f.title,f.date,f.paid_by,f.group_id,f.split,f.fixed,t,row.id);
   else run('INSERT INTO fin_moves(id,kind,amount,category,title,date,paid_by,group_id,split,fixed,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),f.kind,f.amount,f.category,f.title,f.date,f.paid_by,f.group_id,f.split,f.fixed,u.id,t,t);
   logFree(u,'couple',row?(g?`cambió un gasto de «${g.title}»`:'cambió un movimiento de Finanzas'):g?`apuntó un gasto en «${g.title}»`:f.kind==='in'?'apuntó un ingreso':'apuntó un gasto',`${f.title} · ${eur(f.amount)}`);respond(res,row?200:201,{ok:true});return true;}
  if(path==='/api/finance/groups'&&req.method==='GET'){respond(res,200,{items:groupList(),projects:all("SELECT p.id,p.title,p.start_date,p.end_date FROM projects p WHERE p.deleted_at IS NULL AND p.space='couple' AND p.id NOT IN (SELECT project_id FROM fin_groups WHERE project_id IS NOT NULL) ORDER BY COALESCE(p.start_date,p.created_at) DESC LIMIT 60")});return true;}
  const gr=path.match(/^\/api\/finance\/groups(?:\/([a-f0-9-]{36})(\/settle)?)?$/);
  if(gr){const row=gr[1]?groupRow(gr[1])||fail(404,'Carpeta no encontrada'):null;
   if(row&&!gr[2]&&req.method==='GET'){respond(res,200,groupDetail(row.id));return true;}
   if(gr[2]){if(req.method!=='POST')fail(405,'Método no permitido');const b=await readBody(req),st=balance(groupItems(row),fullSettles(row)),from=b.from?String(b.from):st.owes?.from,to=b.to?String(b.to):st.owes?.to;
    if(!from||!to||from===to||!get('SELECT 1 FROM users WHERE id=?',from)||!get('SELECT 1 FROM users WHERE id=?',to))fail(400,'No hay nada pendiente que saldar');const amount=b.amount===undefined?st.owes?.amount:money(b.amount);if(!(amount>0))fail(400,'El importe tiene que ser mayor que 0');
    run('INSERT INTO fin_settles(id,group_id,from_user,to_user,amount,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),row.id,from,to,r2(amount),validDate(b.date)||today(),u.id,now());
    const nm=id=>(get('SELECT name FROM users WHERE id=?',id)?.name||'').split(' ')[0];logFree(u,'couple',`saldó cuentas en «${row.title}»`,`${nm(from)} → ${nm(to)} · ${eur(amount)}`);respond(res,201,groupDetail(row.id));return true;}
   if(req.method==='DELETE'&&row){const n=get('SELECT COUNT(*) AS n FROM fin_moves WHERE group_id=?',row.id).n;run('DELETE FROM fin_moves WHERE group_id=?',row.id);run('DELETE FROM fin_groups WHERE id=?',row.id);logFree(u,'couple','borró una carpeta de gastos',`${row.title} · ${n} gasto${n===1?'':'s'}`);respond(res,200,{ok:true});return true;}
   if(req.method==='POST'&&!row||req.method==='PATCH'&&row){const f=groupFields(await readBody(req),row||{}),t=now();let id=row?.id;
    if(f.project_id&&f.project_id!==row?.project_id&&get('SELECT 1 FROM fin_groups WHERE project_id=?',f.project_id))fail(409,'Ese viaje ya tiene su carpeta');
    if(row)run('UPDATE fin_groups SET title=?,icon=?,color=?,project_id=?,start_date=?,end_date=?,updated_at=? WHERE id=?',f.title,f.icon,f.color,f.project_id,f.start_date,f.end_date,t,row.id);
    else{id=uid();run('INSERT INTO fin_groups(id,title,icon,color,project_id,start_date,end_date,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,f.title,f.icon,f.color,f.project_id,f.start_date,f.end_date,u.id,t,t);logFree(u,'couple','creó una carpeta de gastos',f.title);}
    respond(res,row?200:201,groupDetail(id));return true;}
   fail(405,'Método no permitido');}
  const pm=path.match(/^\/api\/finance\/projects\/([a-f0-9-]{36})\/settle$/);
  if(pm&&req.method==='POST'){const p=get("SELECT id,title FROM projects WHERE id=? AND deleted_at IS NULL AND space='couple'",pm[1])||fail(404,'Plan no encontrado'),g=get('SELECT * FROM fin_groups WHERE project_id=?',p.id),st=g?balance(groupItems(g),fullSettles(g)):balance(projRows(p.id),projSettles(p.id)),o=st.owes||fail(409,'No queda nada pendiente en este plan'),b=await readBody(req),amount=b.amount===undefined?o.amount:money(b.amount);if(!(amount>0)||amount>o.amount+.005)fail(400,'El importe no puede ser mayor que lo pendiente');
   run('INSERT INTO fin_project_settles(id,project_id,from_user,to_user,amount,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),p.id,o.from,o.to,r2(amount),validDate(b.date)||today(),u.id,now());logFree(u,'couple','apuntó un pago en',`${p.title}: ${r2(amount).toFixed(2).replace('.',',')} €`);respond(res,200,{ok:true});return true;}
  const pz=path.match(/^\/api\/finance\/project-settles\/([a-f0-9-]{36})$/);
  if(pz&&req.method==='DELETE'){if(!run('DELETE FROM fin_project_settles WHERE id=?',pz[1]).changes)fail(404,'Pago no encontrado');respond(res,200,{ok:true});return true;}
  const sm=path.match(/^\/api\/finance\/settles\/([a-f0-9-]{36})$/);
  if(sm&&req.method==='DELETE'){const x=get('SELECT * FROM fin_settles WHERE id=?',sm[1])||fail(404,'Pago no encontrado');run('DELETE FROM fin_settles WHERE id=?',x.id);respond(res,200,groupDetail(x.group_id));return true;}
  if(path==='/api/finance/budgets'&&req.method==='PUT'){const b=await readBody(req),l=b.limits&&typeof b.limits==='object'?b.limits:fail(400,'Faltan los límites');
   for(const c of OUT)if(l[c]!==undefined){const v=money(l[c]||0);if(v)run('INSERT INTO fin_budgets(category,monthly) VALUES(?,?) ON CONFLICT(category) DO UPDATE SET monthly=excluded.monthly',c,v);else run('DELETE FROM fin_budgets WHERE category=?',c);}
   respond(res,200,{ok:true});return true;}
  const gl=path.match(/^\/api\/finance\/goals(?:\/([a-f0-9-]{36}))?$/);
  if(gl&&['POST','PATCH','DELETE'].includes(req.method)){const row=gl[1]?get('SELECT * FROM fin_goals WHERE id=?',gl[1])||fail(404,'Objetivo no encontrado'):null;if(!!row!==(req.method!=='POST'))fail(405,'Método no permitido');
   if(req.method==='DELETE'){run('DELETE FROM fin_goals WHERE id=?',row.id);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),p=row||{},add=b.add===undefined?0:money(b.add);
   const f={title:b.title===undefined?p.title:requireText(b.title,'Objetivo',120),target:b.target===undefined?p.target:(money(b.target)||fail(400,'Pon cuánto queréis ahorrar')),saved:r2((b.saved===undefined?(p.saved||0):money(b.saved))+add),icon:b.icon===undefined?(p.icon||'star'):choice(b.icon,ICONS),color:b.color===undefined?(p.color||'#2f6fd8'):(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:fail(400,'Color no válido'))};
   if(!f.title||!f.target)fail(400,'Faltan el nombre o la cantidad objetivo');const t=now();
   if(row)run('UPDATE fin_goals SET title=?,target=?,saved=?,icon=?,color=?,updated_at=? WHERE id=?',f.title,f.target,f.saved,f.icon,f.color,t,row.id);else run('INSERT INTO fin_goals(id,title,target,saved,icon,color,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),f.title,f.target,f.saved,f.icon,f.color,u.id,t,t);
   if(add)logFree(u,'couple','aportó a un objetivo de ahorro',`${f.title} · +${eur(add)} (${eur(f.saved)} de ${eur(f.target)})`);else if(!row)logFree(u,'couple','creó un objetivo de ahorro',`${f.title} · ${eur(f.target)}`);
   respond(res,row?200:201,{ok:true});return true;}
  const bl=path.match(/^\/api\/finance\/bills(?:\/([a-f0-9-]{36}))?(\/pay)?$/);
  if(bl&&['POST','PATCH','DELETE'].includes(req.method)){const row=bl[1]?get('SELECT * FROM fin_bills WHERE id=?',bl[1])||fail(404,'Factura no encontrada'):null;if(!!row!==(req.method!=='POST'||!!bl[2]))fail(405,'Método no permitido');
   if(bl[2]){if(req.method!=='POST')fail(405,'Método no permitido');if(row.paid_at)fail(409,'Esta factura ya está pagada');const t=now(),d=today();
    run('INSERT INTO fin_moves(id,kind,amount,category,title,date,paid_by,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),'out',row.amount,row.category,row.title,d,u.id,u.id,t,t);
    if(row.repeat==='monthly')run('UPDATE fin_bills SET due_date=?,updated_at=? WHERE id=?',addMonth(row.due_date),t,row.id);else run('UPDATE fin_bills SET paid_at=?,updated_at=? WHERE id=?',t,t,row.id);
    logFree(u,'couple','pagó una factura',`${row.title} · ${eur(row.amount)}`);respond(res,200,{ok:true});return true;}
   if(req.method==='DELETE'){run('DELETE FROM fin_bills WHERE id=?',row.id);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),p=row||{};
   const f={title:b.title===undefined?p.title:requireText(b.title,'Factura',120),amount:b.amount===undefined?p.amount:(money(b.amount)||fail(400,'El importe tiene que ser mayor que 0')),category:b.category===undefined?(p.category||'hogar'):choice(b.category,OUT),due_date:b.due_date===undefined?p.due_date:(validDate(b.due_date)||fail(400,'Pon la fecha de pago')),repeat:b.repeat===undefined?(p.repeat||'none'):choice(b.repeat,['none','monthly'])};
   if(!f.title||!f.amount||!f.due_date)fail(400,'Faltan el nombre, el importe o la fecha');const t=now();
   if(row)run('UPDATE fin_bills SET title=?,amount=?,category=?,due_date=?,repeat=?,updated_at=? WHERE id=?',f.title,f.amount,f.category,f.due_date,f.repeat,t,row.id);else{run('INSERT INTO fin_bills(id,title,amount,category,due_date,repeat,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),f.title,f.amount,f.category,f.due_date,f.repeat,u.id,t,t);logFree(u,'couple','añadió una factura pendiente',`${f.title} · ${eur(f.amount)} · ${f.due_date.slice(8,10)}/${f.due_date.slice(5,7)}`);}
   respond(res,row?200:201,{ok:true});return true;}
  fail(404,'Ruta de finanzas no encontrada');}
 return {route,summary};
}
