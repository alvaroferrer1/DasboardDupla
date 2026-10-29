// DUPLA 6: preferencias, datos de viaje, portada del destino, tiempo y agente Dupla (Workers AI).
// El agente solo LEE directamente; cualquier cambio vuelve como propuesta que la persona confirma
// y que el navegador ejecuta con la API normal (mismas validaciones, actividad y avisos).
const UA={'User-Agent':'DUPLA/6 (app privada de pareja; https://dos-espacios-compartido.dos-espacios-ferris.workers.dev)'};
const oneOf=list=>v=>list.includes(v),bool=v=>typeof v==='boolean',subset=list=>v=>Array.isArray(v)&&v.length<=list.length&&new Set(v).size===v.length&&v.every(x=>list.includes(x));
const COLORS=['indigo','rose','emerald','amber','sky','violet'];
export const NOTIFY_TYPES=['events','tasks','projects','comments','trip_reminders','budget','ideas'];
const PREF_KEYS={home_summary:subset(['trip','date','task','idea']),agent_scope:oneOf(['all','work','couple']),
 theme:oneOf(['light','dark','system']),accent:oneOf(['indigo','violet','sky','emerald','coral','amber']),
 notify_types:subset(NOTIFY_TYPES),reminder_lead:oneOf(['same_day','day_before','both']),
 calendar_view:oneOf(['month','week','agenda']),week_start:oneOf(['monday','sunday']),
 pdf_cover:bool,pdf_expenses:bool,pdf_notes:bool,pdf_activity:bool,
 default_color_work:oneOf(COLORS),default_color_couple:oneOf(COLORS),home_show_work:bool,home_show_couple:bool,daily_summary:bool,daily_calendar:bool,agent_alerts:bool,cal_color:oneOf(['lavanda','rosa','menta','melocoton','celeste','limon'])};
// Compartido por los dos (no por persona).
const SHARED_KEYS={couple_since:v=>v===''||/^\d{4}-\d{2}-\d{2}$/.test(v),home_summary:subset(['trip','date','task','idea'])};
const WEATHER={0:'Despejado',1:'Casi despejado',2:'Parcialmente nuboso',3:'Nublado',45:'Niebla',48:'Niebla',51:'Llovizna',53:'Llovizna',55:'Llovizna',61:'Lluvia débil',63:'Lluvia',65:'Lluvia fuerte',71:'Nieve débil',73:'Nieve',75:'Nieve fuerte',80:'Chubascos',81:'Chubascos',82:'Chubascos fuertes',95:'Tormenta',96:'Tormenta con granizo',99:'Tormenta con granizo'};
const EXPENSE_CATS=['general','design','development','marketing','transport','stay','food','activities','other'];
export const AGENT_MODEL='@cf/openai/gpt-oss-120b',VISION_MODEL='@cf/meta/llama-4-scout-17b-16e-instruct';
// Catálogo de conexiones (inventario 0160-0165 y 0026). oauth: autorización real; link: solo enlace.
export const PROVIDERS={google_calendar:{name:'Google Calendar',oauth:true,hosts:['calendar.google.com']},google_drive:{name:'Google Drive',oauth:false,hosts:['drive.google.com','docs.google.com']},figma:{name:'Figma',oauth:true,hosts:['figma.com','www.figma.com']},canva:{name:'Canva',oauth:true,hosts:['canva.com','www.canva.com']},github:{name:'GitHub',oauth:false,hosts:['github.com']},stitch:{name:'Stitch',oauth:false,hosts:['stitch.withgoogle.com']},other:{name:'Otra herramienta',oauth:false,hosts:null}};

// Calendario compartido ya creado por vosotros (R0019/R0251): DUPLA no crea otro.
export const SHARED_CALENDAR_ID='1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group.calendar.google.com';
export function createV6(d){
 const {env,all,get,run,now,uid,saveFile,readFile,fileExists,removeFile,respond,fail,readBody,requireText,optional,choice,validDate,money,project,projectList,logChange,logFree}=d;
 const ago=ms=>Date.now()-ms;
 function cached(kind,query,maxAge){const row=get('SELECT json,fetched_at FROM place_cache WHERE kind=? AND query=?',kind,query);return row&&ago(row.fetched_at)<maxAge?JSON.parse(row.json):null;}
 function store(kind,query,value){run('INSERT INTO place_cache(kind,query,json,fetched_at) VALUES(?,?,?,?) ON CONFLICT(kind,query) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at',kind,query,JSON.stringify(value),Date.now());return value;}
 const norm=q=>String(q||'').trim().toLowerCase().replace(/\s+/g,' ');
 const getShared=k=>{const r=get('SELECT value FROM shared_settings WHERE key=?',k);return r?JSON.parse(r.value):null;};
 const setShared=(k,v,by)=>run('INSERT INTO shared_settings(key,value,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at',k,JSON.stringify(v),by,now());
 // El avatar se expone solo como versión (para invalidar caché), nunca como nombre de archivo interno.
 const sharedSettings=()=>{const o=Object.fromEntries(all('SELECT key,value,updated_at FROM shared_settings').map(r=>[r.key,r.key==='dupla_avatar'?r.updated_at.replace(/\D/g,'').slice(0,14):JSON.parse(r.value)]));return {couple_since:o.couple_since||'',dupla_avatar_v:o.dupla_avatar||null,home_summary:o.home_summary||null};};
 const strip=html=>String(html||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,140);

 // Fotos libres del destino (Wikimedia Commons + Wikipedia). Nada se carga en el navegador desde terceros.
 async function placePhotos(query){
  const q=norm(query);if(!q)return [];const hit=cached('photos',q,7*864e5);if(hit)return hit;
  const out=[],seen=new Set();
  // 1º las fotos que Wikipedia usa en el artículo del lugar (elegidas por editores, sin ambigüedades tipo «Roma St»);
  // 2º búsqueda en Commons como respaldo.
  const commons=async(search,article)=>{const u=new URL(article?`https://${article}.wikipedia.org/w/api.php`:'https://commons.wikimedia.org/w/api.php');for(const [k,v] of Object.entries({action:'query',format:'json',...(article?{titles:search,redirects:'1',generator:'images',gimlimit:'60'}:{generator:'search',gsrnamespace:'6',gsrsearch:search,gsrlimit:'14'}),prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'1600'}))u.searchParams.set(k,v);
   const r=await fetch(u,{headers:UA,signal:AbortSignal.timeout(9000)});if(!r.ok)return;const j=await r.json();
   // Solo fotos JPEG apaisadas y grandes; fuera carteles, mapas, banderas y escudos (suelen colarse por el nombre).
   for(const p of Object.values(j.query?.pages||{}).sort((a,b)=>(a.index||0)-(b.index||0))){const i=p.imageinfo?.[0];if(!i||i.mime!=='image/jpeg'||i.width<1200||i.width<i.height*1.25||/poster|cartel|map|mapa|flag|bandera|logo|coat of arms|escudo|diagram|stamp|sello/i.test(p.title||''))continue;const url=cleanUrl(i.thumburl||i.url);if(!url||seen.has(url))continue;seen.add(url);const m=i.extmetadata||{};out.push({score:photoScore(p.title),order:out.length,url,credit:[strip(m.Artist?.value),strip(m.LicenseShortName?.value)].filter(Boolean).join(' · ')||'Wikimedia Commons',page:i.descriptionurl||''});}
  };
  const title=String(query).trim();
  const good=()=>out.filter(x=>x.score>=0).length;
  for(const [search,article] of [[title,'es'],[title,'en'],[`${q} skyline filetype:bitmap`],[`${q} panorama filetype:bitmap`]]){if(good()>=6)break;try{await commons(search,article);}catch(ex){console.error('Fotos Wikimedia',ex.message);}}
  const ranked=out.sort((a,b)=>b.score-a.score||a.order-b.order).filter((x,_,all)=>x.score>=0||all.filter(y=>y.score>=0).length<3);
  return store('photos',q,ranked.slice(0,8).map(({score,order,...x})=>x));
 }
 // Relevancia para portada de viaje: vistas y monumentos arriba; aeropuertos, fábricas, animales o interiores abajo.
 function photoScore(title){const t=String(title||'').toLowerCase();let s=0;
  if(/skyline|panoram|vista|view|mirador|cityscape|aerial|a[eé]rea|desde |from |overlook/.test(t))s+=5;
  if(/castle|castillo|castelo|cathedral|catedral|bridge|puente|ponte|old town|casco|plaza|pra[cç]a|square|beach|playa|praia|cala|lake|lago|mountain|monta[ñn]a|pico|parliament|parlamento|basilica|bas[ií]lica|colosseum|coliseo|tower|torre|harbou?r|puerto|river|r[ií]o|sunset|atardecer|night|noche/.test(t))s+=3;
  if(/airport|aeropuerto|aeroporto|terminal|factory|f[aá]brica|gy[aá]r|campus|stamp|interior|fresco|estancia|statue|estatua|equestrian|portrait|retrato|testudo|cervus|animal|graffiti|metro|station|estaci[oó]n|hospital|stadium|estadio|university|universidad|finalistas|atlas|ins[uv]lae|engraving|grabado|car |bus |tram|tranv[ií]a|1975|19[0-6]\d/.test(t))s-=6;
  return s;}
 // Wikimedia sirve originales en upload.* y miniaturas en thumb.*; se quitan parámetros de seguimiento.
 function cleanUrl(raw){try{const u=new URL(raw);if(u.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org'].includes(u.hostname)||u.username||u.port)return null;return u.origin+u.pathname;}catch{return null;}}
 async function downloadImage(raw){
  const url=cleanUrl(raw);if(!url||!/^https:\/\/(upload|thumb)\.wikimedia\.org\/[\w\-./%()~,']+$/.test(url))fail(400,'Solo se aceptan fotos sugeridas por DUPLA');
  const r=await fetch(url,{headers:UA,signal:AbortSignal.timeout(15000)});if(!r.ok)fail(502,'No se pudo descargar la foto ('+r.status+')');
  const file=Buffer.from(await r.arrayBuffer());if(!file.length||file.length>6*1024*1024)fail(413,'La foto supera 6 MB');
  if(!isImage(file))fail(415,'El archivo descargado no es una imagen válida');return file;
 }
 function isImage(f){return (f[0]===255&&f[1]===216&&f[2]===255)||(f.length>8&&f.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(f.length>12&&f.toString('ascii',0,4)==='RIFF'&&f.toString('ascii',8,12)==='WEBP');}
 function imageMime(f){return f[0]===255?'image/jpeg':f[0]===137?'image/png':'image/webp';}
 function setCover(p,file,credit,u){const name=uid();saveFile(name,file);const old=p.cover_file;run('UPDATE projects SET cover_file=?,cover_credit=?,updated_at=? WHERE id=?',name,credit.slice(0,200),now(),p.id);if(old){try{removeFile(old);}catch{}}if(u)logChange(p,u,'cambió la portada',p.title);}
 async function autoCover(p){if(p.cover_file||!p.destination)return false;try{const photos=await placePhotos(p.destination);if(!photos.length)return false;setCover(p,await downloadImage(photos[0].url),photos[0].credit,null);d.notify?.(p.space,p.id,null);return true;}catch(ex){console.error('Portada automática',ex.message);return false;}}

 async function weather(destination){
  const q=norm(destination);if(!q)return null;const hit=cached('weather',q,3600e3);if(hit)return hit;
  let geo=cached('geo',q,30*864e5);
  if(!geo){const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&format=json&name='+encodeURIComponent(destination),{headers:UA,signal:AbortSignal.timeout(8000)});const j=r.ok?await r.json():{};const g=j.results?.[0];if(!g)return store('weather',q,{found:false});geo=store('geo',q,{lat:g.latitude,lon:g.longitude,name:g.name,country:g.country||''});}
  const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`,{headers:UA,signal:AbortSignal.timeout(8000)});if(!r.ok)fail(502,'Servicio del tiempo no disponible');
  const c=(await r.json()).current||{};return store('weather',q,{found:true,place:geo.name,country:geo.country,temp:Math.round(c.temperature_2m),code:c.weather_code,day:c.is_day!==0,text:WEATHER[c.weather_code]||'Tiempo variable'});
 }

 // ---------- Agente Dupla ----------
 const spaceName=s=>s==='work'?'Trabajo':'Nuestro espacio';
 // «Confirmar hotel» ≈ «Confirmar el hotel»: mismas palabras con significado, sin artículos ni signos.
 const STOP=new Set(['el','la','los','las','un','una','de','del','al','a','en','y','para','por','con','the','to']);
 const words=s=>norm(s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9ñ ]/g,' ').split(' ').filter(w=>w&&!STOP.has(w));
 const similar=(a,b)=>{const A=words(a),B=words(b);if(!A.length||!B.length)return false;const sa=new Set(A);const common=B.filter(w=>sa.has(w)).length;return common/Math.max(A.length,B.length)>=0.8;};
 const inScope=(scope,space)=>scope==='all'||scope===space;
 function findProject(title,scope){
  const t=norm(title);if(!t)throw Error('Indica el proyecto');const ps=projectList().filter(p=>!p.archived&&inScope(scope,p.space));
  const exact=ps.filter(p=>norm(p.title)===t);if(exact.length===1)return exact[0];
  const part=ps.filter(p=>norm(p.title).includes(t)||t.includes(norm(p.title)));if(part.length===1)return part[0];
  if(part.length>1)throw Error('Hay varios proyectos que encajan: '+part.slice(0,5).map(p=>p.title).join(', ')+'. Pregunta cuál.');
  throw Error('No existe ningún proyecto llamado "'+title+'" en el ámbito actual.');
 }
 const fn=(name,description,properties={},required=[])=>({type:'function',function:{name,description,parameters:{type:'object',properties,required}}});
 const S_=d=>({type:'string',description:d}),N_=d=>({type:'number',description:d});
 const SPACE={type:'string',enum:['work','couple'],description:'work = Trabajo, couple = Nuestro espacio (pareja)'};
 const TOOLS=[
  fn('buscar','Busca por texto en proyectos, tareas, ideas, planes/eventos y notas.',{q:S_('Texto a buscar')},['q']),
  fn('consultar_historia','Memoria de la pareja: busca por significado en TODO lo guardado (viajes y planes pasados, gastos con quién pagó, reservas, reuniones y sus decisiones, notas, ideas, conversaciones). Úsala para preguntas sobre el pasado: «¿cuánto gastamos en…?», «¿qué decidimos en…?», «¿cuándo fue la última vez que…?».',{pregunta:S_('La pregunta o tema a recordar')},['pregunta']),
  fn('listar_proyectos','Lista los proyectos con estado, tipo, destino, fechas y progreso.',{espacio:SPACE}),
  fn('ver_proyecto','Detalle de un proyecto: tareas, planes, gastos, hitos y notas.',{proyecto:S_('Título del proyecto')},['proyecto']),
  fn('agenda','Tareas con fecha y planes de los próximos días.',{dias:N_('Número de días hacia delante (por defecto 30)')}),
  fn('ideas','Ideas guardadas recientes.',{}),
  fn('recordar','Guarda un dato duradero sobre la pareja o sus preferencias (p. ej. alergias, gustos). Úsalo solo si lo piden o es claramente útil.',{dato:S_('Dato breve en una frase')},['dato']),
  fn('crear_proyecto','PROPONE crear un proyecto (requiere confirmación).',{espacio:SPACE,titulo:S_('Título'),descripcion:S_('Descripción breve'),plantilla:{type:'string',enum:['blank','trip','dinner','shared','weekend','celebration','website','campaign','app','automation','ai_agent','freelance'],description:'trip/dinner/shared/weekend/celebration solo en couple; website/campaign/app/automation/ai_agent/freelance solo en work'},destino:S_('Ciudad o lugar si es un viaje'),fecha_inicio:S_('YYYY-MM-DD'),fecha_fin:S_('YYYY-MM-DD')},['espacio','titulo']),
  fn('crear_tarea','PROPONE crear una tarea en un proyecto (requiere confirmación).',{proyecto:S_('Título del proyecto existente o propuesto en este turno'),titulo:S_('Tarea'),fecha:S_('Fecha límite YYYY-MM-DD'),prioridad:{type:'string',enum:['low','normal','high']},nota:S_('Detalle opcional')},['proyecto','titulo']),
  fn('crear_evento','PROPONE añadir un plan o fecha a un proyecto (requiere confirmación).',{proyecto:S_('Título del proyecto'),titulo:S_('Plan'),fecha:S_('YYYY-MM-DD'),hora:S_('HH:MM'),lugar:S_('Lugar'),nota:S_('Notas')},['proyecto','titulo','fecha']),
  fn('anadir_gasto','PROPONE añadir un gasto previsto o real a un proyecto (requiere confirmación).',{proyecto:S_('Título del proyecto'),concepto:S_('Concepto'),categoria:{type:'string',enum:EXPENSE_CATS,description:'transport=vuelos/transporte, stay=alojamiento, food=comida, activities=actividades'},previsto:N_('Euros previstos'),real:N_('Euros gastados')},['proyecto','concepto']),
  fn('crear_idea','PROPONE guardar una idea en el buzón (requiere confirmación).',{espacio:SPACE,titulo:S_('Idea'),nota:S_('Detalle')},['espacio','titulo']),
  fn('avisos_destino','Avisos para viajar a un destino en unas fechas: festivos, puentes, fiestas y ferias que encarecen, consejos y lo que os gastasteis otras veces.',{destino:S_('Destino'),fecha_inicio:S_('YYYY-MM-DD'),fecha_fin:S_('YYYY-MM-DD')},['destino','fecha_inicio']),
  fn('revisar_director','Análisis del Director General: retrasos, viajes, presupuesto, tareas e ideas que necesitan atención (datos reales).',{espacio:SPACE},['espacio']),
  fn('preparar_pdf','PROPONE generar y descargar un PDF (requiere confirmación): itinerario de un viaje, dossier de un proyecto o presupuesto para cliente (solo Trabajo).',{proyecto:S_('Título del proyecto o viaje'),tipo:{type:'string',enum:['itinerario','dossier','presupuesto']}},['proyecto','tipo']),
  fn('crear_evento_calendario','PROPONE crear un evento en el calendario compartido de Google «DUPLA · Nuestro calendario» (requiere confirmación). Úsalo para citas y planes que deban verse en los móviles.',{titulo:S_('Evento'),fecha:S_('YYYY-MM-DD'),hora:S_('HH:MM (vacío = todo el día)'),lugar:S_('Lugar'),nota:S_('Notas'),videollamada:{type:'boolean',description:'true para añadir videollamada de Google Meet'}},['titulo','fecha']),
  fn('deshacer','PROPONE deshacer lo último que la persona confirmó en este chat (borra lo que se creó). Úsalo si pide «deshaz», «quita lo que acabas de crear», etc.',{}),
  fn('completar_tarea','PROPONE marcar una tarea como hecha (requiere confirmación).',{proyecto:S_('Título del proyecto'),tarea:S_('Título de la tarea')},['proyecto','tarea']),
 ];
 function readTool(name,a,scope,u){
  if(name==='consultar_historia')return historia(requireText(a.pregunta||a.q||'','Pregunta',300),scope);
  if(name==='buscar'){const q='%'+String(a.q||'').trim().slice(0,80)+'%';if(q.length<4)throw Error('Búsqueda demasiado corta');
   const ok=r=>inScope(scope,r.space);
   return {proyectos:all('SELECT title,space,status,kind,destination FROM projects WHERE deleted_at IS NULL AND (title LIKE ? OR description LIKE ? OR destination LIKE ?) LIMIT 10',q,q,q).filter(ok),
    tareas:all('SELECT t.title,t.state,t.due_date,p.title AS proyecto,p.space FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND t.title LIKE ? LIMIT 12',q).filter(ok).map(({space,...r})=>r),
    ideas:all('SELECT title,body,space,state FROM ideas WHERE title LIKE ? OR body LIKE ? LIMIT 10',q,q).filter(ok).map(({space,...r})=>({...r,body:String(r.body).slice(0,160)})),
    planes:all('SELECT e.title,e.event_date,e.location,p.title AS proyecto,p.space FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL AND (e.title LIKE ? OR e.location LIKE ?) LIMIT 10',q,q).filter(ok).map(({space,...r})=>r),
    notas:all('SELECT s.title,substr(s.content,1,200) AS extracto,p.title AS proyecto,p.space FROM sections s JOIN projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL AND (s.title LIKE ? OR s.content LIKE ?) LIMIT 8',q,q).filter(ok).map(({space,...r})=>r)};}
  if(name==='listar_proyectos')return projectList().filter(p=>!p.archived&&inScope(scope,p.space)&&(!a.espacio||p.space===a.espacio)).slice(0,40).map(p=>({titulo:p.title,espacio:spaceName(p.space),estado:p.status,tipo:p.kind,destino:p.destination||undefined,inicio:p.start_date||undefined,fin:p.end_date||undefined,tareas:`${p.tasks_done}/${p.tasks_total}`}));
  if(name==='ver_proyecto'){const p=findProject(a.proyecto,scope);const id=p.id;const ex=all('SELECT title,category,estimated,actual FROM expenses WHERE project_id=?',id);
   return {titulo:p.title,espacio:spaceName(p.space),estado:p.status,tipo:p.kind,descripcion:String(p.description||'').slice(0,600),destino:p.destination,inicio:p.start_date,fin:p.end_date,
    tareas:all('SELECT title,state,due_date,priority FROM tasks WHERE project_id=? ORDER BY state,due_date LIMIT 40',id),planes:all('SELECT title,event_date,event_time,location,booking_status FROM events WHERE project_id=? ORDER BY event_date LIMIT 30',id),
    hitos:all('SELECT title,state,due_date FROM milestones WHERE project_id=? LIMIT 15',id),gastos:{previsto:ex.reduce((n,x)=>n+x.estimated,0),real:ex.reduce((n,x)=>n+x.actual,0),partidas:ex.slice(0,25)},
    notas:all('SELECT title,substr(content,1,300) AS extracto FROM sections WHERE project_id=? ORDER BY sort_order LIMIT 10',id)};}
  if(name==='agenda'){const days=Math.min(Math.max(Number(a.dias)||30,1),365),from=new Date().toISOString().slice(0,10),to=new Date(Date.now()+days*864e5).toISOString().slice(0,10);
   return all(`SELECT 'tarea' AS tipo,t.title,t.due_date AS fecha,p.title AS proyecto,p.space FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND t.state!='done' AND t.due_date BETWEEN ? AND ? UNION ALL SELECT 'plan',e.title,e.event_date,p.title,p.space FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL AND e.event_date BETWEEN ? AND ? ORDER BY fecha LIMIT 40`,from,to,from,to).filter(r=>inScope(scope,r.space)).map(({space,...r})=>({...r,espacio:spaceName(space)}));}
  if(name==='ideas')return all("SELECT title,substr(body,1,160) AS nota,space,state,updated_at FROM ideas WHERE state!='converted' ORDER BY updated_at DESC LIMIT 15").filter(r=>inScope(scope,r.space)).map(({space,...r})=>({...r,espacio:spaceName(space)}));
  if(name==='avisos_destino'){const st=validDate(String(a.fecha_inicio||'')),en=validDate(String(a.fecha_fin||''))||st;if(!st)throw Error('Fecha no válida');return budgetForecast(requireText(a.destino,'Destino',120),st,en,2).then(f=>({avisos:f.alerts.map(x=>x.text),eventos:f.insights?.events,consejos:f.insights?.tips,gasto_otras_veces:f.estimate?.total||null}));}
  if(name==='revisar_director'){const sp=choice(a.espacio,['work','couple']);if(!inScope(scope,sp))throw Error('Ese espacio está fuera del ámbito elegido.');return directorSuggestions(sp).filter(x=>['proposal','review','approved'].includes(x.status)).slice(0,15).map(x=>({area:x.area,gravedad:x.severity,titulo:x.title,detalle:x.detail,estado:x.status,tarea_propuesta:x.task||undefined}));}
  if(name==='recordar'){const fact=requireText(a.dato,'Dato',300);if(all('SELECT id FROM agent_memory').length>=80)throw Error('La memoria está llena; pide que borren datos antiguos en Ajustes.');run('INSERT INTO agent_memory(id,fact,created_by,created_at) VALUES(?,?,?,?)',uid(),fact,u.id,now());return {guardado:true};}
  return null;
 }
 // Construye la propuesta exacta (método, ruta y cuerpo) que la API normal validará al confirmarla.
 const UNDOABLE=['crear_proyecto','crear_tarea','crear_evento','anadir_gasto','crear_idea','crear_evento_calendario'];
 function proposal(name,a,scope,pending,u){
  const date=v=>v?validDate(String(v)):null;
  // Un proyecto propuesto en este mismo turno se referencia como {{pN}} y el navegador lo sustituye al confirmarlo.
  const target=title=>{const t=norm(title);const planned=pending.find(p=>p.tool==='crear_proyecto'&&norm(p.body.title)===t);if(planned){if(!inScope(scope,planned.body.space))throw Error('Fuera del ámbito');return {ref:planned.id,title:planned.body.title};}const p=findProject(title,scope);return {id:p.id,title:p.title};};
  const base=(tg,suffix)=>tg.ref?{path:`/api/projects/{{${tg.ref}}}/${suffix}`,depends_on:tg.ref}:{path:`/api/projects/${tg.id}/${suffix}`};
  if(name==='crear_proyecto'){const space=choice(a.espacio,['work','couple']);if(!inScope(scope,space))throw Error('Ese espacio está fuera del ámbito elegido. Pide permiso para usar '+spaceName(space)+'.');
   const tpl=a.plantilla||'blank',allowed=space==='work'?['blank','website','campaign','app','automation','ai_agent','freelance']:['blank','trip','dinner','shared','weekend','celebration'];if(!allowed.includes(tpl))throw Error('Plantilla no válida para '+spaceName(space));
   const body={space,title:requireText(a.titulo,'Título',120),description:optional(a.descripcion||'',2500),template:tpl,status:'planning',destination:optional(a.destino||'',120),start_date:date(a.fecha_inicio),end_date:date(a.fecha_fin)};
   return {method:'POST',path:'/api/projects',body,summary:`Crear ${tpl==='trip'?'viaje':'proyecto'} «${body.title}» en ${spaceName(space)}${body.destination?' · '+body.destination:''}${body.start_date?' · '+body.start_date+(body.end_date?' → '+body.end_date:''):''}`};}
  if(name==='crear_tarea'){const tg=target(a.proyecto);const body={title:requireText(a.titulo,'Tarea',220),due_date:date(a.fecha),priority:choice(a.prioridad,['low','normal','high'],'normal'),description:optional(a.nota||'',5000)};
   if(tg.id){const twin=all("SELECT title FROM tasks WHERE project_id=? AND state!='done'",tg.id).find(x=>similar(x.title,body.title));if(twin)throw Error(`Ya existe la tarea «${twin.title}» en ${tg.title}. No la dupliques: pregunta si quieren cambiarle la fecha o la prioridad.`);}
   return {method:'POST',...base(tg,'tasks'),body,summary:`Tarea «${body.title}» en ${tg.title}${body.due_date?' · para el '+body.due_date:''}${body.priority==='high'?' · prioridad alta':''}`};}
  if(name==='crear_evento'){const tg=target(a.proyecto);const body={title:requireText(a.titulo,'Plan',160),event_date:validDate(requireText(a.fecha,'Fecha')),event_time:a.hora&&/^([01]\d|2[0-3]):[0-5]\d$/.test(a.hora)?a.hora:'',location:optional(a.lugar||'',220),notes:optional(a.nota||'',5000)};return {method:'POST',...base(tg,'events'),body,summary:`Plan «${body.title}» el ${body.event_date}${body.event_time?' a las '+body.event_time:''}${body.location?' · '+body.location:''} (${tg.title})`};}
  if(name==='anadir_gasto'){const tg=target(a.proyecto);const body={title:requireText(a.concepto,'Concepto',160),category:choice(a.categoria,EXPENSE_CATS,'general'),estimated:money(a.previsto),actual:money(a.real)};return {method:'POST',...base(tg,'expenses'),body,summary:`Gasto «${body.title}»${body.estimated?` · previsto ${body.estimated} €`:''}${body.actual?` · gastado ${body.actual} €`:''} (${tg.title})`};}
  if(name==='crear_idea'){const space=choice(a.espacio,['work','couple']);if(!inScope(scope,space))throw Error('Ese espacio está fuera del ámbito elegido.');const body={space,title:requireText(a.titulo,'Idea',160),body:optional(a.nota||'',6000)};return {method:'POST',path:'/api/ideas',body,summary:`Idea «${body.title}» en ${spaceName(space)}`};}
  if(name==='preparar_pdf'){const p=findProject(a.proyecto,scope);let kind=choice(a.tipo,['itinerario','dossier','presupuesto'],'dossier');const trip=p.kind==='trip'||!!p.destination;if(kind==='itinerario'&&!trip)kind='dossier';if(kind==='presupuesto'&&p.space!=='work')throw Error('El presupuesto para cliente solo existe en proyectos de Trabajo.');
   return {method:'PDF',path:'pdf',body:{project_id:p.id,kind:kind==='itinerario'?'trip':kind==='presupuesto'?'quote':'dossier'},summary:`Preparar el PDF ${kind==='itinerario'?'del itinerario':kind==='presupuesto'?'del presupuesto para el cliente':'(dossier)'} de «${p.title}»`};}
  if(name==='crear_evento_calendario'){if(!inScope(scope,'couple'))throw Error('El calendario compartido es de Nuestro espacio: cambia el ámbito para usarlo.');if(!get("SELECT 1 AS ok FROM google_shared_calendar WHERE singleton='main'"))throw Error('El calendario de Google aún no está vinculado en DUPLA.');
   const body={title:requireText(a.titulo,'Evento',160),date:validDate(requireText(a.fecha,'Fecha')),time:a.hora&&/^([01]\d|2[0-3]):[0-5]\d$/.test(a.hora)?a.hora:'',location:optional(a.lugar||'',220),notes:optional(a.nota||'',2000),request_id:uid(),meet:a.videollamada===true};
   return {method:'POST',path:'/api/google/shared/events',body,summary:`Evento en «DUPLA · Nuestro calendario»: ${body.title} · ${body.date}${body.time?' '+body.time:''}${body.location?' · '+body.location:''}${body.meet?' · con Google Meet':''}`};}
  if(name==='deshacer'){const rows=all("SELECT id,proposals FROM agent_messages WHERE user_id=? AND role='assistant' AND proposals LIKE '%\"done\"%' ORDER BY created_at DESC LIMIT 5",u.id);
   for(const r of rows){const done=JSON.parse(r.proposals).filter(x=>x.status==='done'&&x.result_id&&UNDOABLE.includes(x.tool));if(done.length)return {method:'UNDO',path:'undo',body:{message_id:r.id},summary:'Deshacer lo último confirmado: '+done.map(x=>x.summary).join(' · ').slice(0,300)};}
   throw Error('No hay nada confirmado recientemente que se pueda deshacer.');}
  if(name==='completar_tarea'){const p=findProject(a.proyecto,scope);const t=norm(a.tarea);const ts=all("SELECT id,title,revision FROM tasks WHERE project_id=? AND state!='done'",p.id);const m=ts.filter(x=>norm(x.title)===t);const c=m.length?m:ts.filter(x=>norm(x.title).includes(t));if(c.length!==1)throw Error(c.length?'Varias tareas encajan: '+c.map(x=>x.title).join(', '):'No hay tarea pendiente con ese nombre en '+p.title);return {method:'PATCH',path:'/api/tasks/'+c[0].id,body:{state:'done',revision:c[0].revision},summary:`Marcar como hecha «${c[0].title}» (${p.title})`};}
  return null;
 }
 function systemPrompt(u,scope){
  const users=all('SELECT name FROM users ORDER BY name').map(x=>x.name).join(' y ');const memory=all('SELECT fact FROM agent_memory ORDER BY created_at DESC LIMIT 40').map(x=>'- '+x.fact).join('\n');
  const today=new Date();const fmt=today.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Madrid'});
  return `Eres Dupla, el agente personal de ${users} dentro de su app DUPLA. Hablas con ${u.name}. Hoy es ${fmt} (${today.toISOString().slice(0,10)}).
La app tiene dos espacios separados: Trabajo (work) y Nuestro espacio (couple, vida en pareja). Ámbito permitido en esta conversación: ${scope==='all'?'ambos espacios':spaceName(scope)+' únicamente'}. Nunca leas ni propongas cambios fuera de ese ámbito; si hace falta, pide que cambien el ámbito.
Reglas:
- No inventes datos: consulta con las herramientas antes de afirmar nada sobre proyectos, tareas, fechas o gastos. Si algo no está, dilo.
- Para cambiar cualquier cosa usa las herramientas que PROPONEN cambios; nada se guarda hasta que la persona confirme en pantalla. No digas que algo está hecho: di que queda propuesto para confirmar.
- Una propuesta SOLO existe si llamas a su herramienta. Nunca describas en texto una propuesta sin haber llamado antes a la herramienta correspondiente.
- Antes de proponer una tarea, plan o gasto en un proyecto existente, consulta ver_proyecto para no duplicar. Si ya existe algo equivalente, no lo propongas otra vez: dilo y ofrece cambiar la fecha o la prioridad.
- Para planes complejos (p. ej. organizar un viaje) propone el proyecto y después sus tareas, planes y gastos con fechas concretas y realistas.
- Si hay un viaje con destino y fechas, consulta avisos_destino y cuéntales lo importante (fiestas, puentes, cuándo reservar) en una o dos frases.
- Convierte fechas relativas en fechas YYYY-MM-DD a partir de hoy.
- Responde en español, cálido y concreto, en pocas frases o una lista corta. Sin tablas.
${memory?'Lo que sabes de ellos (memoria compartida):\n'+memory:''}`;
 }
 function toolResultText(x){const s=JSON.stringify(x);return s.length>6000?s.slice(0,6000)+'…(recortado)':s;}
 async function runAgent(u,message,scope){
  if(!env.AI)fail(503,'La IA no está disponible en este entorno');
  const history=all('SELECT role,content FROM agent_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 12',u.id).reverse();
  const messages=[{role:'system',content:systemPrompt(u,scope)},...history.map(h=>({role:h.role,content:h.content})),{role:'user',content:message}];
  const proposals=[],trace=[];let reply='',neurons=0,nudged=false;
  for(let step=0;step<6;step++){
   let r;try{r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages,tools:TOOLS,max_tokens:1200,temperature:0.3});}catch(ex){fail(502,'La IA no ha respondido: '+String(ex.message||ex).slice(0,160));}
   neurons+=Number(r.usage?.neurons||0);const msg=r.choices?.[0]?.message||{};const calls=msg.tool_calls||r.tool_calls||[];
   if(!calls.length){reply=String(msg.content??r.response??'').trim();
    // Red de seguridad: si dice que propone algo pero no llamó a ninguna herramienta, se le exige hacerlo (una vez).
    if(!proposals.length&&!nudged&&step<5&&/propon|propuest|¿confirm|confirmas|quieres que (lo )?(añada|cree|apunte)/i.test(reply)){nudged=true;messages.push({role:'assistant',content:reply},{role:'user',content:'[Sistema] Has descrito una propuesta sin llamar a la herramienta, así que no existe y no puede confirmarse. Llama ahora a la herramienta correspondiente con esos datos, o reformula sin proponer nada.'});continue;}
    if(!proposals.length&&nudged&&/propon|¿confirm|confirmas/i.test(reply))reply+='\n\n⚠️ No he podido preparar la propuesta para confirmar. Pídemelo de nuevo, por favor.';
    break;}
   messages.push({role:'assistant',content:msg.content||'',tool_calls:calls});
   for(const c of calls){const name=c.function?.name||c.name;let args={};try{args=typeof (c.function?.arguments??c.arguments)==='string'?JSON.parse(c.function?.arguments??c.arguments):(c.function?.arguments??c.arguments??{});}catch{}
    let result;try{const read=await readTool(name,args,scope,u);if(read!==null){result=read;trace.push({tool:name,ok:true});}else{const p=proposal(name,args,scope,proposals,u);if(!p)throw Error('Herramienta desconocida');const id='p'+(proposals.length+1);proposals.push({id,tool:name,status:'pending',...p});result={propuesta:id,resumen:p.summary,estado:'pendiente de que la persona la confirme'};trace.push({tool:name,ok:true});}}
    catch(ex){result={error:String(ex.message||ex)};trace.push({tool:name,ok:false,error:result.error});}
    messages.push({role:'tool',tool_call_id:c.id||name,content:toolResultText(result)});}
  }
  // Si Dupla crea un proyecto y además propone sus tareas, sin las tareas genéricas de la plantilla (evita duplicados), conservando el tipo.
  for(const p of proposals)if(p.tool==='crear_proyecto'&&p.body.template!=='blank'&&proposals.some(x=>x.depends_on===p.id&&x.tool==='crear_tarea')){p.body.kind=p.body.template;p.body.template='blank';}
  if(!reply)reply=proposals.length?'He preparado estas propuestas. Revísalas y confírmalas cuando quieras.':'No he podido completar la respuesta. ¿Puedes reformularlo?';
  const t=now();run('INSERT INTO agent_messages(id,user_id,role,content,proposals,created_at) VALUES(?,?,?,?,?,?)',uid(),u.id,'user',message,'[]',t);
  const id=uid();run('INSERT INTO agent_messages(id,user_id,role,content,proposals,created_at) VALUES(?,?,?,?,?,?)',id,u.id,'assistant',reply.slice(0,8000),JSON.stringify(proposals),new Date(Date.parse(t)+1).toISOString());
  return {id,role:'assistant',content:reply,proposals,trace,neurons:Math.round(neurons),created_at:t};
 }

 // Sin ninguna fila para el proveedor = comportamiento anterior (global). Con filas, solo donde estén permitidas.
 function connectionScope(provider,p){const rows=all('SELECT * FROM connections WHERE provider=?',provider);if(!rows.length)return {allowed:true,permission:'write',legacy:true};
  const hit=rows.filter(r=>r.scope_type==='global'||(r.scope_type==='space'&&r.scope_id===p.space)||(r.scope_type==='project'&&r.scope_id===p.id));
  return {allowed:hit.length>0,permission:hit.some(r=>r.permission==='write')?'write':hit.length?'read':null};}
 function requireConnection(provider,p,need='write'){const s=connectionScope(provider,p);if(!s.allowed)fail(403,`${PROVIDERS[provider]?.name||provider} no está activado para «${p.title}». Actívalo en Conexiones para este proyecto.`);if(need==='write'&&s.permission!=='write')fail(403,`${PROVIDERS[provider]?.name||provider} solo tiene permiso de lectura en «${p.title}».`);}
 function validScope(b){const type=choice(b.scope_type,['global','space','project']);let id='';if(type==='space')id=choice(b.scope_id,['work','couple']);if(type==='project')id=project(String(b.scope_id||'')).id;return {type,id};}
  function directorSuggestions(space){const t=new Date().toISOString().slice(0,10),plus=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10),out=[],add=(area,sev,ref,title,detail,pid,task)=>out.push({id:area+'-'+ref,area,severity:sev,title,detail,project_id:pid||null,task:task||null});
   const ps=all('SELECT * FROM projects WHERE deleted_at IS NULL AND space=? AND COALESCE(archived,0)=0',space);
   for(const p of ps){const late=all("SELECT id,title,due_date FROM tasks WHERE project_id=? AND state!='done' AND due_date IS NOT NULL AND due_date<? ORDER BY due_date",p.id,t);
    if(late.length)add('retrasos',late.length>2?'high':'mid',p.id,`${late.length} ${late.length===1?'tarea atrasada':'tareas atrasadas'} en «${p.title}»`,`La más antigua: «${late[0].title}» (vencía el ${late[0].due_date}). Replanificad fechas o repartid el trabajo.`,p.id,`Replanificar tareas atrasadas de ${p.title}`);
    const last=get('SELECT MAX(created_at) AS d FROM activities WHERE project_id=?',p.id)?.d;if(['active','planning'].includes(p.status)&&last&&last<new Date(Date.now()-14*864e5).toISOString())add('retrasos','mid','idle-'+p.id,`«${p.title}» lleva más de 2 semanas parado`,'No hay cambios desde '+last.slice(0,10)+'. Decidid el siguiente paso o pausadlo.',p.id,`Decidir el siguiente paso de ${p.title}`);
    const ex=get('SELECT COUNT(*) AS n,COALESCE(SUM(estimated),0) AS e,COALESCE(SUM(actual),0) AS a FROM expenses WHERE project_id=?',p.id);
    if(ex.n&&ex.a>ex.e&&ex.e>0)add('presupuesto',ex.a>ex.e*1.2?'high':'mid',p.id,`«${p.title}» supera el presupuesto`,`Gastado ${ex.a.toFixed(0)} € de ${ex.e.toFixed(0)} € previstos (+${Math.round((ex.a/ex.e-1)*100)}%). Revisad conceptos o ajustad lo previsto.`,p.id,`Revisar presupuesto de ${p.title}`);
    const trip=p.kind==='trip'||p.destination;
    if(trip&&p.start_date&&p.start_date>=t&&p.start_date<=plus(45)){
     if(!ex.n)add('presupuesto','mid','nobudget-'+p.id,`El viaje «${p.title}» no tiene presupuesto`,`Sale el ${p.start_date}. Añadid vuelos, hotel, transporte y comida para saber cuánto os vais a gastar.`,p.id,`Hacer presupuesto del viaje ${p.title}`);
     const pend=all("SELECT title,visit_date FROM trip_stops WHERE project_id=? AND booking_state='pending' AND state!='cancelled'",p.id);
     if(pend.length)add('viaje',p.start_date<=plus(14)?'high':'mid','book-'+p.id,`${pend.length} ${pend.length===1?'reserva pendiente':'reservas pendientes'} para «${p.title}»`,'Pendientes: '+pend.slice(0,4).map(x=>x.title).join(', ')+(pend.length>4?'…':'')+`. El viaje empieza el ${p.start_date}.`,p.id,`Hacer reservas pendientes de ${p.title}`);
     const stops=get('SELECT COUNT(DISTINCT visit_date) AS n FROM trip_stops WHERE project_id=?',p.id).n,days=p.end_date?Math.round((new Date(p.end_date)-new Date(p.start_date))/864e5)+1:1;
     if(stops<days)add('viaje','low','plan-'+p.id,`Días sin planificar en «${p.title}»`,`${days-stops} de ${days} días aún no tienen actividades en el itinerario.`,p.id,`Completar itinerario de ${p.title}`);}
    const nodue=get("SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND state!='done' AND due_date IS NULL AND priority='high'",p.id).n;if(nodue)add('tareas','mid','nodue-'+p.id,`${nodue} ${nodue===1?'tarea prioritaria':'tareas prioritarias'} sin fecha en «${p.title}»`,'Ponedles fecha para que aparezcan en el calendario y en los avisos.',p.id,`Poner fecha a tareas prioritarias de ${p.title}`);
    const open=get("SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND state!='done' AND assigned_to IS NULL",p.id).n;if(open>=5)add('tareas','low','assign-'+p.id,`«${p.title}» tiene ${open} tareas sin responsable`,'Repartirlas entre los dos evita que se queden paradas.',p.id,`Repartir tareas de ${p.title}`);}
   for(const i of all("SELECT * FROM ideas WHERE space=? AND state IN ('inbox','considering') AND archived_at IS NULL",space)){const age=Math.round((Date.now()-new Date(i.updated_at))/864e5);
    if(i.state==='considering'&&age>=7)add('ideas','mid',i.id,`Decidid sobre la idea «${i.title}»`,`Lleva ${age} días en revisión. Convertidla, dejadla en borrador o archivadla.`,null,null);
    else if(i.state==='inbox'&&age>=21)add('ideas','low',i.id,`Idea olvidada: «${i.title}»`,`Nadie la ha tocado en ${age} días. Retomadla o archivadla para despejar.`,null,null);}
   const st={};for(const r of all('SELECT * FROM director_states WHERE space=?',space))st[r.id]=r;
   const sev={high:0,mid:1,low:2};return out.map(x=>({...x,status:st[x.id]?.status||'proposal',task_id:st[x.id]?.task_id||null})).sort((a,b)=>sev[a.severity]-sev[b.severity]);}
 const normDest=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const FOODISH=['food','outings'],DAYS=(a,b)=>Math.max(1,Math.round((Date.parse(b)-Date.parse(a))/864e5)+1);
 function budgetHistory(){const trips=all("SELECT id,title,destination,start_date,end_date,status FROM projects WHERE deleted_at IS NULL AND (kind IN ('trip','weekend') OR destination!='') AND start_date IS NOT NULL ORDER BY start_date DESC");
  const out={};for(const p of trips){const ex=all('SELECT category,estimated,actual,booked_at FROM expenses WHERE project_id=?',p.id);const days=DAYS(p.start_date,p.end_date||p.start_date),nights=Math.max(1,days-1),val=x=>x.actual||x.estimated||0;
   const cat={};for(const x of ex)cat[x.category]=(cat[x.category]||0)+val(x);const lead=k=>{const b=ex.filter(x=>x.category===k&&x.booked_at).map(x=>Math.round((Date.parse(p.start_date)-Date.parse(x.booked_at))/864e5));return b.length?Math.max(...b):null;};
   const t={id:p.id,title:p.title,destination:p.destination||p.title,start:p.start_date,end:p.end_date||p.start_date,days,nights,total:Object.values(cat).reduce((n,v)=>n+v,0),by_category:cat,food_per_day:FOODISH.reduce((n,k)=>n+(cat[k]||0),0)/days,stay_per_night:(cat.stay||0)/nights,tickets:(cat.flights||0)+(cat.transport||0),lead_stay:lead('stay'),lead_tickets:lead('flights')??lead('transport'),items:ex.length};
   const key=normDest(t.destination);(out[key]=out[key]||{destination:t.destination,trips:[]}).trips.push(t);}
  const range=a=>{const v=a.filter(x=>x>0);return v.length?{min:Math.round(Math.min(...v)),max:Math.round(Math.max(...v)),avg:Math.round(v.reduce((n,x)=>n+x,0)/v.length)}:null;};
  return {destinations:Object.values(out).map(d=>({...d,stats:{trips:d.trips.length,total:range(d.trips.map(x=>x.total)),food_per_day:range(d.trips.map(x=>x.food_per_day)),stay_per_night:range(d.trips.map(x=>x.stay_per_night)),tickets:range(d.trips.map(x=>x.tickets)),lead_stay:range(d.trips.map(x=>x.lead_stay||0)),lead_tickets:range(d.trips.map(x=>x.lead_tickets||0))}}))};}
 const REGION={'aragon':'ES-AR','andalucia':'ES-AN','asturias':'ES-AS','islas baleares':'ES-IB','baleares':'ES-IB','canarias':'ES-CN','cantabria':'ES-CB','castilla y leon':'ES-CL','castilla-la mancha':'ES-CM','cataluna':'ES-CT','catalonia':'ES-CT','comunidad valenciana':'ES-VC','valencia':'ES-VC','extremadura':'ES-EX','galicia':'ES-GA','madrid':'ES-MD','comunidad de madrid':'ES-MD','murcia':'ES-MC','region de murcia':'ES-MC','navarra':'ES-NC','pais vasco':'ES-PV','basque country':'ES-PV','la rioja':'ES-RI','ceuta':'ES-CE','melilla':'ES-ML'};
 async function cacheFetch(kind,q,ttl,fn){const c=get('SELECT json,fetched_at FROM place_cache WHERE kind=? AND query=?',kind,q);if(c&&ago(c.fetched_at)<ttl)return JSON.parse(c.json);const v=await fn();run('INSERT INTO place_cache(kind,query,json,fetched_at) VALUES(?,?,?,?) ON CONFLICT(kind,query) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at',kind,q,JSON.stringify(v),Date.now());return v;}
 const MONTHS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
 async function destInsights(dest,st,en){if(!env.AI)return null;const ms=[...new Set([Number(st.slice(5,7)),Number(en.slice(5,7))])],key=normDest(dest)+'|'+ms.join(',');
  return cacheFetch('destai2',key,30*864e5,async()=>{const r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages:[{role:'system',content:'Eres un asesor de viajes en España y Europa. Devuelve SOLO JSON válido: {"events":[{"name":"","when":"","impact":"","tip":""}],"tips":[""]}. En "events" pon únicamente eventos que se repiten CADA AÑO en ese lugar y época y que conozcas con seguridad (fiestas patronales, ferias y congresos habituales, festivales recurrentes, temporada alta) y que suban precios o llenen hoteles; "when" = fechas aproximadas habituales; "impact" = qué se encarece; "tip" = cómo ahorrar. Si no conoces nada seguro, events vacío. "tips": 2-3 consejos concretos para ahorrar en ese destino y época (cuándo reservar, zonas más baratas, transporte). Español, breve. No inventes fechas exactas de este año.'},{role:'user',content:`Destino: ${dest}. Viaje entre ${st} y ${en} (${ms.map(x=>MONTHS[x-1]).join(' y ')}).`}],max_tokens:2500,temperature:0.2});
   const raw=String(r.choices?.[0]?.message?.content||r.response||'');let j;try{j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}catch{throw Error('La IA no devolvió JSON');}
   const t=(v,n)=>String(v||'').slice(0,n);return {events:(Array.isArray(j.events)?j.events:[]).slice(0,5).map(x=>({name:t(x.name,80),when:t(x.when,60),impact:t(x.impact,140),tip:t(x.tip,160)})).filter(x=>x.name),tips:(Array.isArray(j.tips)?j.tips:[]).slice(0,3).map(x=>t(x,180)).filter(Boolean)};}).catch(ex=>({events:[],tips:[],error:String(ex?.message||ex).slice(0,160)}));}
 async function budgetForecast(dest,st,en,people){const h=budgetHistory().destinations.find(d=>normDest(d.destination)===normDest(dest)),days=DAYS(st,en),nights=Math.max(1,days-1);
  const geo=await cacheFetch('geo2',normDest(dest),30*864e5,async()=>{const r=await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&format=json&name='+encodeURIComponent(dest),{headers:UA,signal:AbortSignal.timeout(8000)});const j=r.ok?await r.json():{};const g=j.results?.[0]||{};return {country:g.country_code||'',admin1:g.admin1||'',name:g.name||dest};}).catch(()=>({country:'',admin1:'',name:dest}));
  const years=[...new Set([st.slice(0,4),en.slice(0,4)])],hol=[];
  if(geo.country)for(const y of years){try{hol.push(...await cacheFetch('hol',geo.country+y,30*864e5,async()=>{const r=await fetch(`https://date.nager.at/api/v3/PublicHolidays/${y}/${geo.country}`,{headers:UA,signal:AbortSignal.timeout(8000)});return r.ok?await r.json():[];}));}catch{}}
  const adm=normDest(geo.admin1),region=REGION[adm]||Object.entries(REGION).sort((a,b)=>b[0].length-a[0].length).find(([k])=>adm.includes(k))?.[1]||'',near=(d,k)=>Math.abs(Date.parse(d)-Date.parse(k))/864e5,alerts=[],add=(level,text)=>alerts.push({level,text});
  const relevant=hol.filter(x=>(x.global||!x.counties||x.counties.includes(region))&&near(x.date,st)<=7||(x.global||!x.counties||x.counties.includes(region))&&x.date>=st&&x.date<=en);
  for(const x of relevant){const wd=new Date(x.date+'T12:00:00Z').getUTCDay(),puente=wd===2||wd===4;add(x.date>=st&&x.date<=en?'high':'mid',`${x.localName} (${x.date})${x.global?'':' · festivo regional'}${puente?' · posible puente':''}: suben alojamientos y transporte.`);}
  const md=st.slice(5);if(md>='12-15'||en.slice(5)<='01-07'&&en.slice(5)>='01-01')add('high','Navidad / Año Nuevo: temporada alta, reservad con mucha antelación.');
  if((md>='07-01'&&md<='08-31'))add('mid','Verano: precios altos en vuelos y hoteles; mejor reservar 2-3 meses antes.');
  if(md>='10-08'&&md<='10-15'&&normDest(dest).includes('zaragoza'))add('high','Fiestas del Pilar en Zaragoza (alrededor del 12 de octubre): hoteles muy caros y llenos.');
  const wkd=[...Array(days)].some((_,k)=>[5,6].includes(new Date(Date.parse(st)+k*864e5).getUTCDay()));if(wkd)add('low','Incluye fin de semana: los hoteles suelen costar más viernes y sábado.');
  add('low','Congresos, ferias, huelgas o conciertos no se pueden consultar automáticamente: revisad la agenda local del destino antes de reservar.');
  const est=s=>s?{min:Math.round(s.min),max:Math.round(s.max)}:null,mul=(r,n)=>r?{min:Math.round(r.min*n),max:Math.round(r.max*n)}:null;
  const parts={stay:mul(h?.stats.stay_per_night,nights),food:mul(h?.stats.food_per_day,days),tickets:est(h?.stats.tickets)};
  const total=Object.values(parts).filter(Boolean).reduce((a,r)=>({min:a.min+r.min,max:a.max+r.max}),{min:0,max:0});
  const leadDays=Math.round((Date.parse(st)-Date.now())/864e5),bestLead=h?.stats.lead_stay?.max||null;
  if(bestLead&&leadDays>bestLead)add('low',`Otras veces reservasteis el alojamiento con hasta ${bestLead} días de antelación: buen momento para mirar precios ya.`);
  if(leadDays<21)add('mid','Quedan menos de 3 semanas: los precios suelen subir; reservad cuanto antes.');
  const ms=new Set();for(let k=Date.parse(st);k<=Date.parse(en);k+=864e5)ms.add(new Date(k).getUTCMonth()+1);
  for(const n of all('SELECT text,month FROM dest_notes WHERE dest_key=? ORDER BY created_at',normDest(dest)))if(!n.month||ms.has(n.month))add('mid','Vuestro aviso: '+n.text);
  const insights=await destInsights(geo.name||dest,st,en);
  return {insights,area:geo.admin1||'',destination:geo.name||dest,region,days,nights,people,history:h?{trips:h.stats.trips,stats:h.stats}:null,estimate:h?{...parts,total}:null,alerts:alerts.sort((a,b)=>({high:0,mid:1,low:2}[a.level]-{high:0,mid:1,low:2}[b.level])),lead_days:leadDays};}
 async function summarizeMeeting(m){const segs=all('SELECT s.t_start,s.text,us.name AS speaker FROM meeting_segments s LEFT JOIN users us ON us.id=s.user_id WHERE meeting_id=? ORDER BY t_start',m.id);if(!segs.length)fail(400,'No hay transcripción que resumir.');
    const tr=segs.map(s=>`[${Math.floor(s.t_start/60000)}:${String(Math.floor(s.t_start/1000)%60).padStart(2,'0')}] ${s.speaker}: ${s.text}`).join('\n').slice(0,24000);
    const r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages:[{role:'system',content:'Analizas la transcripción de una reunión entre Álvaro y Angie. Usa SOLO lo que aparece en la transcripción; no inventes nada. Devuelve únicamente JSON válido: {"summary":"resumen en español, 3-6 frases","tasks":[{"title":"tarea concreta","who":"Álvaro|Angie|los dos|"}],"decisions":["decisión tomada"]}. Si no hay tareas o decisiones, listas vacías.'},{role:'user',content:tr}],max_tokens:2500,temperature:0.2});
    const raw=String(r.choices?.[0]?.message?.content||r.response||'');let j;try{j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}catch{fail(502,'La IA no devolvió un análisis válido. Vuelve a intentarlo.');}
    const tasks=(Array.isArray(j.tasks)?j.tasks:[]).slice(0,20).map(x=>({title:String(x.title||x).slice(0,180),who:String(x.who||'').slice(0,40)})).filter(x=>x.title),decisions=(Array.isArray(j.decisions)?j.decisions:[]).slice(0,20).map(x=>String(x).slice(0,300)).filter(Boolean);
    run('UPDATE meetings SET summary=?,tasks=?,decisions=?,summary_at=? WHERE id=?',String(j.summary||'').slice(0,4000),JSON.stringify(tasks),JSON.stringify(decisions),now(),m.id);return {summary:j.summary||'',tasks,decisions};}
 // Motor semántico (bge-m3): embeddings cacheados por elemento y versión; devuelve Map elemento→parecido.
 async function semScore(q,cands){const key=r=>r.type+':'+r.ref+':'+r.v,vec={};for(const r of all("SELECT query,json FROM place_cache WHERE kind='emb'"))vec[r.query]=r.json;
  const miss=cands.filter(r=>!vec[key(r)]),embed=async texts=>{const out=[];for(let i=0;i<texts.length;i+=50){const r=await env.AI.run('@cf/baai/bge-m3',{text:texts.slice(i,i+50)});out.push(...(r.data||[]));}return out;};
  const got=await embed([q,...miss.map(r=>(r.title+'. '+(r.snippet||'')).slice(0,500))]),qv=got[0];if(!qv)throw Error('Sin vector');miss.forEach((r,i)=>{if(!got[i+1])return;vec[key(r)]=JSON.stringify(got[i+1]);run("INSERT OR REPLACE INTO place_cache(kind,query,json,fetched_at) VALUES('emb',?,?,?)",key(r),vec[key(r)],now());});
  const cos=(a,b)=>{let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i];}return d/Math.sqrt(x*y||1);},out=new Map();for(const r of cands)if(vec[key(r)])out.set(r,Math.round(cos(qv,JSON.parse(vec[key(r)]))*100)/100);return out;}
 // Memoria de la pareja: todo lo guardado (planes, gastos con quién pagó, reservas, reuniones, notas, ideas, conversaciones) para que Dupla responda con datos reales.
 async function historia(q,scope){const users=Object.fromEntries(all('SELECT id,name FROM users').map(x=>[x.id,x.name.split(' ')[0]])),eur=v=>(Math.round(v*100)/100).toLocaleString('es-ES')+' €';
  const c=[...all("SELECT 'proyecto' AS type,id AS ref,title,trim(coalesce(destination,'')||' '||coalesce(start_date,'')||' '||coalesce(end_date,'')||' '||substr(description,1,300)) AS snippet,space,updated_at AS v,coalesce(start_date,substr(created_at,1,10)) AS fecha,title AS proyecto FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 80"),
   ...all("SELECT 'gasto' AS type,e.id AS ref,e.title,e.category||' · '||e.actual||' € reales · '||e.estimated||' € previstos'||coalesce(' · pagó '||e.paid_by,'') AS snippet,p.space,e.updated_at AS v,coalesce(e.booked_at,substr(e.created_at,1,10)) AS fecha,p.title AS proyecto FROM expenses e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL ORDER BY e.updated_at DESC LIMIT 150"),
   ...all("SELECT 'reserva' AS type,s.id AS ref,s.title,trim(s.location||' '||s.visit_time||' '||s.reference||' '||substr(s.details,1,200)) AS snippet,p.space,s.updated_at AS v,s.visit_date AS fecha,p.title AS proyecto FROM trip_stops s JOIN projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL ORDER BY s.visit_date DESC LIMIT 120"),
   ...all("SELECT 'plan' AS type,e.id AS ref,e.title,trim(e.location||' '||substr(e.notes,1,200)) AS snippet,p.space,e.created_at AS v,e.event_date AS fecha,p.title AS proyecto FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL ORDER BY e.event_date DESC LIMIT 80"),
   ...all("SELECT 'reunión' AS type,m.id AS ref,m.title,substr(coalesce(m.summary,''),1,600)||' '||coalesce(m.decisions,'') AS snippet,coalesce(p.space,'work') AS space,coalesce(m.summary_at,m.created_at) AS v,substr(m.created_at,1,10) AS fecha,coalesce(p.title,'') AS proyecto FROM meetings m LEFT JOIN projects p ON p.id=m.project_id ORDER BY m.created_at DESC LIMIT 40"),
   ...all("SELECT 'nota' AS type,s.id AS ref,s.title,substr(s.content,1,500) AS snippet,p.space,s.updated_at AS v,substr(s.updated_at,1,10) AS fecha,p.title AS proyecto FROM sections s JOIN projects p ON p.id=s.project_id WHERE p.deleted_at IS NULL AND length(s.content)>0 ORDER BY s.updated_at DESC LIMIT 80"),
   ...all("SELECT 'idea' AS type,id AS ref,title,substr(body,1,300) AS snippet,space,updated_at AS v,substr(created_at,1,10) AS fecha,'' AS proyecto FROM ideas ORDER BY updated_at DESC LIMIT 60"),
   ...all("SELECT 'comentario' AS type,c.id AS ref,substr(c.content,1,80) AS title,substr(c.content,1,400) AS snippet,p.space,c.created_at AS v,substr(c.created_at,1,10) AS fecha,p.title AS proyecto FROM comments c JOIN projects p ON p.id=c.project_id WHERE p.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 80")]
   .filter(r=>inScope(scope,r.space)).map(r=>({...r,snippet:String(r.snippet||'').replace(/pagó ([a-f0-9-]{36})/,(_,id)=>'pagó '+(users[id]||'?'))}));
  if(!c.length)return {resultados:[]};let sc=new Map();if(env.AI)try{sc=await semScore(q,c);}catch(ex){console.error('historia',ex);}
  const ql=String(q).toLowerCase(),words=ql.split(/\W+/u).filter(w=>w.length>3),lex=r=>words.filter(w=>(r.title+' '+r.snippet+' '+r.proyecto).toLowerCase().includes(w)).length/(words.length||1);
  const top=c.map(r=>({r,s:Math.max(sc.get(r)||0,0.35+lex(r)*0.5)})).filter(x=>x.s>=0.45).sort((a,b)=>b.s-a.s).slice(0,14).map(({r})=>({tipo:r.type,titulo:r.title,detalle:r.snippet.slice(0,300),proyecto:r.proyecto,fecha:r.fecha}));
  const gastos=top.filter(x=>x.tipo==='gasto'),tot={};for(const g of gastos){const m=/([\d.]+) € reales/.exec(g.detalle);if(m)tot[g.proyecto]=(tot[g.proyecto]||0)+Number(m[1]);}
  return {resultados:top,...(gastos.length?{gasto_real_por_proyecto_en_resultados:Object.fromEntries(Object.entries(tot).map(([k,v])=>[k,eur(v)]))}:{}),nota:'Responde solo con estos datos; si no bastan, usa ver_proyecto o di que no consta.'};}
 async function route(req,res,url,u){
  const path=url.pathname;
  // R0205: búsqueda semántica básica con Workers AI (bge-m3, multilingüe); solo si la IA está activa. Embeddings cacheados.
  if(path==='/api/search/semantic'&&req.method==='GET'){const q=requireText(url.searchParams.get('q')||'','Búsqueda',100);if(!env.AI){respond(res,200,{available:false,items:[]});return true;}
   const space=['work','couple'].includes(url.searchParams.get('space'))?url.searchParams.get('space'):'',only=url.searchParams.get('project')?project(url.searchParams.get('project')).id:'';
   const cands=[...all("SELECT 'project' AS type,id AS ref,id AS project_id,title,substr(description,1,300) AS snippet,space,updated_at AS v FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 60"),
    ...all("SELECT 'idea' AS type,id AS ref,project_id,title,substr(body,1,300) AS snippet,space,updated_at AS v FROM ideas ORDER BY updated_at DESC LIMIT 60"),
    ...all("SELECT 'tasks' AS type,t.id AS ref,t.project_id,t.title,substr(t.description,1,300) AS snippet,p.space,t.updated_at AS v FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 60"),
    ...all("SELECT 'events' AS type,e.id AS ref,e.project_id,e.title,substr(e.notes,1,300) AS snippet,p.space,e.created_at AS v FROM events e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL ORDER BY e.event_date DESC LIMIT 40")]
    .filter(r=>(!space||r.space===space)&&(!only||r.project_id===only));
   if(!cands.length){respond(res,200,{available:true,items:[]});return true;}
   let scored;try{scored=await semScore(q,cands);}catch(ex){console.error('Búsqueda semántica',ex);respond(res,200,{available:true,error:'La IA no respondió; se muestran solo coincidencias exactas.',items:[]});return true;}
   const ql=q.toLowerCase(),items=cands.filter(r=>scored.has(r)).filter(r=>!r.title.toLowerCase().includes(ql)&&!(r.snippet||'').toLowerCase().includes(ql)).map(r=>({type:r.type,id:r.ref,project_id:r.project_id,title:r.title,snippet:r.snippet,space:r.space,score:scored.get(r)})).filter(r=>r.score>=0.45).sort((a,b)=>b.score-a.score).slice(0,8);
   respond(res,200,{available:true,items});return true;}
  // R0349-R0363: cronología con filtros por persona, espacio y proyecto (el tipo se filtra en el navegador).
  // R0341: expandir una idea con IA (opcional). Devuelve una propuesta marcada como generada; nada se guarda sin confirmar.
  const ex=path.match(/^\/api\/ideas\/([a-f0-9-]{36})\/expand$/);
  if(ex&&req.method==='POST'){const idea=get('SELECT * FROM ideas WHERE id=?',ex[1]);if(!idea)fail(404,'Idea no encontrada');if(!env.AI)fail(503,'La IA no está activada en este servidor.');
   const r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages:[{role:'system',content:'Eres Dupla, ayudas a una pareja (Álvaro y Angie) a desarrollar ideas. Responde SOLO en español, en texto plano con estas secciones cortas: Objetivo, Primeros pasos (3-5 viñetas con «- »), Qué necesitáis, Posibles riesgos, Siguiente acción concreta. No inventes datos concretos (precios, fechas, nombres) que no estén en la idea. Máximo 180 palabras.'},{role:'user',content:`Idea (${idea.space==='work'?'trabajo':'vida en pareja'}): ${idea.title}\n${idea.body||''}`}],max_tokens:2000,temperature:0.4});
   const text=String(r.choices?.[0]?.message?.content||r.response||'').trim().slice(0,3000);if(!text)fail(502,'La IA no devolvió texto. Inténtalo de nuevo.');respond(res,200,{text,generated:true});return true;}
  const logSpace=(user,action,detail,pid)=>pid?logChange(project(pid),user,action,detail):logFree(user,'couple',action,detail);
  // Nuestro espacio: deseos, regalos, metas, casa y recuerdos (con foto).
  if(path==='/api/couple-items'&&req.method==='GET'){respond(res,200,{items:all('SELECT c.*,us.name AS author,p.title AS project_title FROM couple_items c LEFT JOIN users us ON us.id=c.created_by LEFT JOIN projects p ON p.id=c.project_id ORDER BY c.done ASC,COALESCE(c.item_date,c.created_at) DESC LIMIT 1000')});return true;}
  const ci=path.match(/^\/api\/couple-items(?:\/([a-f0-9-]{36}))?(?:\/(photo))?$/);
  if(ci){const item=ci[1]?get('SELECT * FROM couple_items WHERE id=?',ci[1]):null;if(ci[1]&&!item)fail(404,'Elemento no encontrado');
   const label={wish:'deseo',gift:'regalo',goal:'meta',home:'tarea de casa',memory:'recuerdo'};
   const fields=(b,prev={})=>({title:b.title===undefined?prev.title:requireText(b.title,'Título',160),body:b.body===undefined?(prev.body||''):optional(b.body,3000),item_date:b.item_date===undefined?(prev.item_date||null):validDate(b.item_date),price:b.price===undefined?(prev.price??null):(b.price===''||b.price===null?null:money(b.price)),url:b.url===undefined?(prev.url||''):(b.url?(/^https:\/\/[^\s]{3,500}$/.test(String(b.url))?String(b.url):fail(400,'El enlace debe empezar por https://')):''),person:b.person===undefined?(prev.person||''):optional(b.person,80),progress:b.progress===undefined?(prev.progress||0):Math.max(0,Math.min(100,Math.round(Number(b.progress)||0))),done:b.done===undefined?(prev.done||0):(b.done?1:0),project_id:b.project_id===undefined?(prev.project_id||null):(b.project_id?project(String(b.project_id)).id:null)});
   if(!ci[1]&&req.method==='POST'){const b=await readBody(req),kind=choice(b.kind,Object.keys(label)),f=fields(b),id=uid(),t=now();run('INSERT INTO couple_items(id,kind,title,body,item_date,price,url,person,progress,done,project_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,kind,f.title,f.body,f.item_date,f.price,f.url,f.person,f.progress,f.done,f.project_id,u.id,t,t);
    logSpace(u,'añadió '+(kind==='memory'?'un recuerdo':kind==='home'?'una tarea de casa':kind==='goal'?'una meta':kind==='gift'?'un regalo':'un deseo'),f.title,f.project_id);respond(res,201,{item:get('SELECT * FROM couple_items WHERE id=?',id)});return true;}
   if(item&&!ci[2]&&req.method==='PATCH'){const b=await readBody(req),f=fields(b,item);run('UPDATE couple_items SET title=?,body=?,item_date=?,price=?,url=?,person=?,progress=?,done=?,project_id=?,updated_at=? WHERE id=?',f.title,f.body,f.item_date,f.price,f.url,f.person,f.progress,f.done,f.project_id,now(),item.id);
    logSpace(u,b.done===true&&!item.done?'completó '+(item.kind==='memory'?'un recuerdo':'«'+label[item.kind]+'»'):'actualizó '+label[item.kind],f.title,f.project_id);respond(res,200,{item:get('SELECT * FROM couple_items WHERE id=?',item.id)});return true;}
   if(item&&!ci[2]&&req.method==='DELETE'){if(item.photo){try{removeFile(item.photo);}catch{}}run('DELETE FROM couple_items WHERE id=?',item.id);logSpace(u,'eliminó '+label[item.kind],item.title,item.project_id);respond(res,200,{ok:true});return true;}
   if(item&&ci[2]&&req.method==='POST'){const b=await readBody(req);if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64))fail(400,'Contenido base64 inválido');const f=Buffer.from(b.base64,'base64');if(!f.length||f.length>6*1024*1024)fail(413,'La foto debe ocupar menos de 6 MB');if(!isImage(f))fail(415,'Sube una foto JPG, PNG o WebP');
    const name=uid();saveFile(name,f);if(item.photo){try{removeFile(item.photo);}catch{}}run('UPDATE couple_items SET photo=?,updated_at=? WHERE id=?',name,now(),item.id);logSpace(u,'añadió una foto a un recuerdo',item.title,item.project_id);respond(res,200,{ok:true});return true;}
   if(item&&ci[2]&&req.method==='GET'){if(!item.photo||!fileExists(item.photo))fail(404,'Sin foto');const f=readFile(item.photo);res.writeHead(200,{'Content-Type':imageMime(f),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(f);return true;}
  }
  const qm=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/quote$/);
  if(qm){const p=project(qm[1]);if(p.space!=='work')fail(403,'La calculadora freelance es para proyectos de Trabajo');
   if(req.method==='GET'){const r=get('SELECT data,updated_at,us.name AS author FROM project_quotes q LEFT JOIN users us ON us.id=q.updated_by WHERE project_id=?',p.id);respond(res,200,{quote:r?JSON.parse(r.data):null,updated_at:r?.updated_at||null,author:r?.author||null});return true;}
   if(req.method==='PUT'){const b=await readBody(req),num=(v,min,max,def)=>{const n=Number(v);if(v===undefined||v==='')return def;if(!Number.isFinite(n)||n<min||n>max)fail(400,'Valor fuera de rango');return Math.round(n*100)/100;};
    const q={hours:num(b.hours,0,10000,0),rate:num(b.rate,0,1000,30),difficulty:num(b.difficulty,1,5,2),complexity:choice(b.complexity,['low','mid','high'],'low'),urgency:choice(b.urgency,['normal','priority','urgent'],'normal'),demand:choice(b.demand,['standard','demanding','very'],'standard'),revisions:num(b.revisions,0,20,2),extras:num(b.extras,0,1e6,0),extras_desc:optional(b.extras_desc,300),requirements:optional(b.requirements,3000),client:optional(b.client,160),vat:b.vat!==false,irpf:choice(String(b.irpf??'15'),['0','7','15'],'15')};
    run('INSERT INTO project_quotes(project_id,data,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at',p.id,JSON.stringify(q),u.id,now());logChange(p,u,'actualizó el presupuesto freelance',q.client||p.title);respond(res,200,{quote:q});return true;}}
  // R0440/R0451: presupuesto común de Nuestro espacio, separado del de Trabajo.
  if(path==='/api/budget/summary'&&req.method==='GET'){const space=choice(url.searchParams.get('space'),['work','couple']);
   respond(res,200,{space,by_category:all('SELECT x.category,SUM(x.estimated) AS estimated,SUM(x.actual) AS actual FROM expenses x JOIN projects p ON p.id=x.project_id WHERE p.deleted_at IS NULL AND p.space=? GROUP BY x.category ORDER BY SUM(x.estimated) DESC',space),
    by_project:all('SELECT p.id,p.title,p.kind,p.destination,p.start_date,SUM(x.estimated) AS estimated,SUM(x.actual) AS actual FROM projects p JOIN expenses x ON x.project_id=p.id WHERE p.deleted_at IS NULL AND p.space=? GROUP BY p.id ORDER BY p.start_date IS NULL,p.start_date',space),
    wishes:space==='couple'?get("SELECT COUNT(*) AS n,COALESCE(SUM(price),0) AS total FROM couple_items WHERE kind='wish' AND done=0"):null});return true;}
  // ---- Reuniones ----
  if(path==='/api/meetings'&&req.method==='GET'){respond(res,200,{items:all('SELECT m.id,m.title,m.status,m.project_id,m.idea_id,m.meet_url,m.google_event_id,m.created_at,m.started_at,m.ended_at,m.summary_at,p.title AS project_title,p.space,p.kind AS project_kind,p.destination,i.title AS idea_title,us.name AS author,(SELECT COUNT(*) FROM meeting_segments s WHERE s.meeting_id=m.id) AS segments FROM meetings m LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN ideas i ON i.id=m.idea_id LEFT JOIN users us ON us.id=m.created_by ORDER BY m.created_at DESC LIMIT 200')});return true;}
  if(path==='/api/meetings'&&req.method==='POST'){const b=await readBody(req),id=uid(),pid=b.project_id?project(String(b.project_id)).id:null,iid=b.idea_id?(get('SELECT id FROM ideas WHERE id=?',String(b.idea_id))?.id||fail(404,'Idea no encontrada')):null;
   const meet=b.meet_url?(/^https:\/\/(meet\.google\.com|[a-z0-9.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"]{1,300}$/i.test(String(b.meet_url))?String(b.meet_url):fail(400,'Enlace de videollamada no válido')):null,gev=b.google_event_id?(/^[A-Za-z0-9_-]{1,180}$/.test(String(b.google_event_id))?String(b.google_event_id):fail(400,'Evento no válido')):null;
   if(gev){const ex=get('SELECT * FROM meetings WHERE google_event_id=?',gev);if(ex){respond(res,200,{meeting:ex});return true;}}
   run('INSERT INTO meetings(id,title,project_id,idea_id,created_by,created_at,meet_url,google_event_id) VALUES(?,?,?,?,?,?,?,?)',id,requireText(b.title,'Título',160),pid,iid,u.id,now(),meet,gev);
   if(pid)logChange(project(pid),u,'creó una reunión',b.title);else logFree(u,'couple','creó una reunión',b.title);respond(res,201,{meeting:get('SELECT * FROM meetings WHERE id=?',id)});return true;}
  const ma=path.match(/^\/api\/meetings\/([a-f0-9-]{36})\/audio\/([a-f0-9-]{36})$/);
  if(ma&&req.method==='GET'){const x=get('SELECT audio FROM meeting_segments WHERE id=? AND meeting_id=?',ma[2],ma[1]);if(!x?.audio)fail(404,'Sin grabación');const [name,mime]=x.audio.split('|');if(!fileExists(name))fail(404,'Grabación no encontrada');const f=readFile(name);res.writeHead(200,{'Content-Type':mime,'Content-Length':String(f.length),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(f);return true;}
  const mt=path.match(/^\/api\/meetings\/([a-f0-9-]{36})(?:\/(start|end|audio|signal|summarize|transcript))?$/);
  if(mt){const m=get('SELECT * FROM meetings WHERE id=?',mt[1]);if(!m)fail(404,'Reunión no encontrada');const act=mt[2]||'';
   const log=(a)=>m.project_id?logChange(project(m.project_id),u,a,m.title):logFree(u,'couple',a,m.title);
   if(!act&&req.method==='GET'){respond(res,200,{meeting:{...m,tasks:JSON.parse(m.tasks||'[]'),decisions:JSON.parse(m.decisions||'[]'),project_title:m.project_id?get('SELECT title FROM projects WHERE id=?',m.project_id)?.title:null,idea_title:m.idea_id?get('SELECT title FROM ideas WHERE id=?',m.idea_id)?.title:null},segments:all('SELECT s.id,s.user_id,s.t_start,s.text,(s.audio IS NOT NULL) AS has_audio,us.name AS speaker FROM meeting_segments s LEFT JOIN users us ON us.id=s.user_id WHERE s.meeting_id=? ORDER BY s.t_start,s.created_at',m.id),ai:Boolean(env.AI)});return true;}
   if(act==='transcript'&&req.method==='GET'){const segs=all('SELECT s.t_start,s.text,us.name AS speaker FROM meeting_segments s LEFT JOIN users us ON us.id=s.user_id WHERE s.meeting_id=? ORDER BY s.t_start',m.id);const fm=ms=>`${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}`;
    const txt=`${m.title}\n${m.started_at||m.created_at}\n\nTRANSCRIPCIÓN (automática, tal cual se reconoció)\n\n`+segs.map(x=>`[${fm(x.t_start)}] ${x.speaker}: ${x.text}`).join('\n')+(m.summary?`\n\n---\nRESUMEN (generado por IA, no es la transcripción)\n${m.summary}\n\nTareas: ${JSON.parse(m.tasks||'[]').map(x=>x.title).join('; ')||'—'}\nDecisiones: ${JSON.parse(m.decisions||'[]').join('; ')||'—'}`:'');
    res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="reunion-${(m.started_at||m.created_at).slice(0,10)}.txt"`,'Cache-Control':'no-store'});res.end(txt);return true;}
   if(!act&&req.method==='DELETE'){for(const x of all('SELECT audio FROM meeting_segments WHERE meeting_id=? AND audio IS NOT NULL',m.id)){try{removeFile(x.audio.split('|')[0]);}catch{}}run('DELETE FROM meetings WHERE id=?',m.id);log('eliminó una reunión');respond(res,200,{ok:true});return true;}
   if(act==='start'&&req.method==='POST'){if(m.status!=='live')run("UPDATE meetings SET status='live',started_at=COALESCE(started_at,?),ended_at=NULL WHERE id=?",now(),m.id);if(m.status==='scheduled')log('empezó una reunión');respond(res,200,{meeting:get('SELECT * FROM meetings WHERE id=?',m.id)});return true;}
   if(act==='end'&&req.method==='POST'){if(m.status==='live'){run("UPDATE meetings SET status='ended',ended_at=? WHERE id=?",now(),m.id);run('DELETE FROM meeting_signals WHERE meeting_id=?',m.id);log('terminó una reunión');}
    // Al terminar se resume solo (aparte de la transcripción), si hay algo que resumir.
    let summary=null;if(env.AI&&!m.summary_at&&get('SELECT 1 AS ok FROM meeting_segments WHERE meeting_id=?',m.id)){try{summary=await summarizeMeeting(get('SELECT * FROM meetings WHERE id=?',m.id));}catch(ex){console.error('Resumen automático',String(ex.message||ex).slice(0,120));}}
    respond(res,200,{ok:true,summary:!!summary});return true;}
   if(act==='signal'&&req.method==='POST'){const b=await readBody(req),data=JSON.stringify(b.data??null);if(data.length>60000)fail(413,'Señal demasiado grande');run('DELETE FROM meeting_signals WHERE created_at<?',Date.now()-10*60e3);run('INSERT INTO meeting_signals(meeting_id,from_user,data,created_at) VALUES(?,?,?,?)',m.id,u.id,data,Date.now());respond(res,200,{ok:true});return true;}
   if(act==='signal'&&req.method==='GET'){const after=Number(url.searchParams.get('after')||0);respond(res,200,{items:all('SELECT id,from_user,data FROM meeting_signals WHERE meeting_id=? AND id>? AND from_user!=? ORDER BY id LIMIT 100',m.id,Number.isFinite(after)?after:0,u.id).map(r=>({id:r.id,from:r.from_user,data:JSON.parse(r.data)})),last:get('SELECT COALESCE(MAX(id),0) AS n FROM meeting_signals WHERE meeting_id=?',m.id).n});return true;}
   // Transcripción fiel: lo que reconoce Whisper de CADA micrófono, sin reescribir; se guarda con persona y minuto.
   if(act==='audio'&&req.method==='POST'){if(!env.AI)fail(503,'La transcripción necesita la IA del servidor (Workers AI).');const b=await readBody(req);const t=Math.round(Number(b.t_start));if(!Number.isFinite(t)||t<0||t>24*3600e3)fail(400,'Tiempo no válido');
    if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64)||b.base64.length<200)fail(400,'Audio no válido');if(b.base64.length>8e6)fail(413,'Tramo de audio demasiado grande');
    const r=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:b.base64,language:'es',vad_filter:true});const text=String(r?.text||'').replace(/\s+/g,' ').trim();
    if(!text){respond(res,200,{segment:null});return true;}const id=uid(),mime=/^audio\/(webm|mp4|ogg|mpeg|wav|x-m4a)/.test(String(b.mime||''))?String(b.mime).split(';')[0]:'audio/webm';const fname=uid();saveFile(fname,Buffer.from(b.base64,'base64'));run('INSERT INTO meeting_segments(id,meeting_id,user_id,t_start,text,created_at,audio) VALUES(?,?,?,?,?,?,?)',id,m.id,u.id,t,text.slice(0,20000),now(),fname+'|'+mime);respond(res,201,{segment:{id,user_id:u.id,t_start:t,text,speaker:u.name}});return true;}
   // Resumen, tareas y decisiones: generados por IA, guardados APARTE de la transcripción.
   if(act==='summarize'&&req.method==='POST'){if(!env.AI)fail(503,'La IA no está activada en este servidor.');const r=await summarizeMeeting(m);log('generó el resumen de una reunión');respond(res,200,r);return true;}
  }
  // ---- Director General: análisis por espacio con datos reales; nada se ejecuta sin aprobación ----
  if(path==='/api/director'&&req.method==='GET'){const space=choice(url.searchParams.get('space')||'work',['work','couple']);respond(res,200,{space,generated_at:now(),items:directorSuggestions(space)});return true;}
  const dr=path.match(/^\/api\/director\/(work|couple)\/([a-z]+-[A-Za-z0-9-]{1,80})$/);
  if(dr&&req.method==='POST'){const space=dr[1],b=await readBody(req),to=choice(b.status,['proposal','review','approved','executed','discarded']);const s=directorSuggestions(space).find(x=>x.id===dr[2]);const prev=get('SELECT * FROM director_states WHERE id=?',dr[2]);
   if(!s&&!prev)fail(409,'Esta sugerencia ya no está vigente. Actualizad el análisis.');const cur=prev?.status||'proposal';
   if(cur==='executed'&&to!=='executed')fail(409,'Ya está ejecutada');if(to==='executed'&&cur!=='approved')fail(403,'Primero hay que aprobarla');
   let taskId=prev?.task_id||null;
   if(to==='executed'&&s?.task&&s.project_id&&!taskId){const p=project(s.project_id),ex=get("SELECT id FROM tasks WHERE project_id=? AND title=? AND state!='done'",p.id,s.task);taskId=ex?.id;if(!taskId){taskId=uid();const t=now();run('INSERT INTO tasks(id,project_id,title,description,state,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',taskId,p.id,s.task,s.detail,'todo',s.severity==='high'?'high':'normal',u.id,t,t);}logChange(p,u,'ejecutó una propuesta del Director',s.task);}
   run('INSERT INTO director_states(id,space,status,task_id,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,task_id=excluded.task_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at',dr[2],space,to,taskId,u.id,now());
   respond(res,200,{status:to,task_id:taskId});return true;}
  // Videollamada: servidores ICE. Con TURN de Cloudflare (credenciales temporales de 24 h) conecta también en redes cerradas.
  if(path==='/api/rtc/ice'&&req.method==='GET'){const stun={urls:['stun:stun.cloudflare.com:3478','stun:stun.l.google.com:19302']};
   if(!env.TURN_KEY_ID||!env.TURN_KEY_API_TOKEN){respond(res,200,{iceServers:[stun],turn:false});return true;}
   try{const r=await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,{method:'POST',headers:{Authorization:'Bearer '+env.TURN_KEY_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({ttl:86400}),signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();const list=Array.isArray(j.iceServers)?j.iceServers:j.iceServers?[j.iceServers]:[];
    respond(res,200,{iceServers:list.length?list:[stun],turn:list.length>0});}catch(ex){console.error('TURN',String(ex.message||ex).slice(0,120));respond(res,200,{iceServers:[stun],turn:false});}return true;}
  // ---- Tablero de tareas (independiente de Trabajo y Nuestro espacio) ----
  if(path==='/api/board'&&req.method==='GET'){respond(res,200,{items:all('SELECT b.*,us.name AS assignee_name,c.name AS author,(SELECT COUNT(*) FROM task_notes n WHERE n.board_id=b.id) AS notes_count FROM board_tasks b LEFT JOIN users us ON us.id=b.assignee LEFT JOIN users c ON c.id=b.created_by ORDER BY b.sort,b.created_at')});return true;}
  const bt=path.match(/^\/api\/board(?:\/([a-f0-9-]{36}))?$/);
  if(bt&&['POST','PATCH','DELETE'].includes(req.method)){const row=bt[1]?get('SELECT * FROM board_tasks WHERE id=?',bt[1]):null;if(bt[1]&&!row)fail(404,'Tarea no encontrada');if(!bt[1]&&req.method!=='POST')fail(405,'Método no permitido');
   if(req.method==='DELETE'){run('UPDATE board_tasks SET parent_id=NULL WHERE parent_id=?',row.id);const nf=all('SELECT stored_name FROM task_notes WHERE board_id=? AND stored_name IS NOT NULL',row.id);run('DELETE FROM board_tasks WHERE id=?',row.id);for(const f of nf)try{removeFile(f.stored_name);}catch{}logFree(u,'couple','eliminó una tarea del tablero',row.title);respond(res,200,{ok:true});return true;}
   const b=await readBody(req),prev=row||{},f={title:b.title===undefined?prev.title:requireText(b.title,'Tarea',200),notes:b.notes===undefined?(prev.notes||''):optional(b.notes,3000),status:b.status===undefined?(prev.status||'todo'):choice(b.status,['todo','doing','blocked','done']),priority:b.priority===undefined?(prev.priority||'normal'):choice(b.priority,['low','normal','high','urgent']),
    assignee:b.assignee===undefined?(prev.assignee||null):(b.assignee?(get('SELECT id FROM users WHERE id=?',String(b.assignee))?.id||fail(400,'Persona no válida')):null),due_date:b.due_date===undefined?(prev.due_date||null):validDate(b.due_date),sort:b.sort===undefined?(prev.sort??Date.now()):Number(b.sort)||0,
    parent_id:b.parent_id===undefined?(prev.parent_id||null):(b.parent_id?String(b.parent_id):null)};
   if(f.parent_id){if(f.parent_id===prev.id)fail(400,'Una tarea no puede depender de sí misma');let p=get('SELECT id,parent_id FROM board_tasks WHERE id=?',f.parent_id);if(!p)fail(400,'Tarea padre no encontrada');for(let k=0;p&&k<50;k++){if(p.id===prev.id)fail(400,'Eso crearía un círculo de dependencias');p=p.parent_id?get('SELECT id,parent_id FROM board_tasks WHERE id=?',p.parent_id):null;}}
   // Sin la tarea padre terminada, la hija no puede cerrarse.
   if(f.status==='done'&&f.parent_id){const par=get('SELECT title,status FROM board_tasks WHERE id=?',f.parent_id);if(par&&par.status!=='done')fail(409,`No se puede terminar: primero hay que terminar «${par.title}».`);}
   const t=now(),doneAt=f.status==='done'?(prev.done_at||t):null;
   if(!row){const id=uid();run('INSERT INTO board_tasks(id,title,notes,status,assignee,priority,parent_id,due_date,sort,created_by,created_at,updated_at,done_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,f.title,f.notes,f.status,f.assignee,f.priority,f.parent_id,f.due_date,f.sort,u.id,t,t,doneAt);logFree(u,'couple',f.assignee&&f.assignee!==u.id?'te asignó una tarea':'añadió una tarea al tablero',f.title);respond(res,201,{item:get('SELECT * FROM board_tasks WHERE id=?',id)});return true;}
   run('UPDATE board_tasks SET title=?,notes=?,status=?,assignee=?,priority=?,parent_id=?,due_date=?,sort=?,updated_at=?,done_at=? WHERE id=?',f.title,f.notes,f.status,f.assignee,f.priority,f.parent_id,f.due_date,f.sort,t,doneAt,row.id);
   const st={todo:'Pendiente',doing:'En proceso',blocked:'Parado',done:'Terminado'};if(f.status!==row.status)logFree(u,'couple','movió una tarea a «'+st[f.status]+'»',f.title);else if(f.assignee!==row.assignee&&f.assignee&&f.assignee!==u.id)logFree(u,'couple','te asignó una tarea',f.title);
   respond(res,200,{item:get('SELECT * FROM board_tasks WHERE id=?',row.id)});return true;}
  // Notas de avance dentro de una tarea (de proyecto o del tablero): quedan en la tarea y avisan al otro.
  const tn=path.match(/^\/api\/task-notes(?:\/([a-f0-9-]{36})(\/file)?)?$/);
  if(tn){const target=(kind,id)=>{id=String(id||'');if(kind==='board'){const r=get('SELECT id,title FROM board_tasks WHERE id=?',id)||fail(404,'Tarea no encontrada');return {col:'board_id',id:r.id,title:r.title,pid:null};}
    const r=get('SELECT id,title,project_id FROM tasks WHERE id=?',id)||fail(404,'Tarea no encontrada');project(r.project_id);return {col:'task_id',id:r.id,title:r.title,pid:r.project_id};};
   const list=t=>all(`SELECT n.id,n.kind,n.content,n.created_at,n.user_id,n.file_name,n.file_mime,n.file_size,us.name AS author FROM task_notes n LEFT JOIN users us ON us.id=n.user_id WHERE n.${t.col}=? ORDER BY n.created_at`,t.id);
   if(req.method==='GET'&&tn[2]){const n=get('SELECT * FROM task_notes WHERE id=?',tn[1])||fail(404,'Nota no encontrada');if(n.task_id)target('project',n.task_id);if(!n.stored_name||!fileExists(n.stored_name))fail(404,'Archivo no encontrado');
    const safe=n.file_name.replace(/["\\\r\n]/g,'_'),inline=/^image\/(png|jpeg|webp|gif)$/.test(n.file_mime)||n.file_mime==='application/pdf';
    res.writeHead(200,{'Content-Type':inline?n.file_mime:'application/octet-stream','Content-Disposition':`${inline&&url.searchParams.get('dl')!=='1'?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(safe)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(readFile(n.stored_name));return true;}
   if(req.method==='GET'&&!tn[1]){respond(res,200,{items:list(target(url.searchParams.get('kind'),url.searchParams.get('id')))});return true;}
   if(req.method==='POST'&&!tn[1]){const b=await readBody(req),t=target(b.kind_of,b.id),kind=choice(b.kind||'avance',['avance','ayuda','bloqueo','falta']);let file=null,fname='',fmime='';
    if(b.file){fname=requireText(b.file.name,'Nombre del archivo',180);fmime=choice(b.file.mime,['image/png','image/jpeg','image/webp','image/gif','application/pdf','text/plain','text/markdown','application/octet-stream'],'application/octet-stream');
     if(typeof b.file.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.file.base64))fail(400,'Contenido base64 inválido');
     file=Buffer.from(b.file.base64,'base64');if(!file.length||file.length>6*1024*1024)fail(413,'Máximo 6 MB por archivo');
     const sig={'image/png':f=>f.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'image/jpeg':f=>f[0]===255&&f[1]===216&&f[2]===255,'image/gif':f=>/^GIF8[79]a/.test(f.toString('ascii',0,6)),'image/webp':f=>f.toString('ascii',0,4)==='RIFF'&&f.toString('ascii',8,12)==='WEBP','application/pdf':f=>f.toString('ascii',0,5)==='%PDF-'};
     if(sig[fmime]&&!sig[fmime](file))fail(415,'El contenido no coincide con el tipo de archivo declarado');}
    const content=file?(optional(b.content,2000)||''):requireText(b.content,'Nota',2000),stored=file?uid():null;if(file)saveFile(stored,file);
    run(`INSERT INTO task_notes(id,${t.col},user_id,kind,content,created_at,stored_name,file_name,file_mime,file_size) VALUES(?,?,?,?,?,?,?,?,?,?)`,uid(),t.id,u.id,kind,content,now(),stored,fname,fmime,file?file.length:0);
    const act=file?'subió un archivo a una tarea':{avance:'apuntó un avance en una tarea',ayuda:'echó una mano en una tarea',bloqueo:'avisó de un bloqueo en una tarea',falta:'pidió información en una tarea'}[kind],det=`${t.title}: ${file?fname+(content?' · '+content:''):content}`.slice(0,220);
    if(t.pid)logChange(project(t.pid),u,act,det);else logFree(u,'couple',act,det);respond(res,201,{items:list(t)});return true;}
   if(req.method==='DELETE'&&tn[1]&&!tn[2]){const n=get('SELECT * FROM task_notes WHERE id=?',tn[1])||fail(404,'Nota no encontrada');if(n.user_id!==u.id)fail(403,'Solo quien escribió la nota puede borrarla');run('DELETE FROM task_notes WHERE id=?',n.id);if(n.stored_name){try{removeFile(n.stored_name);}catch{}}respond(res,200,{ok:true});return true;}
   fail(405,'Método no permitido');}
  // ---- Historial de presupuestos por destino y previsión del próximo viaje ----
  if(path==='/api/budget/notes'&&req.method==='GET'){const d=url.searchParams.get('destination');respond(res,200,{items:all('SELECT n.*,us.name AS author FROM dest_notes n LEFT JOIN users us ON us.id=n.created_by'+(d?' WHERE dest_key=?':'')+' ORDER BY dest,month',...(d?[normDest(d)]:[]))});return true;}
  if(path==='/api/budget/notes'&&req.method==='POST'){const b=await readBody(req),dest=requireText(b.destination,'Destino',120),month=Number(b.month)||0;if(month<0||month>12)fail(400,'Mes no válido');const id=uid();run('INSERT INTO dest_notes(id,dest_key,dest,month,text,created_by,created_at) VALUES(?,?,?,?,?,?,?)',id,normDest(dest),dest,month,requireText(b.text,'Aviso',300),u.id,now());logFree(u,'couple','añadió un aviso de destino',dest);respond(res,201,{id});return true;}
  const dn=path.match(/^\/api\/budget\/notes\/([a-f0-9-]{36})$/);if(dn&&req.method==='DELETE'){run('DELETE FROM dest_notes WHERE id=?',dn[1]);respond(res,200,{ok:true});return true;}
  if(path==='/api/budget/history'&&req.method==='GET'){respond(res,200,budgetHistory());return true;}
  if(path==='/api/budget/forecast'&&req.method==='GET'){const dest=requireText(url.searchParams.get('destination')||'','Destino',120),st=validDate(url.searchParams.get('start')),en=validDate(url.searchParams.get('end'))||st;if(!st||en<st)fail(400,'Fechas no válidas');const people=Math.min(Math.max(Number(url.searchParams.get('people'))||2,1),12);respond(res,200,await budgetForecast(dest,st,en,people));return true;}
  if(path==='/api/activity'&&req.method==='GET'){const q=url.searchParams,where=['(p.id IS NULL OR p.deleted_at IS NULL)'],args=[];
   const person=q.get('user')||'',space=q.get('space')||'',proj=q.get('project')||'',before=q.get('before')||'';
   if(person){if(!get('SELECT id FROM users WHERE id=?',person))fail(400,'Persona no válida');where.push('a.user_id=?');args.push(person);}
   if(space){where.push('a.space=?');args.push(choice(space,['work','couple']));}
   if(proj){where.push('a.project_id=?');args.push(project(proj).id);}
   if(before){if(!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before))fail(400,'Cursor no válido');where.push('a.created_at<?');args.push(before);}
   const items=all(`SELECT a.id,a.project_id,a.space,a.user_id,a.action,a.detail,a.created_at,us.name AS author,p.title AS project_title,p.kind AS project_kind,p.destination AS project_destination FROM activities a LEFT JOIN users us ON us.id=a.user_id LEFT JOIN projects p ON p.id=a.project_id WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT 301`,...args);
   respond(res,200,{items:items.slice(0,300),more:items.length>300});return true;}
  if(path==='/api/calendar/items'&&req.method==='GET'){const from=validDate(url.searchParams.get('from')),to=validDate(url.searchParams.get('to'));if(!from||!to||from>to)fail(400,'Rango de fechas no válido');
   respond(res,200,{
    events:all("SELECT e.id,e.title,e.event_date AS date,e.event_time AS time,e.location,e.notes,e.booking_status,p.id AS project_id,p.title AS project_title,p.space,p.color,COALESCE(m.done,0) AS done FROM events e JOIN projects p ON p.id=e.project_id LEFT JOIN calendar_marks m ON m.source='dupla' AND m.ref_id=e.id WHERE p.deleted_at IS NULL AND e.event_date BETWEEN ? AND ? ORDER BY e.event_date,e.event_time LIMIT 1500",from,to),
    tasks:all("SELECT t.id,t.title,t.due_date AS date,t.state,p.id AS project_id,p.title AS project_title,p.space FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.deleted_at IS NULL AND t.due_date BETWEEN ? AND ? ORDER BY t.due_date LIMIT 1500",from,to),
    trips:all("SELECT id,title,destination,start_date,COALESCE(end_date,start_date) AS end_date,space,color FROM projects WHERE deleted_at IS NULL AND start_date IS NOT NULL AND start_date<=? AND COALESCE(end_date,start_date)>=? ORDER BY start_date LIMIT 200",to,from)});return true;}
  if(path==='/api/calendar/marks'&&req.method==='GET'){respond(res,200,{items:all('SELECT m.source,m.ref_id,m.project_id,m.done,p.title AS project_title,p.space FROM calendar_marks m LEFT JOIN projects p ON p.id=m.project_id AND p.deleted_at IS NULL')});return true;}
  if(path==='/api/calendar/marks'&&req.method==='POST'){const b=await readBody(req);const source=choice(b.source,['dupla','google']);const ref=String(b.id||'');
   if(!/^[A-Za-z0-9_-]{1,180}$/.test(ref))fail(400,'Evento no válido');
   const prev=get('SELECT project_id,done FROM calendar_marks WHERE source=? AND ref_id=?',source,ref);let projectId=prev?.project_id||null,p=null;
   if(source==='dupla'){const ev=get('SELECT project_id FROM events WHERE id=?',ref);if(!ev)fail(404,'Evento no encontrado');p=project(ev.project_id);projectId=null;}
   else if('project_id' in b){projectId=b.project_id?project(String(b.project_id)).id:null;p=projectId?project(projectId):null;}
   else if(projectId)p=project(projectId);
   const done='done' in b?(b.done?1:0):(prev?.done||0);
   run('INSERT INTO calendar_marks(source,ref_id,project_id,done,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(source,ref_id) DO UPDATE SET project_id=excluded.project_id,done=excluded.done,updated_by=excluded.updated_by,updated_at=excluded.updated_at',source,ref,projectId,done,u.id,now());
   const label=String(b.title||'evento').slice(0,160)||'evento';
   if(p&&'done' in b)logChange(p,u,done?'completó el evento':'reabrió el evento',label);else if(p&&'project_id' in b)logChange(p,u,'vinculó el evento',label);
   respond(res,200,{ok:true,project_id:projectId,done:Boolean(done)});return true;}
  if(path==='/api/connections'&&req.method==='GET'){respond(res,200,{providers:PROVIDERS,items:all('SELECT c.*,us.name AS author,p.title AS project_title FROM connections c LEFT JOIN users us ON us.id=c.created_by LEFT JOIN projects p ON c.scope_type=\'project\' AND p.id=c.scope_id ORDER BY c.created_at')});return true;}
  if(path==='/api/connections'&&req.method==='POST'){const b=await readBody(req);const provider=choice(b.provider,Object.keys(PROVIDERS));const sc=validScope(b);const permission=choice(b.permission,['read','write'],'read');
   let link='';if(b.url){try{const x=new URL(String(b.url));const hosts=PROVIDERS[provider].hosts;if(x.protocol!=='https:'||x.username||x.password||(hosts&&!hosts.includes(x.hostname)))throw 0;link=x.href.slice(0,500);}catch{fail(400,'Enlace no válido para '+PROVIDERS[provider].name+(PROVIDERS[provider].hosts?` (debe ser https://${PROVIDERS[provider].hosts[0]}/…)`:' (debe empezar por https://)'));}}
   if(!link&&get('SELECT 1 AS x FROM connections WHERE provider=? AND scope_type=? AND scope_id=? AND url=\'\'',provider,sc.type,sc.id))fail(409,'Ya está activado en ese ámbito');
   const id=uid();run('INSERT INTO connections(id,provider,scope_type,scope_id,permission,label,url,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',id,provider,sc.type,sc.id,permission,optional(b.label||'',80).trim(),link,u.id,now());
   if(sc.type==='project'){const p=project(sc.id);logChange(p,u,'activó '+PROVIDERS[provider].name,link||(permission==='write'?'ver y editar':'solo ver'));}
   respond(res,201,{item:get('SELECT * FROM connections WHERE id=?',id)});return true;}
  const cm=path.match(/^\/api\/connections\/([a-f0-9-]{36})$/);
  if(cm){const row=get('SELECT * FROM connections WHERE id=?',cm[1]);if(!row)fail(404,'Conexión no encontrada');
   if(req.method==='PATCH'){const b=await readBody(req);run('UPDATE connections SET permission=? WHERE id=?',choice(b.permission,['read','write']),row.id);respond(res,200,{ok:true});return true;}
   if(req.method==='DELETE'){run('DELETE FROM connections WHERE id=?',row.id);if(row.scope_type==='project'){try{const p=project(row.scope_id);logChange(p,u,'desactivó '+(PROVIDERS[row.provider]?.name||row.provider),row.url||'');}catch{}}respond(res,200,{ok:true});return true;}}
  if(path==='/api/prefs/shared'&&req.method==='PUT'){const b=await readBody(req);for(const [k,v] of Object.entries(b))if(!SHARED_KEYS[k]||!SHARED_KEYS[k](v))fail(400,'Ajuste no válido: '+k);for(const [k,v] of Object.entries(b))setShared(k,v,u.id);d.notify?.('all',null,u.id);respond(res,200,{shared:sharedSettings()});return true;}
  if(path==='/api/sessions'&&req.method==='GET'){respond(res,200,{sessions:all('SELECT token_hash,device,created_at,expires_at FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC',u.id,now()).map(s=>({id:s.token_hash.slice(0,16),device:s.device||'Dispositivo anterior',created_at:s.created_at||null,expires_at:s.expires_at,current:s.token_hash===u.token_hash})),push_devices:get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?',u.id).n});return true;}
  const sm=path.match(/^\/api\/sessions\/([a-f0-9]{16})$/);
  if(sm&&req.method==='DELETE'){if(u.token_hash.startsWith(sm[1]))fail(400,'Para cerrar esta sesión usa «Cerrar sesión»');const n=run('DELETE FROM sessions WHERE user_id=? AND substr(token_hash,1,16)=?',u.id,sm[1]).changes;if(!n)fail(404,'Sesión no encontrada');respond(res,200,{ok:true});return true;}
  if(path==='/api/agent/avatar'){
   if(req.method==='GET'){const name=getShared('dupla_avatar');if(!name||!fileExists(name))fail(404,'Sin avatar');const f=readFile(name);res.writeHead(200,{'Content-Type':imageMime(f),'Cache-Control':'private, max-age=604800','X-Content-Type-Options':'nosniff'});res.end(f);return true;}
   if(req.method==='POST'){const b=await readBody(req);if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64))fail(400,'Contenido base64 inválido');const f=Buffer.from(b.base64,'base64');if(!f.length||f.length>2*1024*1024)fail(413,'El avatar debe ocupar menos de 2 MB');if(!isImage(f))fail(415,'Sube una foto JPG, PNG o WebP');
    const name=uid();saveFile(name,f);const old=getShared('dupla_avatar');setShared('dupla_avatar',name,u.id);if(old){try{removeFile(old);}catch{}}respond(res,200,{shared:sharedSettings()});return true;}
   if(req.method==='DELETE'){const old=getShared('dupla_avatar');if(old){try{removeFile(old);}catch{}}run("DELETE FROM shared_settings WHERE key='dupla_avatar'");respond(res,200,{shared:sharedSettings()});return true;}
  }
  if(path==='/api/prefs'){
   if(req.method==='GET'){respond(res,200,{prefs:Object.fromEntries(all('SELECT key,value FROM user_prefs WHERE user_id=?',u.id).map(r=>[r.key,JSON.parse(r.value)])),shared:sharedSettings()});return true;}
   if(req.method==='PUT'){const b=await readBody(req);for(const [k,v] of Object.entries(b)){if(!PREF_KEYS[k]||!PREF_KEYS[k](v))fail(400,'Preferencia no válida: '+k);}for(const [k,v] of Object.entries(b))run('INSERT INTO user_prefs(user_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',u.id,k,JSON.stringify(v),now());respond(res,200,{ok:true});return true;}
  }
  if(path==='/api/places/photos'&&req.method==='GET'){const q=requireText(url.searchParams.get('q')||'','Lugar',120);respond(res,200,{items:await placePhotos(q)});return true;}
  if(path==='/api/weather'&&req.method==='GET'){const q=requireText(url.searchParams.get('q')||'','Lugar',120);respond(res,200,{weather:await weather(q)});return true;}
  const m=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/(trip|cover)$/);
  if(m){const p=project(m[1]);
   if(m[2]==='trip'&&req.method==='PATCH'){const b=await readBody(req);const kind=b.kind===undefined?p.kind:choice(b.kind,['blank','trip','dinner','shared','weekend','celebration','website','campaign','app','automation','ai_agent','freelance']);const destination=b.destination===undefined?p.destination:optional(b.destination,120).trim();const start=b.start_date===undefined?p.start_date:validDate(b.start_date),end=b.end_date===undefined?p.end_date:validDate(b.end_date);if(start&&end&&end<start)fail(400,'La fecha de fin no puede ser anterior al inicio');
    run('UPDATE projects SET kind=?,destination=?,start_date=?,end_date=?,updated_at=? WHERE id=?',kind,destination,start,end,now(),p.id);logChange(p,u,'actualizó fechas y destino',p.title);
    if(destination!==p.destination&&!p.cover_file)await autoCover(project(p.id));respond(res,200,{project:project(p.id)});return true;}
   if(m[2]==='cover'&&req.method==='GET'){if(!p.cover_file||!fileExists(p.cover_file))fail(404,'Sin portada');const f=readFile(p.cover_file);res.writeHead(200,{'Content-Type':imageMime(f),'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'});res.end(f);return true;}
   if(m[2]==='cover'&&req.method==='POST'){const b=await readBody(req);let file,credit;
    if(b.url){file=await downloadImage(String(b.url));credit=optional(b.credit||'Wikimedia Commons',200);}
    else if(typeof b.base64==='string'){if(!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64))fail(400,'Contenido base64 inválido');file=Buffer.from(b.base64,'base64');if(!file.length||file.length>6*1024*1024)fail(413,'Máximo 6 MB');if(!isImage(file))fail(415,'Sube una foto JPG, PNG o WebP');credit='Foto vuestra';}
    else if(b.auto){const done=await autoCover(p);respond(res,200,{ok:done,project:project(p.id)});return true;}
    else fail(400,'Indica una foto');
    setCover(p,file,credit,u);respond(res,200,{ok:true,project:project(p.id)});return true;}
   if(m[2]==='cover'&&req.method==='DELETE'){if(p.cover_file){try{removeFile(p.cover_file);}catch{}}run("UPDATE projects SET cover_file=NULL,cover_credit='' WHERE id=?",p.id);respond(res,200,{ok:true});return true;}
  }
  if(path==='/api/agent'&&req.method==='GET'){respond(res,200,{available:Boolean(env.AI),model:env.AI_MODEL||AGENT_MODEL,messages:all('SELECT id,role,content,proposals,created_at FROM agent_messages WHERE user_id=? ORDER BY created_at DESC LIMIT 40',u.id).reverse().map(x=>({...x,proposals:JSON.parse(x.proposals)})),memory:all('SELECT m.id,m.fact,m.created_at,u.name AS author FROM agent_memory m LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at DESC')});return true;}
  if(path==='/api/agent'&&req.method==='POST'){const b=await readBody(req);const scope=choice(b.scope,['all','work','couple'],'all');respond(res,200,{message:await runAgent(u,requireText(b.message,'Mensaje',2000),scope)});return true;}
  if(path==='/api/agent/history'&&req.method==='DELETE'){run('DELETE FROM agent_messages WHERE user_id=?',u.id);respond(res,200,{ok:true});return true;}
  const pm=path.match(/^\/api\/agent\/messages\/([a-f0-9-]{36})\/proposals\/(p\d{1,2})$/);
  if(pm&&req.method==='PATCH'){const row=get("SELECT * FROM agent_messages WHERE id=? AND user_id=? AND role='assistant'",pm[1],u.id);if(!row)fail(404,'Mensaje no encontrado');const b=await readBody(req);const list=JSON.parse(row.proposals);const item=list.find(x=>x.id===pm[2]);if(!item)fail(404,'Propuesta no encontrada');item.status=choice(b.status,['done','rejected','failed','undone']);if(b.result_id&&/^[A-Za-z0-9_-]{1,180}$/.test(b.result_id))item.result_id=b.result_id;if(b.error)item.error=String(b.error).slice(0,200);run('UPDATE agent_messages SET proposals=? WHERE id=?',JSON.stringify(list),row.id);respond(res,200,{ok:true});return true;}
  const mm=path.match(/^\/api\/agent\/memory\/([a-f0-9-]{36})$/);
  if(mm&&req.method==='DELETE'){run('DELETE FROM agent_memory WHERE id=?',mm[1]);respond(res,200,{ok:true});return true;}
  if(mm&&req.method==='PATCH'){const b=await readBody(req),fact=requireText(b.fact,'Dato',300);if(!run('UPDATE agent_memory SET fact=? WHERE id=?',fact,mm[1]).changes)fail(404,'Dato no encontrado');respond(res,200,{ok:true});return true;}
  if(path==='/api/agent/memory'&&req.method==='POST'){const b=await readBody(req),fact=requireText(b.fact,'Dato',300);if(all('SELECT id FROM agent_memory').length>=80)fail(409,'La memoria está llena: borra datos antiguos.');const id=uid();run('INSERT INTO agent_memory(id,fact,created_by,created_at) VALUES(?,?,?,?)',id,fact,u.id,now());respond(res,201,{id});return true;}
  // Voz: el navegador graba un audio corto y Whisper lo pasa a texto (R-propuesta 5 aprobada por el usuario).
  if(path==='/api/agent/voice'&&req.method==='POST'){if(!env.AI)fail(503,'La voz necesita la IA del servidor.');const b=await readBody(req);if(typeof b.base64!=='string'||!/^[-A-Za-z0-9+/]*={0,2}$/.test(b.base64)||b.base64.length<200)fail(400,'Audio no válido');if(b.base64.length>4e6)fail(413,'Audio demasiado largo (máx. ~1 minuto)');
   const r=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio:b.base64,language:'es',vad_filter:true});respond(res,200,{text:String(r?.text||'').replace(/\s+/g,' ').trim().slice(0,2000)});return true;}
  // Ticket o factura en foto → datos del gasto (modelo de visión de Workers AI). La foto no se guarda.
  if(path==='/api/receipt/scan'&&req.method==='POST'){if(!env.AI)fail(503,'Leer tickets necesita la IA del servidor.');const b=await readBody(req),img=String(b.image||''),m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(img);if(!m||m[2].length<200)fail(400,'Imagen no válida');if(m[2].length>4e6)fail(413,'Foto demasiado grande');
   let r;try{r=await env.AI.run(VISION_MODEL,{messages:[{role:'system',content:'Lees tickets y facturas en español. Devuelve SOLO JSON: {"merchant":"nombre del comercio o concepto","total":importe total pagado en euros como número,"date":"AAAA-MM-DD o vacío","category":"una de: flights, stay, transport, food, outings, activities, shopping, extras, other"}. food = supermercado/restaurante/bar; stay = hotel/apartamento; transport = taxi/tren/gasolina/parking; outings = ocio/entradas. Si no ves el total, total=0. No inventes.'},{role:'user',content:[{type:'text',text:'Lee este ticket.'},{type:'image_url',image_url:{url:img}}]}],max_tokens:300,temperature:0});}catch(ex){fail(502,'La IA no ha podido leer la foto: '+String(ex.message||ex).slice(0,140));}
   const raw=typeof r?.response==='object'&&r.response?JSON.stringify(r.response):String(r?.response??r?.choices?.[0]?.message?.content??'');let j;try{j=JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}catch{fail(422,'No he podido leer el ticket: prueba con una foto más nítida y de frente.');}
   const amt=Number(String(j.total??'').replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.')),cats=['flights','stay','transport','food','outings','activities','shopping','extras','other'];
   respond(res,200,{title:String(j.merchant||'Ticket').trim().slice(0,160)||'Ticket',actual:Number.isFinite(amt)&&amt>0&&amt<1e6?Math.round(amt*100)/100:0,booked_at:/^\d{4}-\d{2}-\d{2}$/.test(j.date||'')?j.date:'',category:cats.includes(j.category)?j.category:'other'});return true;}
  // Viajes: reserva (PDF o foto) → paradas, gastos y eventos; tiempo de los días del viaje; lista de maleta. Nada de correo.
  const tm=path.match(/^\/api\/projects\/([a-f0-9-]{36})\/(booking-read|forecast|packing)$/);
  if(tm){const p=project(tm[1]);if(p.space!=='couple')fail(403,'Solo para viajes y planes de pareja');const pick=r=>{const raw=typeof r?.response==='object'&&r.response?JSON.stringify(r.response):String(r?.response??r?.choices?.[0]?.message?.content??'');try{return JSON.parse(raw.slice(raw.indexOf('{'),raw.lastIndexOf('}')+1));}catch{return null;}};
   if(tm[2]==='booking-read'&&req.method==='POST'){if(!env.AI)fail(503,'Leer reservas necesita la IA del servidor.');const b=await readBody(req),f=String(b.file||''),m=/^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(f);if(!m||m[2].length<200)fail(400,'Sube un PDF o una foto de la reserva');if(m[2].length>8e6)fail(413,'Archivo demasiado grande (máx. ~6 MB)');
    const sys=`Extraes reservas de viaje (vuelos, trenes, hoteles, apartamentos, coches, entradas). El viaje es a ${p.destination||'un destino'}${p.start_date?` del ${p.start_date} al ${p.end_date||p.start_date}`:''}. Devuelve SOLO JSON: {"items":[{"kind":"flight|stay|transport|activity|other","title":"texto corto, p. ej. Vuelo Madrid → Budapest FR1234 o Hotel Astoria","date":"AAAA-MM-DD","time":"HH:MM o vacío","end_date":"AAAA-MM-DD o vacío","end_time":"HH:MM o vacío","location":"aeropuerto, estación o dirección","amount":importe total en euros como número o 0,"reference":"localizador o nº de reserva"}]}. Un elemento por cada trayecto de vuelo o tren y uno por alojamiento (date = entrada, end_date = salida). No inventes datos que no aparezcan.`;
    let r;try{if(m[1]==='application/pdf'){if(typeof env.AI.toMarkdown!=='function')fail(503,'Leer PDF no está disponible en este servidor');const bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0)),md=await env.AI.toMarkdown([{name:String(b.name||'reserva.pdf').slice(0,120),blob:new Blob([bytes],{type:'application/pdf'})}]),text=String((Array.isArray(md)?md[0]:md)?.data||'').slice(0,14000);if(text.trim().length<20)fail(422,'El PDF no tiene texto legible: prueba con una captura de pantalla.');
      r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages:[{role:'system',content:sys},{role:'user',content:text}],max_tokens:2500,temperature:0});}
     else r=await env.AI.run(VISION_MODEL,{messages:[{role:'system',content:sys},{role:'user',content:[{type:'text',text:'Lee esta reserva.'},{type:'image_url',image_url:{url:f}}]}],max_tokens:1200,temperature:0});}catch(ex){if(ex?.status)throw ex;fail(502,'La IA no ha podido leer la reserva: '+String(ex.message||ex).slice(0,140));}
    const j=pick(r),d=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:'',h=v=>/^\d{2}:\d{2}$/.test(v||'')?v:'',t=(v,n)=>String(v||'').trim().slice(0,n),kinds=['flight','stay','transport','activity','other'];
    const items=(Array.isArray(j?.items)?j.items:[]).slice(0,12).map(x=>({kind:kinds.includes(x.kind)?x.kind:'other',title:t(x.title,160),date:d(x.date),time:h(x.time),end_date:d(x.end_date),end_time:h(x.end_time),location:t(x.location,220),amount:Number.isFinite(+x.amount)&&+x.amount>0&&+x.amount<1e6?Math.round(+x.amount*100)/100:0,reference:t(x.reference,120)})).filter(x=>x.title&&x.date);
    if(!items.length)fail(422,'No he encontrado ninguna reserva con fecha en ese archivo.');respond(res,200,{items});return true;}
   if(tm[2]==='forecast'&&req.method==='GET'){const st=p.start_date,en=p.end_date||st,td=new Date().toISOString().slice(0,10),lim=new Date(Date.now()+15*864e5).toISOString().slice(0,10);if(!p.destination||!st)return respond(res,200,{days:[],reason:'Pon destino y fechas al viaje para ver el tiempo.'}),true;if(en<td)return respond(res,200,{days:[],reason:'Este viaje ya ha pasado.'}),true;if(st>lim)return respond(res,200,{days:[],reason:`La previsión del tiempo sale unos 15 días antes: a partir del ${new Date(new Date(st).getTime()-15*864e5).toLocaleDateString('es-ES',{day:'numeric',month:'long'})}.`}),true;
    const w=await weather(p.destination).catch(()=>null),geo=cached('geo',norm(p.destination),30*864e5);if(!w?.found||!geo)return respond(res,200,{days:[],reason:'No encuentro ese destino en el servicio del tiempo.'}),true;
    const days=await cacheFetch('tripwx',`${geo.lat},${geo.lon},${st},${en}`,3*3600e3,async()=>{const r=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${st<td?td:st}&end_date=${en>lim?lim:en}`,{headers:UA,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('tiempo');const dj=(await r.json()).daily||{};return (dj.time||[]).map((x,i)=>({date:x,max:Math.round(dj.temperature_2m_max[i]),min:Math.round(dj.temperature_2m_min[i]),rain:dj.precipitation_probability_max?.[i]??null,code:dj.weather_code[i],text:WEATHER[dj.weather_code[i]]||''}));}).catch(()=>[]);
    respond(res,200,{days,place:w.place,reason:days.length?'':'Servicio del tiempo no disponible ahora.'});return true;}
   if(tm[2]==='packing'&&req.method==='POST'){if(!env.AI)fail(503,'La lista de maleta necesita la IA del servidor.');const stops=all('SELECT title FROM trip_stops WHERE project_id=? LIMIT 30',p.id).map(x=>x.title),evs=all('SELECT title FROM events WHERE project_id=? LIMIT 30',p.id).map(x=>x.title),b=await readBody(req),wx=Array.isArray(b.weather)?b.weather.slice(0,16).map(x=>`${x.date}: ${x.min}-${x.max}ºC ${x.text||''}`).join('; '):'';
    let r;try{r=await env.AI.run(env.AI_MODEL||AGENT_MODEL,{messages:[{role:'system',content:'Preparas la lista de la maleta para una pareja (Álvaro y Angie). Devuelve SOLO JSON: {"items":["…"]} con 15-30 cosas concretas y cortas (máx. 60 caracteres), adaptadas al destino, la época, el tiempo, la duración y los planes. Incluye documentación y cargadores. Español.'},{role:'user',content:`Destino: ${p.destination||p.title}. Fechas: ${p.start_date||'?'} a ${p.end_date||p.start_date||'?'}. ${wx?'Tiempo previsto: '+wx+'. ':''}Planes: ${[...stops,...evs].join(', ').slice(0,1500)||'sin planes aún'}.`}],max_tokens:1500,temperature:0.3});}catch(ex){fail(502,'La IA no ha respondido: '+String(ex.message||ex).slice(0,140));}
    const list=[...new Set((pick(r)?.items||[]).map(x=>String(x||'').trim().slice(0,120)).filter(Boolean))].slice(0,40);if(!list.length)fail(502,'La IA no ha devuelto la lista: inténtalo de nuevo.');
    const old=get("SELECT id FROM tasks WHERE project_id=? AND title='Hacer la maleta'",p.id),tid=old?.id||uid(),t0=now();if(!old)run("INSERT INTO tasks(id,project_id,title,description,state,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",tid,p.id,'Hacer la maleta','Lista preparada por Dupla según destino, tiempo y planes.','todo','normal',u.id,t0,t0);
    const have=new Set(all('SELECT title FROM checklist_items WHERE task_id=?',tid).map(x=>x.title.toLowerCase()));let n=0;for(const x of list)if(!have.has(x.toLowerCase())){run('INSERT INTO checklist_items VALUES(?,?,?,?,?,?)',uid(),tid,x,0,u.id,t0);n++;}
    logChange(p,u,'preparó la lista de la maleta',`${n} cosas`);respond(res,200,{task_id:tid,added:n,items:list});return true;}
   fail(405,'Método no permitido');}
  // Claves de atajos del iPhone: se muestran una sola vez; en la base solo queda su huella (SHA-256).
  if(path==='/api/shortcut-tokens'&&req.method==='GET'){respond(res,200,{items:all('SELECT id,label,created_at,last_used_at FROM api_tokens WHERE user_id=? ORDER BY created_at DESC',u.id)});return true;}
  if(path==='/api/shortcut-tokens'&&req.method==='POST'){const b=await readBody(req),label=optional(b.label,60)||'Mi iPhone';if(all('SELECT id FROM api_tokens WHERE user_id=?',u.id).length>=5)fail(409,'Máximo 5 claves: borra alguna antigua.');
   const raw=crypto.getRandomValues(new Uint8Array(24)),token='dpl_'+[...raw].map(x=>x.toString(16).padStart(2,'0')).join(''),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join(''),id=uid();
   run('INSERT INTO api_tokens(id,user_id,token_hash,label,created_at) VALUES(?,?,?,?,?)',id,u.id,hash,label,now());logFree(u,'couple','creó una clave de atajo del iPhone',label);respond(res,201,{id,token,label});return true;}
  const stm=path.match(/^\/api\/shortcut-tokens\/([a-f0-9-]{36})$/);if(stm&&req.method==='DELETE'){if(!run('DELETE FROM api_tokens WHERE id=? AND user_id=?',stm[1],u.id).changes)fail(404,'Clave no encontrada');respond(res,200,{ok:true});return true;}
  // Saldo de pareja: lo que ha pagado cada uno en los planes de pareja y quién debe a quién (a medias).
  if(path==='/api/balance'&&req.method==='GET'){const users=all('SELECT id,name FROM users ORDER BY name'),rows=all("SELECT e.paid_by,e.actual,p.id AS pid,p.title FROM expenses e JOIN projects p ON p.id=e.project_id WHERE p.deleted_at IS NULL AND p.space='couple' AND e.paid_by IS NOT NULL AND e.actual>0");
   const calc=list=>{const paid=Object.fromEntries(users.map(x=>[x.id,0]));for(const x of list)if(x.paid_by in paid)paid[x.paid_by]+=x.actual;const tot=Object.values(paid).reduce((a,b)=>a+b,0),half=tot/users.length,[a,b]=users,d=Math.round(((paid[a?.id]||0)-half)*100)/100;
    return {total:Math.round(tot*100)/100,paid:users.map(x=>({id:x.id,name:x.name,amount:Math.round(paid[x.id]*100)/100})),owes:users.length===2&&Math.abs(d)>=0.01?{from:d>0?b.id:a.id,to:d>0?a.id:b.id,amount:Math.abs(d)}:null};};
   const per=[...new Set(rows.map(x=>x.pid))].map(pid=>({id:pid,title:rows.find(x=>x.pid===pid).title,...calc(rows.filter(x=>x.pid===pid))}));
   respond(res,200,{...calc(rows),projects:per});return true;}
  return false;
 }
 return {route,placePhotos,weather,autoCover,runAgent,TOOLS,requireConnection,connectionScope,directorSuggestions,budgetForecast};
}
