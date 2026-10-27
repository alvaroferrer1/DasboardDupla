/** Read-only smoke suite for the ACTUAL deployed HTTPS URL. Never runs without an explicit URL. */
const raw=process.argv[2];
if(!raw){console.error('Uso: node scripts/cloud-smoke.mjs https://NOMBRE.SUBDOMINIO.workers.dev');process.exit(2);}
let base;
try {base=new URL(raw);}catch {console.error('URL inválida');process.exit(2);}
if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/'){
 console.error('Usa una URL HTTPS exacta de la web, sin credenciales ni rutas');process.exit(2);
}
const checks=[];
async function verify(name,fn){try{const evidence=await fn();checks.push({name,ok:true,evidence});console.log('✓',name,evidence||'');}catch(e){checks.push({name,ok:false,error:e.message});console.error('✗',name,e.message);}}
const get=(path,opts={})=>fetch(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(10000),...opts});
await verify('HTTPS y respuesta pública de salud',async()=>{
 const r=await get('/api/health');const j=await r.json();if(r.status!==200||j.status!=='ok')throw Error(`${r.status} o salud no OK`);return `HTTP ${r.status}`;
});
await verify('Inicio de sesión privado',async()=>{
 const r=await get('/api/dashboard');if(r.status!==401)throw Error('Sin autenticación responde '+r.status);return '401';
});
await verify('Cabeceras del sitio',async()=>{
 const r=await get('/');if(r.status!==200)throw Error('Home '+r.status);
 for(const h of ['content-security-policy','strict-transport-security','x-content-type-options','x-frame-options'])if(!r.headers.get(h))throw Error(`Falta ${h}`);
 return 'CSP + HSTS + nosniff + frame deny';
});
await verify('CSS y JS accesibles',async()=>{
 for(const path of ['/style.css','/app.js']){const r=await get(path);if(r.status!==200)throw Error(`${path} → ${r.status}`);}
 return '2 recursos entregados';
});
await verify('Configuración sin exponer claves',async()=>{
 const r=await get('/api/me');const j=await r.json();if(r.status!==200||typeof j.configured!=='boolean'||j.user!==null)throw Error('Estado de usuario no conforme');
 if(JSON.stringify(j).includes('SETUP_TOKEN'))throw Error('Referencia secreta en payload');
 return 'configurado: '+j.configured;
});
await verify('Origen cruzado bloqueado',async()=>{
 const r=await get('/api/login',{method:'POST',headers:{origin:'https://atacante.example','content-type':'application/json'},body:JSON.stringify({email:'x@example.invalid',password:'fake'})});
 if(r.status!==403)throw Error('Se esperaba 403, recibido '+r.status);return '403';
});
const report={url:base.origin,checked_at:new Date().toISOString(),passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).length,checks,note:'Estas comprobaciones NO prueban WebSockets, dos sesiones ni la persistencia tras reinicio; esas verificaciones requieren cuentas reales y autorización.'};
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
