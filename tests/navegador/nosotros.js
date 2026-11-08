(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),$=s=>document.querySelector(s),fail=m=>console.error('NOSOTROS: '+m);await w(900);
const card=$('.us-card');if(!card)return fail('no hay tarjeta en el inicio');
const fill=(sel,v)=>{const el=$(sel);el.value=v;el.form.requestSubmit();};
if($('#us-answer')){fill('#us-answer','Prueba de respuesta');await w(900);}if(!/Prueba de respuesta/.test($('.us-card').textContent))fail('la respuesta no aparece');
$('.us-card [data-action="us-mood"][data-v="4"]').click();await w(900);if($('.us-card [data-v="4"]').getAttribute('aria-pressed')!=='true')fail('el ánimo no queda marcado');
fill('#us-note-text','Nota de prueba');await w(900);
$('.us-card [data-nav="us"]').click();await w(1200);if(!$('.us-page'))return fail('no abre la página');
if(!/Nota de prueba/.test($('.us-page').textContent))fail('la nota enviada no sale en la lista');
const n=document.querySelectorAll('.us-hab').length;fill('#us-habit-title','Paseo '+Date.now());await w(900);const habs=document.querySelectorAll('.us-hab');if(habs.length!==n+1)return fail('no se crea el hábito');const hab=habs[habs.length-1];const was=hab.getAttribute('aria-pressed');hab.click();await w(900);const now=document.querySelectorAll('.us-hab')[habs.length-1];if(now.getAttribute('aria-pressed')===was)fail('el hábito no cambia al marcarlo');
$('[data-action="us-quiz-start"]').click();await w(400);for(let i=0;i<10;i++){const b=$('.us-quiz-opts button');if(!b)return fail('test cortado en la pregunta '+(i+1));b.click();await w(500);}
if(!/Tú:/.test($('.us-page').textContent))fail('el test no guarda el resultado');})()
