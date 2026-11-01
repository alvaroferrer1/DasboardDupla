(async()=>{const w=ms=>new Promise(r=>setTimeout(r,ms)),f=[],log=[];await w(900);const H=()=>location.hash,act=()=>document.querySelector('.sidebar .nav-item.active')?.dataset.nav,modal=()=>!!document.querySelector('#modal-root .modal-card');
const go=async s=>{const el=document.querySelector(s);if(el&&!el.offsetParent&&s.startsWith('.sidebar'))document.querySelector('[data-action=toggle-menu]').click();if(!el){f.push('falta '+s);return;}el.click();await w(1400);log.push(H());};const back=async()=>{history.back();await w(1600);log.push('←'+H());};
await go('.sidebar [data-nav="work"]');if(H()!=='#/trabajo')f.push('trabajo '+H());
await go('.sidebar [data-nav="dates"]');if(H()!=='#/calendario')f.push('calendario '+H());
await back();if(H()!=='#/trabajo'||act()!=='work')f.push('Atrás→trabajo: '+H()+' '+act());
await go('.project-card');const ph=H();if(!ph.startsWith('#/proyecto/'))f.push('proyecto '+ph);
await go('[data-action="edit-task"]');if(!/\/tarea\//.test(H())||!modal())f.push('tarea '+H());
await back();if(modal())f.push('Atrás no cierra la ventana');if(H()!==ph)f.push('tras cerrar '+H());
await back();if(H()!=='#/trabajo'||act()!=='work')f.push('Atrás desde proyecto '+H());
await go('.project-card');await go('[data-action="edit-task"]');await go('#modal-root .icon-btn[data-action="close-modal"]');if(modal())f.push('X no cierra');if(H()!==ph)f.push('tras X '+H());
await back();if(H()!=='#/trabajo')f.push('tras X, Atrás no vuelve a trabajo: '+H());
await go('.sidebar [data-nav="finance"]');await go('.sidebar [data-nav="board"]');await back();if(H()!=='#/finanzas'||act()!=='finance')f.push('Atrás→finanzas '+H());
if(f.length)console.error('RUTAS: '+f.join(' | '));const b=document.createElement('div');b.textContent=`PRUEBA RUTAS ${f.length?'FALLA':'OK'} · ${log.join(' ')}`;b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#111;color:#0f0;font:12px monospace;padding:6px;white-space:normal';document.body.appendChild(b);
})()
