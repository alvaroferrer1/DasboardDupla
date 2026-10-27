// Helpers shared by the Cloudflare worker and isolated Node tests.
export function validateWebhookUrl(value){
 if(typeof value!=='string'||value.length>2000)throw Error('URL de webhook inválida');
 let url;try{url=new URL(value);}catch{throw Error('URL de webhook inválida');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||!host||url.username||url.password||url.port&&url.port!=='443'||url.hash||
    host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||
    /^[0-9.]+$/.test(host)||host.startsWith('[')||host==='0'||host==='metadata.google.internal'){
  throw Error('La URL del webhook debe ser HTTPS pública');
 }
 return url.toString();
}
export function extractTasksFromAI(content){
 let cleaned=String(content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
 let value;
 try{value=JSON.parse(cleaned);}catch{return [];}
 const source=Array.isArray(value)?value:value?.tasks;
 if(!Array.isArray(source)||source.length<1||source.length>12)return [];
 const tasks=[];
 for(const raw of source){
  if(!raw||typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>220)return [];
  if(raw.description!==undefined&&typeof raw.description!=='string')return [];
  const description=String(raw.description||'').trim();
  if(description.length>1500)return [];
  const priority=['low','normal','high'].includes(raw.priority)?raw.priority:'normal';
  tasks.push({title:raw.title.trim(),description,priority});
 }
 return tasks;
}
