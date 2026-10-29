// DUPLA · Finanzas de la cuenta compartida: movimientos (ingresos y gastos), presupuesto mensual por categoría,
// objetivos de ahorro y facturas pendientes. Los gastos reales de los proyectos (viajes, planes) también cuentan.
export const FIN_CATS={hogar:['Hogar','#2f6fd8'],comida:['Comida','#22a05a'],trabajo:['Trabajo y software','#7c4ddb'],ocio:['Ocio y viajes','#e04848'],bienestar:['Bienestar','#d6408a'],transporte:['Transporte','#e08a1e'],salud:['Salud','#14a3a3'],otros:['Otros','#7d8597'],ingreso:['Ingreso','#22a05a']};
export const FIN_TABLES=['fin_groups','fin_moves','fin_budgets','fin_goals','fin_bills','fin_settles'];
const OUT=Object.keys(FIN_CATS).filter(k=>k!=='ingreso'),ICONS=['plane','heart','lock','home','gift','star','camera','briefcase','sun','wallet'];
const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const ym=(y,m)=>{const d=new Date(Date.UTC(y,m,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
const lastDay=k=>{const [y,m]=k.split('-').map(Number);return k+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');};
const r2=n=>Math.round(n*100)/100;
// Gastos de los proyectos con su categoría de Finanzas. Reparto: half=a medias, payer=solo de quien paga, other=todo del otro, pNN=quien paga asume el NN %.
const PCAT="CASE e.category WHEN 'food' THEN 'comida' WHEN 'flights' THEN 'transporte' WHEN 'transport' THEN 'transporte' WHEN 'design' THEN 'trabajo' WHEN 'development' THEN 'trabajo' WHEN 'marketing' THEN 'trabajo' ELSE 'ocio' END";
const SPLIT=/^(half|payer|other|p[1-9]\d?)$/,share=s=>s==='payer'?1:s==='other'?0:/^p\d/.test(s||'')?Number(s.slice(1))/100:0.5;
export function addMonth(date){const [y,m,d]=date.split('-').map(Number),t=new Date(Date.UTC(y,m,1)),max=new Date(Date.UTC(y,m+1,0)).getUTCDate();return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,max)).padStart(2,'0')}`;}

export function createFinanzas(d){
 const {all,get,run,now,uid,respond,fail,readBody,requireText,choice,validDate,money,logFree}=d;
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Movimientos propios + gastos reales de los proyectos (solo lectura aquí: se editan en su proyecto).
 const moves=(from,to)=>[...all('SELECT m.*,us.name AS who FROM fin_moves m LEFT JOIN users us ON us.id=m.paid_by WHERE m.date BETWEEN ? AND ?',from,to),
  ...all(`SELECT e.id,'out' AS kind,e.actual AS amount,${PCAT} AS category,p.title||' · '||e.title AS title,substr(COALESCE(e.booked_at,e.created_at),1,10) AS date,e.paid_by,us.name AS who,p.id AS project_id FROM expenses e JOIN projects p ON p.id=e.project_id LEFT JOIN users us ON us.id=e.paid_by WHERE p.deleted_at IS NULL AND e.actual>0 AND substr(COALESCE(e.booked_at,e.created_at),1,10) BETWEEN ? AND ?`,from,to)];
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
   goals:all('SELECT * FROM fin_goals ORDER BY created_at'),bills,recent,cats:FIN_CATS,icons:ICONS};}
 function moveFields(b,prev={}){const kind=b.kind===undefined?prev.kind:choice(b.kind,['in','out']);
  return {kind,amount:b.amount===undefined?prev.amount:(money(b.amount)||fail(400,'El importe tiene que ser mayor que 0')),category:kind==='in'?'ingreso':choice(b.category===undefined?(prev.category==='ingreso'?'otros':prev.category):b.category,OUT),
   title:b.title===undefined?prev.title:requireText(b.title,'Concepto',160),date:b.date===undefined?prev.date:(validDate(b.date)||fail(400,'Pon la fecha')),
   paid_by:b.paid_by===undefined?(prev.paid_by||null):(b.paid_by?(get('SELECT id FROM users WHERE id=?',String(b.paid_by))?.id||fail(400,'Persona no válida')):null),
   group_id:b.group_id===undefined?(prev.group_id||null):(b.group_id?(get('SELECT id FROM fin_groups WHERE id=?',String(b.group_id))?.id||fail(404,'Carpeta no encontrada')):null),
   split:b.split===undefined?(prev.split||'half'):(SPLIT.test(String(b.split))?String(b.split):fail(400,'Reparto no válido'))};}
 // ---- Carpetas (tipo Tricount) ----
 function groupItems(g){const own=all('SELECT m.*,us.name AS who FROM fin_moves m LEFT JOIN users us ON us.id=m.paid_by WHERE m.group_id=?',g.id);
  const proj=g.project_id?all(`SELECT e.id,'out' AS kind,e.actual AS amount,${PCAT} AS category,e.title,substr(COALESCE(e.booked_at,e.created_at),1,10) AS date,e.paid_by,us.name AS who,'half' AS split,e.project_id,e.created_at FROM expenses e JOIN projects p ON p.id=e.project_id LEFT JOIN users us ON us.id=e.paid_by WHERE p.id=? AND p.deleted_at IS NULL AND e.actual>0`,g.project_id):[];
  return [...own,...proj].sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||'')));}
 function balance(items,settles){const users=all('SELECT id,name FROM users ORDER BY name'),ids=users.map(x=>x.id),z=()=>Object.fromEntries(ids.map(i=>[i,0])),paid=z(),cons=z(),net=z(),cats={},days={};let total=0,common=0;
  for(const x of items){if(x.kind!=='out')continue;const a=Number(x.amount)||0,p=x.paid_by;total+=a;cats[x.category]=(cats[x.category]||0)+a;days[x.date]=(days[x.date]||0)+a;
   if(!p||!(p in paid)){common+=a;for(const i of ids)cons[i]+=a/ids.length;continue;}
   const s=share(x.split),o=ids.find(i=>i!==p);paid[p]+=a;cons[p]+=a*s;if(o){cons[o]+=a*(1-s);net[p]+=a*(1-s);net[o]-=a*(1-s);}}
  for(const s of settles){if(s.from_user in net)net[s.from_user]+=s.amount;if(s.to_user in net)net[s.to_user]-=s.amount;}
  const d=r2(net[ids[0]]||0),owes=ids.length===2&&Math.abs(d)>=0.01?{from:d>0?ids[1]:ids[0],to:d>0?ids[0]:ids[1],amount:Math.abs(d)}:null;
  return {total:r2(total),common:r2(common),count:items.length,owes,settled:r2(settles.reduce((a,x)=>a+x.amount,0)),people:users.map(x=>({id:x.id,name:x.name,paid:r2(paid[x.id]),share:r2(cons[x.id]),net:r2(net[x.id])})),
   cats:Object.entries(cats).map(([k,v])=>({category:k,label:FIN_CATS[k]?.[0]||k,color:FIN_CATS[k]?.[1]||'#7d8597',amount:r2(v)})).sort((x,y)=>y.amount-x.amount),
   days:Object.entries(days).sort(([x],[y])=>x.localeCompare(y)).map(([date,amount])=>({date,amount:r2(amount)}))};}
 const groupRow=id=>get('SELECT g.*,p.title AS project_title FROM fin_groups g LEFT JOIN projects p ON p.id=g.project_id AND p.deleted_at IS NULL WHERE g.id=?',id);
 const settlesOf=id=>all('SELECT s.*,a.name AS from_name,b.name AS to_name FROM fin_settles s LEFT JOIN users a ON a.id=s.from_user LEFT JOIN users b ON b.id=s.to_user WHERE s.group_id=? ORDER BY s.date DESC,s.created_at DESC,s.rowid DESC',id);
 function groupDetail(id){const g=groupRow(id)||fail(404,'Carpeta no encontrada'),items=groupItems(g),settles=settlesOf(g.id);return {group:g,items,settles,stats:balance(items,settles)};}
 function groupList(){return all('SELECT g.*,p.title AS project_title FROM fin_groups g LEFT JOIN projects p ON p.id=g.project_id AND p.deleted_at IS NULL ORDER BY COALESCE(g.start_date,substr(g.created_at,1,10)) DESC').map(g=>{const st=balance(groupItems(g),settlesOf(g.id));return {...g,total:st.total,count:st.count,owes:st.owes,people:st.people};});}
 function groupFields(b,p={}){const pid=b.project_id===undefined?(p.project_id||null):(b.project_id?(get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL",String(b.project_id))?.id||fail(404,'Viaje o plan no encontrado')):null);
  const proj=pid?get('SELECT title,start_date,end_date FROM projects WHERE id=?',pid):null;
  const f={title:b.title===undefined||(!String(b.title).trim()&&proj)?(p.title||proj?.title):requireText(b.title,'Nombre de la carpeta',120),icon:b.icon===undefined?(p.icon||'plane'):choice(b.icon,ICONS),color:b.color===undefined?(p.color||'#2f6fd8'):(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:fail(400,'Color no válido')),project_id:pid,
   start_date:b.start_date===undefined?(p.start_date||proj?.start_date||null):(validDate(b.start_date)||null),end_date:b.end_date===undefined?(p.end_date||proj?.end_date||null):(validDate(b.end_date)||null)};
  if(!f.title)fail(400,'Ponle un nombre a la carpeta');if(f.start_date&&f.end_date&&f.end_date<f.start_date)fail(400,'La fecha final es anterior a la inicial');return f;}
 const eur=n=>Number(n).toLocaleString('es-ES',{maximumFractionDigits:2})+' €';

 async function route(req,res,url,u){const path=url.pathname;if(!path.startsWith('/api/finance'))return false;
  if(path==='/api/finance'&&req.method==='GET'){respond(res,200,summary(choice(url.searchParams.get('period')||'month',['month','quarter','year'])));return true;}
  if(path==='/api/finance/moves'&&req.method==='GET'){const t=today(),from=validDate(url.searchParams.get('from'))||`${+t.slice(0,4)-1}${t.slice(4)}`,to=validDate(url.searchParams.get('to'))||t;
   respond(res,200,{items:moves(from,to).sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||''))),from,to});return true;}
  const mv=path.match(/^\/api\/finance\/moves(?:\/([a-f0-9-]{36}))?$/);
  if(mv&&['POST','PATCH','DELETE'].includes(req.method)){const row=mv[1]?get('SELECT * FROM fin_moves WHERE id=?',mv[1])||fail(404,'Movimiento no encontrado'):null;if(!!row!==(req.method!=='POST'))fail(405,'Método no permitido');
   if(req.method==='DELETE'){run('DELETE FROM fin_moves WHERE id=?',row.id);logFree(u,'couple','borró un movimiento de Finanzas',`${row.title} · ${eur(row.amount)}`);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),f=moveFields(b,row||{kind:'out',category:'otros',date:today()});if(!row&&(f.amount===undefined||!f.title))fail(400,'Faltan el concepto o el importe');
   if(f.group_id&&f.kind!=='out')fail(400,'En una carpeta solo se apuntan gastos');
   const t=now(),g=f.group_id?groupRow(f.group_id):null;if(row)run('UPDATE fin_moves SET kind=?,amount=?,category=?,title=?,date=?,paid_by=?,group_id=?,split=?,updated_at=? WHERE id=?',f.kind,f.amount,f.category,f.title,f.date,f.paid_by,f.group_id,f.split,t,row.id);
   else run('INSERT INTO fin_moves(id,kind,amount,category,title,date,paid_by,group_id,split,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),f.kind,f.amount,f.category,f.title,f.date,f.paid_by,f.group_id,f.split,u.id,t,t);
   logFree(u,'couple',row?(g?`cambió un gasto de «${g.title}»`:'cambió un movimiento de Finanzas'):g?`apuntó un gasto en «${g.title}»`:f.kind==='in'?'apuntó un ingreso':'apuntó un gasto',`${f.title} · ${eur(f.amount)}`);respond(res,row?200:201,{ok:true});return true;}
  if(path==='/api/finance/groups'&&req.method==='GET'){respond(res,200,{items:groupList(),projects:all("SELECT p.id,p.title,p.start_date,p.end_date FROM projects p WHERE p.deleted_at IS NULL AND p.space='couple' AND p.id NOT IN (SELECT project_id FROM fin_groups WHERE project_id IS NOT NULL) ORDER BY COALESCE(p.start_date,p.created_at) DESC LIMIT 60")});return true;}
  const gr=path.match(/^\/api\/finance\/groups(?:\/([a-f0-9-]{36})(\/settle)?)?$/);
  if(gr){const row=gr[1]?groupRow(gr[1])||fail(404,'Carpeta no encontrada'):null;
   if(row&&!gr[2]&&req.method==='GET'){respond(res,200,groupDetail(row.id));return true;}
   if(gr[2]){if(req.method!=='POST')fail(405,'Método no permitido');const b=await readBody(req),st=balance(groupItems(row),settlesOf(row.id)),from=b.from?String(b.from):st.owes?.from,to=b.to?String(b.to):st.owes?.to;
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
