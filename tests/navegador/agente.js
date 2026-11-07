// Agente Dupla con la IA simulada: detener conserva el texto, una propuesta no se ejecuta dos veces, un fallo se puede reintentar.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),fallos=[],real=window.fetch;let creadas=0,falla=true,modo='cuelga',cuelga=null;
const msg=(status='pending')=>({id:'11111111-1111-4111-8111-111111111111',role:'assistant',content:'Te propongo esto.',created_at:new Date().toISOString(),proposals:[{id:'p1',tool:'crear_idea',status,method:'POST',path:'/api/ideas',body:{space:'couple',title:'Idea simulada',body:'Detalle visible antes de confirmar'},summary:'Idea «Idea simulada»'}]});
const json=d=>new Response(JSON.stringify(d),{status:200,headers:{'content-type':'application/json'}});let lista=[];
window.fetch=(u,o={})=>{const p=String(u);if(p==='/api/agent'&&o.method==='POST'){if(modo==='cuelga')return new Promise((_,no)=>{cuelga=true;o.signal.addEventListener('abort',()=>no(new DOMException('parado','AbortError')));});lista=[msg()];return Promise.resolve(json({message:{...lista[0],trace:[{tool:'buscar',ok:false}]}}));}
 if(p==='/api/agent')return Promise.resolve(json({available:true,messages:lista,memory:[]}));
 if(p.includes('/proposals/'))return Promise.resolve(json({ok:true}));
 if(p==='/api/ideas'&&o.method==='POST'){creadas++;if(falla){falla=false;return Promise.resolve(new Response('{"error":"Fallo simulado"}',{status:500}));}return w(300).then(()=>json({idea:{id:'abc'}}));}
 return real(u,o);};
await w(800);location.hash='#/chat';await w(900);const q=s=>document.querySelector(s);
const caja=q('[data-dupla-form] textarea');if(!caja){console.error('AGENTE: sin formulario');return;}
caja.value='Mensaje que no debe perderse';caja.form.requestSubmit();await w(300);
if(!cuelga)fallos.push('no llamó a la IA');const stop=q('[data-action="dupla-stop"]');if(!stop)fallos.push('sin botón Detener');else stop.click();await w(300);
if(q('[data-dupla-form] textarea')?.value!=='Mensaje que no debe perderse')fallos.push('el texto se perdió al detener');if(q('[data-action="dupla-stop"]'))fallos.push('Detener sigue visible');
modo='ok';q('[data-dupla-form]').requestSubmit();await w(500);
if(!q('.dupla-warn'))fallos.push('no avisa del paso fallido');if(!q('.dupla-prop-det')?.textContent.includes('Detalle visible'))fallos.push('la propuesta no enseña el detalle');
q('[data-action="dupla-confirm"]').click();await w(250);if(creadas!==1)fallos.push('primer intento: '+creadas);
const re=[...document.querySelectorAll('[data-action="dupla-confirm"]')].find(b=>b.textContent==='Reintentar');if(!re)fallos.push('sin Reintentar');else{re.click();re.click();await w(60);document.querySelector('[data-action="dupla-confirm"]')?.click();await w(600);}
if(creadas!==2)fallos.push('ejecutada '+creadas+' veces en vez de 2');
window.fetch=real;if(fallos.length)console.error('AGENTE: '+fallos.join(' | '));const b=document.createElement('div');b.textContent='PRUEBA AGENTE: '+(fallos.length?fallos.join(' | '):'detener, detalle, reintentar y sin dobles');b.style.cssText='position:fixed;left:0;bottom:0;background:#000;color:#fff;padding:6px;z-index:9999;font-size:12px';document.body.appendChild(b);})();
