// Tras tres arrastres reales: tres antes de dos · uno a Parado antes de «Prueba parada» · dos encima de una urgente (debe quedar bajo las urgentes).
(async()=>{const f=[];const it=(await fetch('/api/board').then(r=>r.json())).items;const uno=it.find(x=>x.title==='Prueba uno');if(uno.status!=='blocked')f.push('Prueba uno no pasó a Parado: '+uno.status);
const col=k=>[...document.querySelectorAll(`[data-col="${k}"] .bd-card > b`)].map(x=>x.textContent);
if(col('blocked').join()!=='Urgente parada,Prueba uno,Prueba parada')f.push('orden Parado: '+col('blocked'));
const t=col('todo'),normales=t.filter(x=>/^Prueba (dos|tres)$/.test(x));if(normales.join()!=='Prueba dos,Prueba tres')f.push('orden Pendiente: '+t);
const pr=[...document.querySelectorAll('[data-col="todo"] .bd-prio')].map(x=>x.textContent);if(pr[0]!=='Urgente'||pr.lastIndexOf('Urgente')>pr.indexOf('Normal')&&pr.includes('Normal'))f.push('una normal quedó sobre una urgente: '+pr);
const so=x=>it.find(y=>y.title===x).sort;if(!(so('Prueba dos')<so('Prueba tres')))f.push('orden no guardado en el servidor');
if(f.length)console.error('TABLERO ARRASTRE: '+f.join(' | '));})()
