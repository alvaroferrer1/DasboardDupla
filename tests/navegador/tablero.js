(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[];await w(800);
const post=b=>fetch('/api/board',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
await post({title:'Prueba uno',priority:'normal'});await post({title:'Prueba dos',priority:'normal'});await post({title:'Prueba tres',priority:'normal'});await post({title:'Prueba urgente',priority:'urgent'});await post({title:'Prueba parada',priority:'normal',status:'blocked'});await post({title:'Urgente parada',priority:'urgent',status:'blocked'});
document.querySelector('.sidebar [data-nav="board"]').click();await w(1300);
const col=k=>[...document.querySelectorAll(`[data-col="${k}"] .bd-card > b`)].map(x=>x.textContent);
const pr=k=>[...document.querySelectorAll(`[data-col="${k}"] .bd-prio`)].map(x=>x.textContent);
if(col('blocked')[0]!=='Urgente parada')f.push('urgente no sale arriba en Parado: '+col('blocked'));
const rank={Urgente:0,Alta:1,Normal:2,Baja:3},p=pr('todo').map(x=>rank[x]);if(p.join()!==[...p].sort().join())f.push('Pendiente no va por prioridad: '+pr('todo'));
const click=async s=>{document.querySelector(s).click();await w(350);};
await click('[data-action="bd-prio"][data-v="urgent"]');if([...document.querySelectorAll('.bd-prio')].some(x=>x.textContent!=='Urgente'))f.push('filtro urgente deja pasar otras');if(!document.querySelectorAll('.bd-card').length)f.push('filtro urgente vacío');
await click('[data-action="bd-prio"][data-v="urgent"]');if(document.querySelector('.bd-pf.active'))f.push('segundo clic no quita el filtro');
await click('[data-action="bd-state"][data-v="blocked"]');if(document.querySelectorAll('.bd-col').length!==1||!document.querySelector('.bd-board.solo'))f.push('filtro Parado no deja una sola lista');
await click('[data-action="bd-state"][data-v="all"]');if(document.querySelectorAll('.bd-col').length!==4)f.push('Todos no vuelve a 4 columnas');
// Flecha ↑: Prueba dos sube por encima de Prueba uno y queda guardado.
const card=t=>[...document.querySelectorAll('.bd-card')].find(c=>c.querySelector(':scope > b').textContent===t);
card('Prueba dos').querySelector('[data-action="bd-step"][data-dir="-1"]').click();await w(900);
const names=col('todo').filter(x=>x.startsWith('Prueba')&&x!=='Prueba urgente');if(names.join()!=='Prueba dos,Prueba uno,Prueba tres')f.push('↑ no reordena: '+names);
const it=(await fetch('/api/board').then(r=>r.json())).items,sv=t=>it.find(x=>x.title===t).sort;if(!(sv('Prueba dos')<sv('Prueba uno')))f.push('↑ no se guarda en el servidor');
if(card('Prueba urgente').querySelector('[data-action="bd-step"][data-dir="-1"]').disabled===false&&col('todo')[0]==='Prueba urgente')f.push('la primera puede subir');
if(f.length)console.error('TABLERO: '+f.join(' | '));})()
