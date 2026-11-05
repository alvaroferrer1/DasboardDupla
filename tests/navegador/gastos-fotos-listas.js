// Recorrido real: gasto «para quién», saldo, fotos (grandes se reducen), ampliar, Finanzas, listas con foto y álbum.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[];await w(700);
const until=async(fn,ms=12000)=>{const t=Date.now();while(Date.now()-t<ms){try{if(fn())return true;}catch{}await w(120);}return false;};
const js=(u,b,m='POST')=>fetch(u,{method:m,headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
const dash=await fetch('/api/dashboard').then(r=>r.json()),me=(await fetch('/api/me').then(r=>r.json())).user,otro=dash.users.find(u=>u.id!==me.id);
const P=(await js('/api/projects',{space:'couple',title:'Madrid prueba',template:'trip',destination:'Madrid'})).project;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
location.hash='#/proyecto/'+P.id+'/budget';await until(()=>$('[data-action="new-expense"]'));
$('[data-action="new-expense"]').click();await until(()=>$('#exp-hint'));
const fm=$('#modal-form')||$('#modal-root form'),set=(n,v)=>{const i=fm.querySelector(`[name=${n}]`);i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}));};
set('title','Hotel Gran Vía');set('estimated','120');set('actual','120');set('paid_by',otro.id);set('for_user',me.id);
if(!/le debe 120/.test($('#exp-hint').textContent))f.push('aviso de reparto: '+$('#exp-hint').textContent);
fm.querySelector('button[type=submit]').click();await until(()=>$('.exp-who')&&!$('.modal-card'));await w(300);
if(!/120/.test($('.bal-owe')?.textContent||''))f.push('saldo del viaje: '+$('.bal')?.outerHTML?.slice(0,300)+' // '+location.hash+' // '+document.querySelector('.project-tab.on')?.textContent);
if(!/para /.test($('.exp-who')?.textContent||''))f.push('tabla sin quién y para quién: '+$('.exp-who')?.textContent);
// Foto de ruido grande (>1,5 MB) + foto pequeña.
const png=(s,noise)=>new Promise(ok=>{const c=document.createElement('canvas');c.width=c.height=s;const g=c.getContext('2d'),d=g.createImageData(s,s);for(let i=0;i<d.data.length;i++)d.data[i]=i%4===3?255:noise?Math.random()*255:120;g.putImageData(d,0,0);c.toBlob(ok,'image/png');});
const dt=list=>{const t=new DataTransfer();for(const [n,b] of list)t.items.add(new File([b],n,{type:'image/png'}));return t.files;};
const big=await png(2600,true);if(big.size<1.6e6)f.push('la foto de prueba no es grande: '+big.size);
location.hash='#/proyecto/'+P.id+'/photos';await until(()=>$('[data-ph-up]'));
const up=$('[data-ph-up]');up.files=dt([['grande.png',big],['pequena.png',await png(300,false)]]);up.dispatchEvent(new Event('change',{bubbles:true}));
if(!await until(()=>$$('.ph-it').length===2,25000))f.push('fotos subidas: '+$$('.ph-it').length);
if(!await until(()=>$$('.ph-it img').every(i=>i.naturalWidth>0)))f.push('foto sin cargar');
const as=await fetch('/api/projects/'+P.id).then(r=>r.json()),A=(as.project||as).assets;if(A.find(a=>/grande/.test(a.name))?.mime!=='image/jpeg')f.push('la grande no se redujo a JPG');
$('.ph-it').click();await until(()=>$('.ph-box img'));
if(!await until(()=>$('.ph-box img').naturalWidth>0))f.push('foto ampliada sin cargar');const a1=$('.ph-box img').src;
document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await w(250);if($('.ph-box img').src===a1)f.push('flecha no pasa de foto');
document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await w(250);if($('.ph-box'))f.push('Esc no cierra la foto');
// Finanzas: las cuatro tarjetas bien y la deuda total.
const go=async v=>{if(innerWidth<851){$('[data-action="toggle-menu"]')?.click();await w(250);}$('.sidebar [data-nav="'+v+'"]').click();};
await go('finance');await until(()=>$('.fin-debt'));
const tarjetas=()=>{const cs=$$('.fk-grid>.fk-card');if(cs.length!==4)f.push('tarjetas: '+cs.length);for(const c of cs){const s=getComputedStyle(c),l=c.querySelector('.fk-l').getBoundingClientRect(),v=c.querySelector('.fk-v').getBoundingClientRect(),h=c.querySelector('.fk-h').getBoundingClientRect();if(s.flexDirection!=='column'||s.display!=='flex'||parseFloat(s.paddingLeft)<14||s.backgroundColor==='rgba(0, 0, 0, 0)'||!(l.bottom<=v.top+1&&v.bottom<=h.top+1))f.push('tarjeta rota: '+c.textContent);}};tarjetas();
for(const s of ['[data-action="fin-period"][data-v="quarter"]','[data-action="fin-period"][data-v="month"]','[data-action="fin-tab"][data-v="groups"]','[data-action="fin-tab"][data-v="summary"]']){$(s).click();await w(450);if($('.fk-grid'))tarjetas();}
if(!/Madrid prueba/.test($('.fin-debt-s')?.textContent||''))f.push('deuda sin el viaje: '+$('.fin-debt')?.textContent);
// Listas.
await go('couple');await until(()=>$('[data-action="cp-tab"][data-v="listas"]'));$('[data-action="cp-tab"][data-v="listas"]').click();await until(()=>$('#cl-new'));
$('#cl-new [name=title]').value='20 cosas';$('#cl-new [name=goal]').value='20';$('#cl-new').requestSubmit();await until(()=>$('#cl-add'));
$('#cl-add [name=titles]').value='1. Ver amanecer\n2) Cocinar juntos\n- Ruta en bici';$('#cl-add').requestSubmit();
if(!await until(()=>$$('.cl-item').length===3))f.push('cosas añadidas: '+$$('.cl-item').length);
if($('.cl-item b')?.textContent!=='Ver amanecer')f.push('no quita el número: '+$('.cl-item b')?.textContent);
$('[data-action="cl-done"]').click();await until(()=>$('.cl-item.done'));if(!/1 de 20/.test($('.cl-sum')?.textContent||''))f.push('progreso: '+$('.cl-sum')?.textContent);
const up2=$('[data-cl-photo]');up2.files=dt([['p.png',await png(400,false)]]);up2.dispatchEvent(new Event('change',{bubbles:true}));
if(!await until(()=>$('.cl-ph img')?.naturalWidth>0))f.push('foto de lista');
const n=$('.cl-note');n.value='En Cádiz';n.dispatchEvent(new Event('change',{bubbles:true}));await w(400);
const L=(await fetch('/api/couple-lists').then(r=>r.json())).items[0],D=await fetch('/api/couple-lists/'+L.id).then(r=>r.json());if(D.items[0].note!=='En Cádiz')f.push('nota no guardada');
// Álbum común.
$('[data-action="cp-tab"][data-v="recuerdos"]').click();if(!await until(()=>$$('.cp-allph .ph-it').length>=3))f.push('álbum: '+$$('.cp-allph .ph-it').length);
if(f.length)console.error('GASTOS FOTOS LISTAS: '+f.join(' | '));
})()
