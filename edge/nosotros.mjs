// Nosotros: pregunta del día, cómo estamos, notas del uno al otro, hábitos juntos y lenguaje del amor.
export const PREGUNTAS=['¿Qué es lo que más te ha hecho reír esta semana?','¿Qué recuerdo nuestro repetirías mañana mismo?','¿Qué pequeño gesto mío te hace sentir querida o querido?','¿A qué lugar te gustaría que fuéramos este año?','¿Qué te gustaría que hiciéramos más a menudo?','¿Qué canción te recuerda a nosotros?','¿Cuál fue tu primera impresión de mí?','¿Qué sueño tienes que aún no me has contado?','¿Qué te preocupa estos días y cómo puedo ayudarte?','¿Qué plan perfecto harías un domingo conmigo?','¿Qué es lo que más admiras de mí?','¿Qué costumbre nuestra no cambiarías nunca?','¿Qué comida te recuerda a casa?','¿Qué aprendiste de tu familia que quieres para la nuestra?','¿Qué te hace sentir en calma?','¿Cuál ha sido nuestro mejor viaje y por qué?','¿Qué te gustaría aprender juntos?','¿Qué detalle de hoy quieres agradecerme?','¿Cómo imaginas nuestra vida dentro de cinco años?','¿Qué película veríamos esta noche si eliges tú?','¿Qué te hizo sentir orgullosa u orgulloso de ti esta semana?','¿Qué necesitas más de mí ahora mismo?','¿Qué es para ti una cita perfecta?','¿Qué miedo has superado gracias a nosotros?','¿Qué tradición nos inventamos este año?','¿Qué palabra nos describe como pareja?','¿Qué te gustaría que celebráramos más?','¿Cuál es tu recuerdo favorito de la infancia?','¿Qué cosa de casa te gustaría mejorar juntos?','¿Qué te ilusiona del próximo mes?','¿Qué es lo más bonito que te he dicho?','¿Qué harías si tuviéramos un día entero sin obligaciones?','¿Qué te gustaría que te preguntara más a menudo?','¿Qué momento difícil superamos bien juntos?','¿Qué regalo te haría ilusión aunque fuera pequeño?','¿Qué te gusta de cómo resolvemos las discusiones y qué cambiarías?','¿Qué amistad te gustaría que cuidáramos más?','¿Qué olor te recuerda a mí?','¿Qué meta personal quieres que apoye este año?','¿Qué te hace sentir que somos un equipo?','¿Dónde te gustaría vivir algún día?','¿Qué libro, serie o podcast me recomendarías ahora?','¿Qué es lo primero que piensas al despertar un día bueno?','¿Qué significa para ti cuidarnos?','¿Qué haríamos para celebrar nuestro próximo aniversario?','¿Qué cosa nueva has descubierto de mí últimamente?','¿Qué te gustaría que hiciera cuando estás triste?','¿Qué plan barato y bonito podemos hacer esta semana?','¿Qué te gustaría contarle a la persona que eras hace diez años?','¿Qué es lo que más valoras de nuestro día a día?'];
export const LENGUAJES=['palabras','tiempo','regalos','actos','contacto'];
const DIA=86400000;
export const hoyMadrid=(t=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
export const preguntaDe=day=>PREGUNTAS[Math.floor(Date.parse(day+'T12:00:00Z')/DIA)%PREGUNTAS.length];
const antes=day=>new Date(Date.parse(day+'T12:00:00Z')-DIA).toISOString().slice(0,10);

export function createNosotros(d){
 const {all,get,run,now,uid,respond,fail,readBody,logFree}=d;
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
  if(path==='/api/us/love'&&req.method==='PUT'){const b=await readBody(req),result=String(b.result||'');if(!LENGUAJES.includes(result))fail(400,'Resultado no válido.');
   const scores=Object.fromEntries(LENGUAJES.map(k=>[k,Math.max(0,Math.min(20,Math.round(Number(b.scores?.[k])||0)))]));
   run('INSERT INTO us_profiles(user_id,love_language,scores,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET love_language=excluded.love_language,scores=excluded.scores,updated_at=excluded.updated_at',u.id,result,JSON.stringify(scores),now());
   logFree(u,'couple','hizo el test del lenguaje del amor','');respond(res,200,estado(u));return true;}
  fail(404,'Ruta no encontrada');
 }
 return {route};
}
