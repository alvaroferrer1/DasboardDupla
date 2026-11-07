// Marcar como pagado lo pendiente de un viaje, en parte y entero, y deshacerlo.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[],q=s=>document.querySelector(s);await w(900);location.hash='#/presupuestos';await w(1400);
const me=await (await fetch('/api/balance')).json();const viaje=me.projects.find(x=>x.owes);if(!viaje){console.error('SALDAR: sin viaje con deuda');return;}
location.hash='#/proyecto/'+viaje.id+'/budget';await w(1600);if(!q('.bal'))document.querySelector('[data-tab="budget"]')?.click();await w(900);
const paz=()=>!!q('.bal-owe.ok');if(!q('[data-action="proj-settle"]'))f.push('sin botón Ya está pagado');
q('[data-action="proj-partial"]')?.click();await w(500);const amount=q('#modal-root input[name="amount"]');if(!amount)f.push('sin ventana de pago parcial');else{amount.value='1';q('#modal-root form').requestSubmit();await w(1000);}
if(!q('.bal-pays li'))f.push('el pago parcial no aparece');if(paz())f.push('parcial saldó todo');
q('[data-action="proj-settle"]')?.click();await w(1000);if(!paz())f.push('no queda en paz');if(q('[data-action="proj-settle"]'))f.push('el botón sigue');
const b=await (await fetch('/api/balance')).json();if(b.projects.find(x=>x.id===viaje.id).owes)f.push('la API aún debe');
document.querySelector('[data-action="proj-unsettle"]')?.click();await w(1000);if(paz())f.push('deshacer no devuelve la deuda');
if(f.length)console.error('SALDAR: '+f.join(' | '));})();
