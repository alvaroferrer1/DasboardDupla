// WSS verification against the actual Cloudflare Worker. Only accepts authenticated
// sessions and consumes server-originated frames. No project content or secrets logged.
import http from 'node:http';
import https from 'node:https';
import { randomBytes } from 'node:crypto';

export function decodeServerFrames(buffer){
 const frames=[];let offset=0;
 while(buffer.length-offset>=2){
  const first=buffer[offset],second=buffer[offset+1];
  let payloadLength=second&127,headerLength=2;
  if(second&128)throw Error('El servidor envió una trama enmascarada inválida');
  if(payloadLength===126){if(buffer.length-offset<4)break;payloadLength=buffer.readUInt16BE(offset+2);headerLength=4;}
  else if(payloadLength===127){if(buffer.length-offset<10)break;const n=buffer.readBigUInt64BE(offset+2);if(n>BigInt(1024*1024))throw Error('Trama WebSocket demasiado grande');payloadLength=Number(n);headerLength=10;}
  if(payloadLength>1024*1024)throw Error('Trama WebSocket demasiado grande');
  if(buffer.length-offset<headerLength+payloadLength)break;
  const opcode=first&15;const final=Boolean(first&128);
  if(opcode===1&&final)frames.push(Buffer.from(buffer.subarray(offset+headerLength,offset+headerLength+payloadLength)).toString('utf8'));
  else if(opcode===8)throw Error('El servidor cerró la conexión WebSocket');
  else if((opcode===0||opcode===2)&&!final)throw Error('Trama WebSocket fragmentada no soportada por esta prueba');
  offset+=headerLength+payloadLength;
 }
 return {frames,remainder:Buffer.from(buffer.subarray(offset))};
}

export async function openAuthenticatedSocket(origin,cookie,timeoutMs=18000){
 const base=new URL(origin);if(!['https:','http:'].includes(base.protocol)||base.pathname!=='/')throw Error('Origen inválido');
 const transport=base.protocol==='https:'?https:http;
 return new Promise((resolve,reject)=>{
  const request=transport.request(new URL('/api/ws',base),{method:'GET',headers:{
   'Origin':base.origin,'Cookie':cookie,'Connection':'Upgrade','Upgrade':'websocket',
   'Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')
  }});
  let settled=false;const fail=(error)=>{if(settled)return;settled=true;request.destroy();reject(error)};
  request.setTimeout(timeoutMs,()=>fail(Error('Timeout al abrir WebSocket')));
  request.on('error',fail);
  request.on('response',res=>{res.resume();fail(Error('WebSocket respondió HTTP '+res.statusCode+' en lugar de 101'))});
  request.on('upgrade',(response,socket,head)=>{
   if(settled){socket.destroy();return;}
   if(response.statusCode!==101){socket.destroy();return fail(Error('Handshake inválido'))}
   settled=true;let pending=Buffer.alloc(0),listener=null;
   let queued=[];let broken=null;
   function consume(data){
    try{pending=Buffer.concat([pending,data]);const result=decodeServerFrames(pending);pending=result.remainder;
     for(const raw of result.frames){let payload;try{payload=JSON.parse(raw)}catch{continue;}if(listener){const fn=listener;listener=null;fn.resolve(payload);}else queued.push(payload);}
    }catch(e){broken=e;if(listener){const fn=listener;listener=null;fn.reject(e)}socket.destroy();}
   }
   socket.on('data',consume);if(head?.length)consume(head);
   socket.on('error',e=>{broken=e;if(listener){const fn=listener;listener=null;fn.reject(e)}});
   socket.on('close',()=>{broken??=Error('El WebSocket se cerró');if(listener){const fn=listener;listener=null;fn.reject(broken)}});
   resolve({socket,async nextMessage(maxMs=timeoutMs){
    if(queued.length)return queued.shift();if(broken)throw broken;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{listener=null;reject(Error('No llegaron cambios por WebSocket'))},maxMs);
      listener={resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}};
    });
   },close(){socket.destroy()}});
  });
  request.end();
 });
}
