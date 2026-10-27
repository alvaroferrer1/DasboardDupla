// Check a *deployed* DOS ESPACIOS URL without requiring passwords or modifying data.
const endpoint=process.argv[2];
if(!endpoint||!/^https:\/\//i.test(endpoint)){
 console.error('Uso: node scripts/check-public.mjs https://tu-app.up.railway.app');
 process.exit(2);
}
const root=endpoint.replace(/\/+$/,'');
for (const [path,check] of [
 ['/api/health',body=>body.status==='ok'],
 ['/api/me',body=>typeof body.configured==='boolean'],
]) {
 try {
  const response=await fetch(root+path,{redirect:'error',signal:AbortSignal.timeout(12000)});
  const body=await response.json();
  if(!response.ok||!check(body))throw Error('Respuesta inesperada');
  console.log('OK',path,path==='/api/me'?(body.configured?'Dos cuentas configuradas':'Faltan crear las cuentas'):'Servidor disponible');
 } catch(error) {console.error('FALLO',path,error.message);process.exitCode=1;}
}
