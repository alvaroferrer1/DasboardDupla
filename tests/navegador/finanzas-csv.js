// Descarga de movimientos, sugerencias según contexto y saltar al contenido.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[];await w(900);location.hash='#/finanzas';await w(1400);
let csv='';const real=URL.createObjectURL;URL.createObjectURL=x=>{x.text().then(t=>{csv=t;});return real.call(URL,x);};
document.querySelector('[data-action="fin-all"]').click();await w(900);const b=document.querySelector('[data-action="fin-csv"]');if(!b)f.push('sin botón CSV');else{b.click();await w(400);}URL.createObjectURL=real;
if(!csv.includes('Fecha;')&&!csv.includes('"Fecha";'))f.push('CSV sin cabecera');if(csv.split('\r\n').length<2)f.push('CSV vacío');
document.querySelector('[data-action="close-modal"]')?.click();await w(400);location.hash='#/chat';await w(900);
if(!document.querySelector('.dp-sug'))f.push('sin sugerencias');const skip=document.querySelector('.skip-link');if(!skip)f.push('sin saltar al contenido');else{skip.click();await w(100);if(document.activeElement?.id!=='content')f.push('saltar no lleva al contenido');}
if(f.length)console.error('FINANZAS: '+f.join(' | '));})();
