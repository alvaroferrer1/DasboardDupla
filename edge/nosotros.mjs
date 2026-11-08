// Nosotros: pregunta del día, cómo estamos, notas del uno al otro, hábitos juntos y lenguaje del amor.
export const PREGUNTAS=['¿Qué es lo que más te ha hecho reír esta semana?','¿Qué recuerdo nuestro repetirías mañana mismo?','¿Qué pequeño gesto mío te hace sentir querida o querido?','¿A qué lugar te gustaría que fuéramos este año?','¿Qué te gustaría que hiciéramos más a menudo?','¿Qué canción te recuerda a nosotros?','¿Cuál fue tu primera impresión de mí?','¿Qué sueño tienes que aún no me has contado?','¿Qué te preocupa estos días y cómo puedo ayudarte?','¿Qué plan perfecto harías un domingo conmigo?','¿Qué es lo que más admiras de mí?','¿Qué costumbre nuestra no cambiarías nunca?','¿Qué comida te recuerda a casa?','¿Qué aprendiste de tu familia que quieres para la nuestra?','¿Qué te hace sentir en calma?','¿Cuál ha sido nuestro mejor viaje y por qué?','¿Qué te gustaría aprender juntos?','¿Qué detalle de hoy quieres agradecerme?','¿Cómo imaginas nuestra vida dentro de cinco años?','¿Qué película veríamos esta noche si eliges tú?','¿Qué te hizo sentir orgullosa u orgulloso de ti esta semana?','¿Qué necesitas más de mí ahora mismo?','¿Qué es para ti una cita perfecta?','¿Qué miedo has superado gracias a nosotros?','¿Qué tradición nos inventamos este año?','¿Qué palabra nos describe como pareja?','¿Qué te gustaría que celebráramos más?','¿Cuál es tu recuerdo favorito de la infancia?','¿Qué cosa de casa te gustaría mejorar juntos?','¿Qué te ilusiona del próximo mes?','¿Qué es lo más bonito que te he dicho?','¿Qué harías si tuviéramos un día entero sin obligaciones?','¿Qué te gustaría que te preguntara más a menudo?','¿Qué momento difícil superamos bien juntos?','¿Qué regalo te haría ilusión aunque fuera pequeño?','¿Qué te gusta de cómo resolvemos las discusiones y qué cambiarías?','¿Qué amistad te gustaría que cuidáramos más?','¿Qué olor te recuerda a mí?','¿Qué meta personal quieres que apoye este año?','¿Qué te hace sentir que somos un equipo?','¿Dónde te gustaría vivir algún día?','¿Qué libro, serie o podcast me recomendarías ahora?','¿Qué es lo primero que piensas al despertar un día bueno?','¿Qué significa para ti cuidarnos?','¿Qué haríamos para celebrar nuestro próximo aniversario?','¿Qué cosa nueva has descubierto de mí últimamente?','¿Qué te gustaría que hiciera cuando estás triste?','¿Qué plan barato y bonito podemos hacer esta semana?','¿Qué te gustaría contarle a la persona que eras hace diez años?','¿Qué es lo que más valoras de nuestro día a día?'];
export const LENGUAJES=['palabras','tiempo','regalos','actos','contacto'];
export const CUADERNO=[['Regalos y detalles','Regalo o idea','Ocasión o detalle'],['Así me siento querido','Gesto o manera de recibir amor','Qué significa para mí'],['Cosas que no me gustan','Situación o comportamiento','Cómo me hace sentir / qué necesito'],['Por qué me haces feliz','Me haces feliz porque...','Un recuerdo o ejemplo'],['Por qué creo en nosotros','Razón o motivo','Un ejemplo o recuerdo'],['Nuestros sueños juntos','Nuestro sueño o plan','Cómo me gustaría vivirlo'],['Mis ilusiones personales','Mi ilusión o meta','Qué significa para mí'],['Mis comidas favoritas','Comida o plato','Preferencias o recuerdo'],['Mis mejores marcas','Marca o gusto','Detalle'],['Mis pequeñas manías','Mi manía o costumbre','Cuándo aparece'],['Cosas que quiero hacer por ti','Lo que me gustaría hacerte','Cuándo o cómo']];
const DIA=86400000;
export const hoyMadrid=(t=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export const preguntaDe=day=>PREGUNTAS[Math.floor(Date.parse(day+'T12:00:00Z')/DIA)%PREGUNTAS.length];
const antes=day=>new Date(Date.parse(day+'T12:00:00Z')-DIA).toISOString().slice(0,10);

export function createNosotros(d){
 const {env,all,get,run,now,uid,respond,fail,readBody,logFree}=d;
 const texto=(v,max,campo)=>{const s=String(v??'').trim();if(!s)fail(400,`Escribe ${campo}.`);if(s.length>max)fail(400,`Máximo ${max} caracteres.`);return s;};
 const pareja=u=>get('SELECT id,name FROM users WHERE id<>? ORDER BY created_at LIMIT 1',u.id);
 // Racha: días seguidos (hasta hoy o ayer) en que los dos marcaron el hábito.
 function racha(id,day){const dias=new Set(all('SELECT day FROM us_habit_logs WHERE habit_id=? GROUP BY day HAVING COUNT(DISTINCT user_id)>=2 ORDER BY day DESC LIMIT 400',id).map(r=>r.day));let k=dias.has(day)?day:antes(day),n=0;while(dias.has(k)){n++;k=antes(k);}return n;}
 function estado(u){
  const day=hoyMadrid(),answers=all('SELECT a.user_id,a.answer,a.created_at,us.name FROM us_answers a JOIN users us ON us.id=a.user_id WHERE a.day=?',day),mine=answers.some(a=>a.user_id===u.id);
  const pasadas=all('SELECT a.day,a.user_id,a.answer,us.name FROM us_answers a JOIN users us ON us.id=a.user_id WHERE a.day<? ORDER BY a.day DESC LIMIT 40',day),porDia={};
  for(const a of pasadas)(porDia[a.day]||=[]).push(a);
  return {day,me:u.id,partner:pareja(u),question:preguntaDe(day),
   // La respuesta del otro solo se ve cuando has respondido tú.
   answers:answers.map(a=>a.user_id===u.id||mine?a:{user_id:a.user_id,name:a.name,hidden:true}),
   past:Object.entries(porDia).filter(([,l])=>l.length>1).slice(0,10).map(([k,l])=>({day:k,question:preguntaDe(k),answers:l})),
   checkins:all('SELECT c.user_id,c.mood,c.note,c.created_at,us.name FROM us_checkins c JOIN users us ON us.id=c.user_id WHERE c.day=?',day),
   moods:all('SELECT day,user_id,mood FROM us_checkins WHERE day>? ORDER BY day',new Date(Date.parse(day+'T12:00:00Z')-13*DIA).toISOString().slice(0,10)),
   notes:all('SELECT n.id,n.from_id,n.to_id,n.text,n.created_at,n.read_at,f.name AS from_name FROM us_notes n JOIN users f ON f.id=n.from_id WHERE n.from_id=? OR n.to_id=? ORDER BY n.created_at DESC LIMIT 30',u.id,u.id),
   habits:all('SELECT id,title,created_at FROM us_habits WHERE archived=0 ORDER BY created_at').map(h=>({...h,today:all('SELECT user_id FROM us_habit_logs WHERE habit_id=? AND day=?',h.id,day).map(r=>r.user_id),streak:racha(h.id,day)})),
   profiles:all('SELECT p.user_id,p.love_language,p.scores,p.updated_at,us.name FROM us_profiles p JOIN users us ON us.id=p.user_id').map(p=>({...p,scores:JSON.parse(p.scores||'{}')}))};
 }
 async function route(req,res,url,u){
  const path=url.pathname;if(!path.startsWith('/api/us'))return false;
  if(path==='/api/us'&&req.method==='GET'){respond(res,200,estado(u));return true;}
  if(path==='/api/us/answer'&&req.method==='POST'){const b=await readBody(req),answer=texto(b.answer,1000,'tu respuesta'),day=hoyMadrid(),t=now();
   run('INSERT INTO us_answers(id,day,user_id,answer,created_at) VALUES(?,?,?,?,?) ON CONFLICT(day,user_id) DO UPDATE SET answer=excluded.answer,created_at=excluded.created_at',uid(),day,u.id,answer,t);
   logFree(u,'couple','respondió la pregunta del día',preguntaDe(day));respond(res,200,estado(u));return true;}
  if(path==='/api/us/checkin'&&req.method==='POST'){const b=await readBody(req),mood=Number(b.mood);if(!Number.isInteger(mood)||mood<1||mood>5)fail(400,'Elige cómo estás.');
   const note=String(b.note??'').trim().slice(0,200),day=hoyMadrid(),antes_=get('SELECT 1 FROM us_checkins WHERE day=? AND user_id=?',day,u.id);
   run('INSERT INTO us_checkins(id,day,user_id,mood,note,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(day,user_id) DO UPDATE SET mood=excluded.mood,note=excluded.note,created_at=excluded.created_at',uid(),day,u.id,mood,note,now());
   if(!antes_)logFree(u,'couple','compartió cómo está hoy','');respond(res,200,estado(u));return true;}
  if(path==='/api/us/notes'&&req.method==='POST'){const b=await readBody(req),text=texto(b.text,500,'la nota'),p=pareja(u)||fail(409,'Falta la otra cuenta.');
   run('INSERT INTO us_notes(id,from_id,to_id,text,created_at,read_at) VALUES(?,?,?,?,?,NULL)',uid(),u.id,p.id,text,now());logFree(u,'couple','te ha dejado una nota','');respond(res,201,estado(u));return true;}
  const nota=path.match(/^\/api\/us\/notes\/([a-f0-9-]{36})(\/read)?$/);
  if(nota){const n=get('SELECT * FROM us_notes WHERE id=?',nota[1])||fail(404,'Nota no encontrada');
   if(nota[2]&&req.method==='POST'){if(n.to_id!==u.id)fail(403,'Solo quien la recibe la marca como leída.');run('UPDATE us_notes SET read_at=COALESCE(read_at,?) WHERE id=?',now(),n.id);respond(res,200,estado(u));return true;}
   if(!nota[2]&&req.method==='DELETE'){if(n.from_id!==u.id)fail(403,'Solo quien la escribió puede borrarla.');run('DELETE FROM us_notes WHERE id=?',n.id);respond(res,200,estado(u));return true;}}
  if(path==='/api/us/habits'&&req.method==='POST'){const b=await readBody(req),title=texto(b.title,80,'el hábito');
   if((get('SELECT COUNT(*) AS n FROM us_habits WHERE archived=0').n)>=20)fail(409,'Como mucho 20 hábitos a la vez.');
   run('INSERT INTO us_habits(id,title,created_by,created_at,archived) VALUES(?,?,?,?,0)',uid(),title,u.id,now());logFree(u,'couple','propuso un hábito juntos',title);respond(res,201,estado(u));return true;}
  const hab=path.match(/^\/api\/us\/habits\/([a-f0-9-]{36})(\/toggle)?$/);
  if(hab){const h=get('SELECT * FROM us_habits WHERE id=? AND archived=0',hab[1])||fail(404,'Hábito no encontrado');
   if(hab[2]&&req.method==='POST'){const day=hoyMadrid(),hecho=get('SELECT id FROM us_habit_logs WHERE habit_id=? AND user_id=? AND day=?',h.id,u.id,day);
    if(hecho)run('DELETE FROM us_habit_logs WHERE id=?',hecho.id);else run('INSERT INTO us_habit_logs(id,habit_id,user_id,day,created_at) VALUES(?,?,?,?,?)',uid(),h.id,u.id,day,now());respond(res,200,estado(u));return true;}
   // Se archiva, no se borra: el historial de rachas se conserva.
   if(!hab[2]&&req.method==='DELETE'){run('UPDATE us_habits SET archived=1 WHERE id=?',h.id);respond(res,200,estado(u));return true;}}
  // Ideas: votos y «para cuándo». La idea en sí sigue en /api/ideas.
  if(path==='/api/us/ideas'&&req.method==='GET'){const votes={},when={};for(const v of all('SELECT idea_id,user_id FROM idea_votes'))(votes[v.idea_id]||=[]).push(v.user_id);for(const w of all('SELECT idea_id,hint FROM idea_when'))when[w.idea_id]=w.hint;respond(res,200,{votes,when});return true;}
  const iv=path.match(/^\/api\/us\/ideas\/([a-f0-9-]{36})\/(vote|when)$/);
  if(iv&&req.method==='POST'){const idea=get('SELECT id,title FROM ideas WHERE id=?',iv[1])||fail(404,'Idea no encontrada');
   if(iv[2]==='vote'){const ya=get('SELECT 1 FROM idea_votes WHERE idea_id=? AND user_id=?',idea.id,u.id);if(ya)run('DELETE FROM idea_votes WHERE idea_id=? AND user_id=?',idea.id,u.id);else{run('INSERT INTO idea_votes(idea_id,user_id,created_at) VALUES(?,?,?)',idea.id,u.id,now());logFree(u,'couple','le gusta la idea',idea.title);}}
   else{const b=await readBody(req),hint=String(b.hint||'');if(!hint)run('DELETE FROM idea_when WHERE idea_id=?',idea.id);else{if(!['pronto','este_mes','este_ano','algun_dia'].includes(hint))fail(400,'Elige para cuándo.');run('INSERT INTO idea_when(idea_id,hint,updated_at) VALUES(?,?,?) ON CONFLICT(idea_id) DO UPDATE SET hint=excluded.hint,updated_at=excluded.updated_at',idea.id,hint,now());}}
   const votes={},when={};for(const v of all('SELECT idea_id,user_id FROM idea_votes'))(votes[v.idea_id]||=[]).push(v.user_id);for(const w of all('SELECT idea_id,hint FROM idea_when'))when[w.idea_id]=w.hint;respond(res,200,{votes,when});return true;}
  // Cuaderno: cada uno escribe en su columna; el otro la lee.
  const libro=()=>({lists:CUADERNO.map(([title,col,col2],i)=>({no:i+1,title,col,col2})),entries:all('SELECT b.list_no,b.user_id,b.pos,b.text,b.detail,b.updated_at,us.name FROM us_book b JOIN users us ON us.id=b.user_id ORDER BY b.list_no,b.pos'),imported:!!get("SELECT 1 FROM shared_settings WHERE key='book_imported'")});
  if(path==='/api/us/book'&&req.method==='GET'){respond(res,200,libro());return true;}
  if(path==='/api/us/book'&&req.method==='PUT'){const b=await readBody(req),no=Number(b.list_no),pos=Number(b.pos);if(!(no>=1&&no<=11&&pos>=1&&pos<=20&&Number.isInteger(no)&&Number.isInteger(pos)))fail(400,'Lista o número no válido.');
   const text=String(b.text??'').trim().slice(0,1500),detail=String(b.detail??'').trim().slice(0,600);
   if(!text)run('DELETE FROM us_book WHERE list_no=? AND user_id=? AND pos=?',no,u.id,pos);else run('INSERT INTO us_book(list_no,user_id,pos,text,detail,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(list_no,user_id,pos) DO UPDATE SET text=excluded.text,detail=excluded.detail,updated_at=excluded.updated_at',no,u.id,pos,text,detail,now());
   respond(res,200,libro());return true;}
  if(path==='/api/us/book/import'&&req.method==='POST'){const r=env?.ASSETS?await env.ASSETS.fetch(new Request('https://assets.local/private/cuaderno.json')).catch(()=>null):null;if(!r||!r.ok)fail(404,'No encuentro los cuadernos.');
   const data=await r.json(),users=all('SELECT id,name FROM users'),norm=x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),t=now(),corto=x=>x.length>90?x.slice(0,87).trim()+'…':x;let n=0,g=0,m=0;
   for(const [k,lists] of Object.entries(data.personas||{})){const us=users.find(x=>norm(x.name).startsWith(k));if(!us)continue;const first=us.name.split(' ')[0];
    lists.slice(0,11).forEach((items,li)=>items.slice(0,20).forEach((it,pi)=>{if(!it?.text||get('SELECT 1 FROM us_book WHERE list_no=? AND user_id=? AND pos=?',li+1,us.id,pi+1))return;run('INSERT INTO us_book(list_no,user_id,pos,text,detail,updated_at) VALUES(?,?,?,?,?,?)',li+1,us.id,pi+1,String(it.text).slice(0,1500),String(it.detail||'').slice(0,600),t);n++;}));
    // Lo que a cada uno le haría ilusión recibir va a «Regalos», a su nombre; los sueños compartidos, a «Metas».
    for(const it of lists[0]||[]){const title=corto(it.text);if(get("SELECT 1 FROM couple_items WHERE kind='gift' AND title=? AND person=?",title,first))continue;run("INSERT INTO couple_items(id,kind,title,body,person,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",uid(),'gift',title,(it.text.length>90?it.text+'\n\n':'')+'Del cuaderno de '+first,first,us.id,t,t);g++;}
    for(const it of lists[5]||[]){const title=corto(it.text);if(get("SELECT 1 FROM couple_items WHERE kind='goal' AND title=?",title))continue;run("INSERT INTO couple_items(id,kind,title,body,person,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",uid(),'goal',title,(it.text.length>90?it.text+'\n\n':'')+'Sueño del cuaderno de '+first,'',us.id,t,t);m++;}}
   run("INSERT INTO shared_settings(key,value,updated_by,updated_at) VALUES('book_imported','true',?,?) ON CONFLICT(key) DO UPDATE SET updated_at=excluded.updated_at",u.id,t);
   logFree(u,'couple','añadió vuestros cuadernos a DUPLA',`${n} respuestas, ${g} regalos y ${m} metas`);respond(res,200,{...libro(),added:{entries:n,gifts:g,goals:m}});return true;}
  // Biblioteca: todos los archivos de los proyectos en un sitio (solo lectura; se descargan por su ruta de siempre).
  if(path==='/api/us/files/ask'&&req.method==='POST'){const b=await readBody(req),q=texto(b.question,400,'tu pregunta'),words=q.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').split(/[^a-z0-9ñ]+/).filter(w=>w.length>2),norm=t=>String(t||'').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,''),score=t=>{const n=norm(t);return words.reduce((a,w)=>a+(n.includes(w)?1:0),0);};
   const files=all("SELECT a.id,a.name,a.mime,a.created_at,a.project_id,p.title AS project FROM assets a JOIN projects p ON p.id=a.project_id WHERE p.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 400").map(f=>({...f,s:score(f.name+' '+f.project)})),know=all('SELECT id,title,question,answer,space FROM knowledge ORDER BY rowid DESC LIMIT 200').map(k=>({...k,s:score(k.title+' '+(k.question||'')+' '+(k.answer||''))}));
   const fm=files.filter(f=>f.s).sort((a,b)=>b.s-a.s).slice(0,8),km=know.filter(k=>k.s).sort((a,b)=>b.s-a.s).slice(0,6),matches=[...km.map(k=>({type:'know',id:k.id,name:k.title})),...fm.map(f=>({type:'file',id:f.id,name:f.name,project:f.project,project_id:f.project_id,mime:f.mime}))];
   const ctx=[...km.map(k=>`Conocimiento «${k.title}»: ${String(k.answer||k.question||'').slice(0,600)}`),...fm.map(f=>`Archivo «${f.name}» del proyecto «${f.project}», subido el ${String(f.created_at).slice(0,10)}`)].join('\n');
   if(!matches.length){respond(res,200,{answer:'No he encontrado nada en vuestra biblioteca que tenga que ver con eso. Prueba con otras palabras (el nombre del archivo, del viaje o del proyecto).',matches,generated:false});return true;}
   if(!env?.AI){respond(res,200,{answer:'He encontrado esto en vuestra biblioteca:',matches,generated:false});return true;}
   try{const r=await env.AI.run(env.AI_MODEL||'@cf/openai/gpt-oss-120b',{messages:[{role:'system',content:'Eres Dupla, la asistente de Álvaro y Angie. Responde SOLO en español de España, en 2 a 4 frases, usando únicamente lo que aparece en su biblioteca (conocimientos y nombres de archivos). Si la respuesta está dentro de un archivo que no puedes leer, di en qué archivo mirar. No inventes. Sin markdown.'},{role:'user',content:`Biblioteca:\n${ctx}\n\nPregunta: ${q}`}],max_tokens:500,temperature:.2});
    let a=String(r.choices?.[0]?.message?.content||r.response||'').trim();if(/<\|message\|>/.test(a))a=a.split('<|message|>').pop();a=a.replace(/<\|[^|]{1,40}\|>/g,'').trim().slice(0,1200);respond(res,200,{answer:a||'He encontrado esto en vuestra biblioteca:',matches,generated:!!a});}catch{respond(res,200,{answer:'He encontrado esto en vuestra biblioteca:',matches,generated:false});}return true;}
  if(path==='/api/us/files'&&req.method==='GET'){const notes=all("SELECT n.id,n.file_name AS name,n.file_mime AS mime,n.file_size AS size,n.created_at,t.project_id,COALESCE(p.title,'Tablero · '||b.title,'Tareas') AS project,COALESCE(p.space,'couple') AS space,us.name AS author,'note' AS kind,CASE WHEN n.board_id IS NOT NULL THEN 1 ELSE 0 END AS board FROM task_notes n LEFT JOIN tasks t ON t.id=n.task_id LEFT JOIN projects p ON p.id=t.project_id LEFT JOIN board_tasks b ON b.id=n.board_id LEFT JOIN users us ON us.id=n.user_id WHERE n.stored_name IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL) ORDER BY n.created_at DESC LIMIT 200");
   respond(res,200,{files:[...all("SELECT a.id,a.name,a.mime,a.size,a.created_at,a.project_id,p.title AS project,p.space,us.name AS author,'asset' AS kind FROM assets a JOIN projects p ON p.id=a.project_id LEFT JOIN users us ON us.id=a.created_by WHERE p.deleted_at IS NULL ORDER BY a.created_at DESC LIMIT 400"),...notes].sort((x,y)=>String(y.created_at).localeCompare(String(x.created_at)))});return true;}
  if(path==='/api/us/love'&&req.method==='PUT'){const b=await readBody(req),result=String(b.result||'');if(!LENGUAJES.includes(result))fail(400,'Resultado no válido.');
   const scores=Object.fromEntries(LENGUAJES.map(k=>[k,Math.max(0,Math.min(20,Math.round(Number(b.scores?.[k])||0)))]));
   run('INSERT INTO us_profiles(user_id,love_language,scores,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET love_language=excluded.love_language,scores=excluded.scores,updated_at=excluded.updated_at',u.id,result,JSON.stringify(scores),now());
   logFree(u,'couple','hizo el test del lenguaje del amor','');respond(res,200,estado(u));return true;}
  fail(404,'Ruta no encontrada');
 }
 return {route};
}
