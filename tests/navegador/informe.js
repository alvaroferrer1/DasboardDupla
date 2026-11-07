// «Lo próximo» se ve en los espacios y el informe web se genera con el contenido real del proyecto.
(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[];await w(900);location.hash='#/trabajo';await w(1300);
if(!document.querySelector('.space-next .upcoming'))f.push('sin «Lo próximo» en Trabajo');
document.querySelector('.project-card').click();await w(1500);const b=document.querySelector('[data-action="project-report"]');
let html='';const real=URL.createObjectURL;URL.createObjectURL=x=>{x.text().then(t=>{html=t;});return real.call(URL,x);};
if(!b)f.push('sin botón Informe web');else{b.click();await w(500);}URL.createObjectURL=real;
const t=document.querySelector('.project-identity h1')?.textContent.trim();
if(!html.includes('<h1>'))f.push('informe vacío');if(t&&!html.includes(t.slice(0,12)))f.push('informe sin el título');if(/undefined|null ·/.test(html))f.push('informe con huecos');
if(f.length)console.error('INFORME: '+f.join(' | '));})();
