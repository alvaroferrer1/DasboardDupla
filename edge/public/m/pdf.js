// DUPLA · generador de PDF (itinerario, dossier, presupuesto). Se descarga solo cuando alguien pide un PDF.
export function pdfModule({S,tripInfo,short,api,STATUS,tripCalendar,cap,BOOK,fmt,eur,pdfTxt,loadJsPdf}){
async function imgData(url){try{const r=await fetch(url,{credentials:'same-origin'});if(!r.ok)return null;const u=URL.createObjectURL(await r.blob());try{const im=new Image();im.src=u;await im.decode();const c=document.createElement('canvas'),k=Math.min(1,1600/im.naturalWidth);c.width=Math.round(im.naturalWidth*k);c.height=Math.round(im.naturalHeight*k);c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',0.85);}finally{URL.revokeObjectURL(u);}}catch(ex){console.warn('Imagen PDF',ex);return null;}}
async function buildPdf(p,kind){
 const {jsPDF}=await loadJsPdf(),doc=new jsPDF({unit:'mm',format:'a4'}),W=210,H=297,M=16,CW=W-2*M,NAVY=[23,41,66],ACC=[91,81,184],MUT=[110,120,140],LINE=[226,230,238];
 const trip=kind==='trip',ops=S.operations||{},it=ops.itinerary||[],info=trip?tripInfo(p):null,label=trip?'Itinerario del viaje':'Dossier del proyecto';let y=M;
 const font=(sz,st='normal',c=NAVY)=>{doc.setFont('helvetica',st);doc.setFontSize(sz);doc.setTextColor(...c);};
 const foot=()=>{const n=doc.getNumberOfPages();for(let i=2;i<=n;i++){doc.setPage(i);font(8,'normal',MUT);doc.text(pdfTxt(`DUPLA · ${p.title} · ${label}`),M,H-8);doc.text(`${i-1} / ${n-1}`,W-M,H-8,{align:'right'});doc.setDrawColor(...LINE);doc.line(M,H-12,W-M,H-12);}};
 const need=h=>{if(y+h>H-18){doc.addPage();y=M;}};
 const para=(t,sz=10,c=[70,80,100],w=CW,x=M)=>{font(sz,'normal',c);for(const l of doc.splitTextToSize(pdfTxt(t),w)){need(sz*0.45);doc.text(l,x,y);y+=sz*0.45;}};
 const h2=(t)=>{need(18);y+=4;doc.setFillColor(...ACC);doc.rect(M,y-4.2,1.6,6,'F');font(15,'bold');doc.text(pdfTxt(t),M+5,y);y+=8;};
 const table=(cols,rows,widths)=>{const xs=[M];widths.forEach((w,i)=>xs.push(xs[i]+w*CW));const head=()=>{need(9);doc.setFillColor(243,244,249);doc.rect(M,y-4.5,CW,7,'F');font(8,'bold',MUT);cols.forEach((c,i)=>doc.text(pdfTxt(c).toUpperCase(),xs[i]+1.5,y));y+=5;};head();
  for(const r of rows){font(9,'normal',[40,50,70]);const lines=r.map((c,i)=>doc.splitTextToSize(pdfTxt(c),widths[i]*CW-3));const h=Math.max(...lines.map(l=>l.length))*4+2.5;if(y+h>H-18){doc.addPage();y=M;head();}lines.forEach((l,i)=>{font(9,i===0?'bold':'normal',[40,50,70]);doc.text(l,xs[i]+1.5,y+0.5);});y+=h;doc.setDrawColor(...LINE);doc.line(M,y-2.5,W-M,y-2.5);}y+=3;};
 const kpis=list=>{need(24);const w=(CW-(list.length-1)*4)/list.length;list.forEach(([k,v],i)=>{const x=M+i*(w+4);doc.setFillColor(246,247,251);doc.roundedRect(x,y,w,20,3,3,'F');font(8,'normal',MUT);doc.text(pdfTxt(k),x+4,y+6.5);font(13,'bold');doc.text(doc.splitTextToSize(pdfTxt(v),w-8)[0]||'',x+4,y+15);});y+=27;};
 const box=(x,yy,s,on)=>{doc.setDrawColor(...(on?[79,136,110]:[160,170,188]));doc.setLineWidth(0.4);if(on){doc.setFillColor(79,136,110);doc.roundedRect(x,yy-3,3.6,3.6,0.8,0.8,'FD');doc.setDrawColor(255,255,255);doc.setLineWidth(0.6);doc.line(x+0.8,yy-1.2,x+1.5,yy-0.4);doc.line(x+1.5,yy-0.4,x+2.9,yy-2.2);}else doc.roundedRect(x,yy-3,3.6,3.6,0.8,0.8,'S');doc.setLineWidth(0.2);};
 const range=p.start_date?`${short(p.start_date)} - ${short(p.end_date||p.start_date)}`:'';
 // Portada
 const cover=p.cover_file?await imgData(`/api/projects/${p.id}/cover?v=${encodeURIComponent(p.cover_file.slice(0,8))}`):null;
 doc.setFillColor(...NAVY);doc.rect(0,0,W,H,'F');
 if(cover){try{const pr=doc.getImageProperties(cover),r=Math.max(W/pr.width,190/pr.height);doc.addImage(cover,'JPEG',(W-pr.width*r)/2,0,pr.width*r,pr.height*r);}catch(ex){console.error('Portada PDF',ex);}doc.setGState(new doc.GState({opacity:0.55}));doc.setFillColor(...NAVY);doc.rect(0,0,W,190,'F');doc.setGState(new doc.GState({opacity:1}));doc.setFillColor(...NAVY);doc.rect(0,190,W,H-190,'F');}
 font(10,'bold',[255,214,107]);doc.text(pdfTxt(label.toUpperCase()),M,150);font(34,'bold',[255,255,255]);const tl=doc.splitTextToSize(pdfTxt(p.title),CW);doc.text(tl,M,165);let cy=165+tl.length*13;
 font(12,'normal',[220,226,240]);const sub=[p.destination,range,info?.n?`${info.n} días`:'',p.space==='work'?'Trabajo':'Nuestro espacio'].filter(Boolean).join('  ·  ');if(sub){doc.text(pdfTxt(sub),M,cy);cy+=8;}
 font(9,'normal',[170,180,205]);doc.text(pdfTxt(`Álvaro & Angie  ·  Generado el ${new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})}`),M,H-22);font(16,'bold',[255,255,255]);doc.text('DUPLA',W-M,H-22,{align:'right'});
 doc.addPage();y=M;
 const exp=p.expenses||[],est=exp.reduce((n,x)=>n+Number(x.estimated||0),0),real=exp.reduce((n,x)=>n+Number(x.actual||0),0),w=(S.weather||{})[(p.destination||'').toLowerCase()];
 h2('Resumen');
 if(trip)kpis([['Días',`${info.doneN}/${info.n} completados`],['Actividades',String(it.filter(x=>x.state!=='cancelled').length)],['Reservas hechas',`${it.filter(x=>x.booking_state==='booked').length} de ${it.filter(x=>x.booking_state==='booked'||x.booking_state==='pending').length}`],['Presupuesto',`${eur(est)} / ${eur(real)} real`]]);
 else{const done=p.tasks.filter(t=>t.state==='done').length,mins=(ops.hours||[]).reduce((n,x)=>n+x.minutes,0);kpis([['Estado',STATUS[p.status]||p.status],['Tareas',`${done}/${p.tasks.length} hechas`],['Tiempo dedicado',`${(mins/60).toFixed(1)} h`],['Presupuesto',`${eur(est)} / ${eur(real)} real`]]);}
 if(p.description)para(p.description,10);
 if(w?.found){y+=2;para(`Tiempo en ${w.place||p.destination}: ${Math.round(w.temp)}° · ${w.text} (consultado el ${new Date().toLocaleDateString('es-ES')}).`,9,MUT);}
 if(!trip&&p.start_date)para(`Fechas: ${range}.`,9,MUT);
 if(trip){
  h2('Itinerario por días');const cal=tripCalendar(p);
  info.days.forEach((d,k)=>{const list=it.filter(x=>x.visit_date===d),evs=p.events.filter(x=>x.event_date===d),gc=cal.filter(x=>x.date===d);need(16);doc.setFillColor(...(info.done.has(d)?[232,245,238]:[243,242,255]));doc.roundedRect(M,y-5,CW,8,2,2,'F');box(M+3,y,0,info.done.has(d));font(11,'bold');doc.text(pdfTxt(`Día ${k+1}`),M+9,y);font(9,'normal',MUT);doc.text(pdfTxt(cap(new Date(d+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})))+(info.done.has(d)?'  ·  completado':''),M+28,y);y+=8;
   const rows=[...list.map(x=>({t:x.visit_time,ti:x.title,l:x.location,b:x.state==='cancelled'?'Cancelada':(BOOK[x.booking_state]||BOOK.pending)[0]+(x.reference?' · '+x.reference:'')+(x.booking_used?' · utilizada':''),on:x.state==='done',d:x.details})),...evs.map(x=>({t:x.event_time,ti:x.title,l:x.location,b:'Plan del proyecto'})),...gc.map(x=>({t:x.time,ti:x.title,l:x.location,b:'Calendario compartido'}))].sort((a,b)=>(a.t||'99').localeCompare(b.t||'99'));
   if(!rows.length){para('Día libre.',9,MUT);y+=2;}
   for(const r of rows){need(10);box(M+3,y,0,r.on);font(9,'bold',ACC);doc.text(pdfTxt(r.t||'--:--'),M+9,y);font(10,'bold',[30,40,60]);const tt=doc.splitTextToSize(pdfTxt(r.ti),CW-75);doc.text(tt,M+22,y);font(8,'normal',MUT);doc.text(doc.splitTextToSize(pdfTxt(r.b),48),W-M,y,{align:'right'});y+=tt.length*4.4;if(r.l){font(8,'normal',MUT);doc.text(pdfTxt('Lugar: '+r.l),M+22,y);y+=4;}if(r.d){para(r.d,8,[90,100,120],CW-30,M+22);}y+=2;}
   y+=3;});
  const bk=it.filter(x=>x.booking_state!=='not_needed');if(bk.length){h2('Reservas');table(['Actividad','Día','Estado','Referencia'],bk.map(x=>[x.title,short(x.visit_date)+(x.visit_time?' '+x.visit_time:''),x.state==='cancelled'?'Cancelada':(BOOK[x.booking_state]||BOOK.pending)[0]+(x.booking_used?' (utilizada)':''),x.reference||'-']),[.38,.17,.25,.2]);}
  const locs=[...new Set([p.destination,...it.map(x=>x.location),...p.events.map(x=>x.location)].filter(Boolean))];if(locs.length){h2('Ubicaciones');for(const l of locs){need(6);font(10,'normal',ACC);doc.textWithLink(pdfTxt('• '+l),M,y,{url:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(l)});y+=5.5;}font(8,'normal',MUT);need(5);doc.text('Cada ubicación abre Google Maps.',M,y);y+=4;}
 }else{
  h2('Tareas');if(p.tasks.length)table(['Tarea','Estado','Fecha'],p.tasks.map(t=>[t.title,{todo:'Pendiente',doing:'En marcha',done:'Hecha'}[t.state]||t.state,t.due_date?short(t.due_date):'-']),[.6,.2,.2]);else para('Sin tareas.',9,MUT);
  if((ops.hours||[]).length){h2('Tiempo');table(['Persona','Día','Horas','Nota'],ops.hours.slice(0,40).map(x=>[x.person||'',short(x.work_date),(x.minutes/60).toFixed(1)+' h',x.note||x.description||'']),[.2,.15,.15,.5]);}
 }
 h2(trip?'Gastos':'Presupuesto');if(exp.length){const cats={};for(const x of exp){const c=cats[x.category||'general']=cats[x.category||'general']||[0,0];c[0]+=Number(x.estimated||0);c[1]+=Number(x.actual||0);}table(['Concepto','Categoría','Previsto','Real'],[...exp.map(x=>[x.title,x.category||'general',eur(x.estimated),eur(x.actual)]),...Object.entries(cats).map(([c,[a,b]])=>['Total '+c,'',eur(a),eur(b)]),['TOTAL','',eur(est),eur(real)]],[.42,.22,.18,.18]);}else para('Sin gastos registrados.',9,MUT);
 const cl=(p.checklists||[]);if(trip||cl.length){h2('Checklist');const groups=p.tasks.filter(t=>trip||cl.some(c=>c.task_id===t.id));if(!groups.length)para('Sin elementos.',9,MUT);for(const t of groups){need(7);box(M,y,0,t.state==='done');font(10,'bold',[30,40,60]);doc.text(pdfTxt(t.title),M+6,y);y+=5.5;for(const c of cl.filter(c=>c.task_id===t.id)){need(6);box(M+6,y,0,!!c.done);font(9,'normal',[60,70,90]);doc.text(pdfTxt(c.title),M+12,y);y+=5;}}}
 if(!trip){const files=[...(p.assets||[]).map(a=>[a.name,a.mime,`${Math.max(1,Math.round(a.size/1024))} KB`]),...(p.links||[]).map(l=>[l.label,'Enlace',l.url])];h2('Archivos y enlaces');if(files.length)table(['Nombre','Tipo','Detalle'],files,[.4,.2,.4]);else para('Sin archivos.',9,MUT);
  h2('Actividad reciente');const acts=(p.activities||[]).slice(0,25);if(acts.length)table(['Quién','Qué','Cuándo'],acts.map(a=>[a.author||'',`${a.action} ${a.detail||''}`,fmt(a.created_at)]),[.18,.6,.22]);else para('Sin actividad.',9,MUT);}
 const notes=(p.sections||[]).filter(n=>String(n.content||'').trim());h2('Notas');if(!notes.length)para('Sin notas escritas.',9,MUT);for(const n of notes){need(10);font(11,'bold');doc.text(pdfTxt(n.title),M,y);y+=5.5;para(String(n.content).replace(/<[^>]+>/g,' ').replace(/[#*_>`]/g,'').slice(0,6000),9.5);y+=4;}
 foot();
 return {blob:doc.output('blob'),name:`DUPLA - ${pdfTxt(p.title).replace(/[\\/:*?"<>|]/g,'')} - ${trip?'itinerario':'dossier'}.pdf`};
}
return {buildPdf};}
