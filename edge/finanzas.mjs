// DUPLA · Finanzas de la cuenta compartida: movimientos (ingresos y gastos), presupuesto mensual por categoría,
// objetivos de ahorro y facturas pendientes. Los gastos reales de los proyectos (viajes, planes) también cuentan.
export const FIN_CATS={hogar:['Hogar','#2f6fd8'],comida:['Comida','#22a05a'],trabajo:['Trabajo y software','#7c4ddb'],ocio:['Ocio y viajes','#e04848'],bienestar:['Bienestar','#d6408a'],transporte:['Transporte','#e08a1e'],salud:['Salud','#14a3a3'],otros:['Otros','#7d8597'],ingreso:['Ingreso','#22a05a']};
export const FIN_TABLES=['fin_moves','fin_budgets','fin_goals','fin_bills'];
const OUT=Object.keys(FIN_CATS).filter(k=>k!=='ingreso'),ICONS=['plane','heart','lock','home','gift','star','camera','briefcase','sun','wallet'];
const MES=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],MESL=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const ym=(y,m)=>{const d=new Date(Date.UTC(y,m,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;};
const lastDay=k=>{const [y,m]=k.split('-').map(Number);return k+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0');};
const r2=n=>Math.round(n*100)/100;
export function addMonth(date){const [y,m,d]=date.split('-').map(Number),t=new Date(Date.UTC(y,m,1)),max=new Date(Date.UTC(y,m+1,0)).getUTCDate();return `${t.getUTCFullYear()}-${String(t.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(d,max)).padStart(2,'0')}`;}

export function createFinanzas(d){
 const {all,get,run,now,uid,respond,fail,readBody,requireText,choice,validDate,money,logFree}=d;
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // Movimientos propios + gastos reales de los proyectos (solo lectura aquí: se editan en su proyecto).
 const moves=(from,to)=>[...all('SELECT m.*,us.name AS who FROM fin_moves m LEFT JOIN users us ON us.id=m.paid_by WHERE m.date BETWEEN ? AND ?',from,to),
  ...all("SELECT e.id,'out' AS kind,e.actual AS amount,'ocio' AS category,p.title||' · '||e.title AS title,substr(COALESCE(e.booked_at,e.created_at),1,10) AS date,e.paid_by,us.name AS who,p.id AS project_id FROM expenses e JOIN projects p ON p.id=e.project_id LEFT JOIN users us ON us.id=e.paid_by WHERE p.deleted_at IS NULL AND e.actual>0 AND substr(COALESCE(e.booked_at,e.created_at),1,10) BETWEEN ? AND ?",from,to)];
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
   paid_by:b.paid_by===undefined?(prev.paid_by||null):(b.paid_by?(get('SELECT id FROM users WHERE id=?',String(b.paid_by))?.id||fail(400,'Persona no válida')):null)};}
 const eur=n=>Number(n).toLocaleString('es-ES',{maximumFractionDigits:2})+' €';

 async function route(req,res,url,u){const path=url.pathname;if(!path.startsWith('/api/finance'))return false;
  if(path==='/api/finance'&&req.method==='GET'){respond(res,200,summary(choice(url.searchParams.get('period')||'month',['month','quarter','year'])));return true;}
  if(path==='/api/finance/moves'&&req.method==='GET'){const t=today(),from=validDate(url.searchParams.get('from'))||`${+t.slice(0,4)-1}${t.slice(4)}`,to=validDate(url.searchParams.get('to'))||t;
   respond(res,200,{items:moves(from,to).sort((a,b)=>(b.date+(b.created_at||'')).localeCompare(a.date+(a.created_at||''))),from,to});return true;}
  const mv=path.match(/^\/api\/finance\/moves(?:\/([a-f0-9-]{36}))?$/);
  if(mv&&['POST','PATCH','DELETE'].includes(req.method)){const row=mv[1]?get('SELECT * FROM fin_moves WHERE id=?',mv[1])||fail(404,'Movimiento no encontrado'):null;if(!!row!==(req.method!=='POST'))fail(405,'Método no permitido');
   if(req.method==='DELETE'){run('DELETE FROM fin_moves WHERE id=?',row.id);logFree(u,'couple','borró un movimiento de Finanzas',`${row.title} · ${eur(row.amount)}`);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),f=moveFields(b,row||{kind:'out',category:'otros',date:today()});if(!row&&(f.amount===undefined||!f.title))fail(400,'Faltan el concepto o el importe');
   const t=now();if(row)run('UPDATE fin_moves SET kind=?,amount=?,category=?,title=?,date=?,paid_by=?,updated_at=? WHERE id=?',f.kind,f.amount,f.category,f.title,f.date,f.paid_by,t,row.id);
   else run('INSERT INTO fin_moves(id,kind,amount,category,title,date,paid_by,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),f.kind,f.amount,f.category,f.title,f.date,f.paid_by,u.id,t,t);
   logFree(u,'couple',row?'cambió un movimiento de Finanzas':f.kind==='in'?'apuntó un ingreso':'apuntó un gasto',`${f.title} · ${eur(f.amount)}`);respond(res,row?200:201,{ok:true});return true;}
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
