// Development-only HTTP+SQLite test adapter. NOT a Cloudflare runtime substitute.
// Uses the production edge API with real SQLite on disk and serves unmodified browser assets.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createApi } from '../edge/api.mjs';
const filename=process.env.DUPLA_TEST_DB||':memory:';
const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');
const storage={sql:{exec(sql,...a){if(!a.length&&/;\s*\S/.test(sql.trim().replace(/;\s*$/,''))){db.exec(sql);return {toArray:()=>[],rowsWritten:0};}const stmt=db.prepare(sql),reader=/^\s*(SELECT|PRAGMA|WITH|EXPLAIN)\b/i.test(sql);const rows=reader?stmt.all(...a):[];const changes=reader?0:stmt.run(...a).changes;return {toArray:()=>rows,rowsWritten:changes};}},transactionSync(fn){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(ex){db.exec('ROLLBACK');throw ex;}}};
const testSockets=new Set();
const app=createApi(storage,{SETUP_TOKEN:'T'.repeat(64),DEV_MODE:'true',PUBLIC_ORIGIN:''},{getWebSockets:()=>Array.from(testSockets),waitUntil(){}});
const publicDir=new URL('../edge/public/',import.meta.url);
const types={'.css':'text/css','.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){if(url.pathname==='/api/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok'}));return;}if(url.pathname==='/api/ws'){res.writeHead(426);res.end('WebSocket test not supported in Node harness');return;}await app.api(req,res,url);return;}
  if(!['/','/index.html','/style.css','/app.js','/favicon.svg','/dupla-icon.svg','/dupla-horizontal.svg','/push-sw.js','/manifest.webmanifest','/dupla-icon-192.png','/dupla-icon-512.png','/vendor/jspdf.umd.min.js','/dupla-avatar.jpg','/dupla-agente.jpg'].includes(url.pathname)){res.writeHead(404);res.end();return;}
  const fname=url.pathname==='/'?'index.html':url.pathname.slice(1);
  const bytes=await readFile(new URL(fname,publicDir));res.writeHead(200,{'content-type':types[extname(fname)]||'application/octet-stream','cache-control':'no-store'});res.end(bytes);
 }catch(ex){console.error('Harness failure:',ex);if(!res.headersSent)res.writeHead(ex.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:ex.message}));}
});
// Exercise real WebSocket frames through Chromium on two isolated browser contexts.
// The production Cloudflare WebSocket runtime is NOT replaced by this test harness.
server.on('upgrade',(req,socket)=>{
 try{
  const origin=new URL(req.headers.origin||'http://invalid');
  if(new URL(req.url,'http://localhost').pathname!=='/api/ws'||origin.host!==req.headers.host || !['127.0.0.1','localhost'].includes(origin.hostname)) throw Error('Wrong origin/path');
  const user=app.userFromReq(req);
  if(!user||req.headers.upgrade?.toLowerCase()!=='websocket'||!req.headers['sec-websocket-key'])throw Error('Not authorized');
  const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const entry={deserializeAttachment:()=>({sessionHash:user.token_hash}),send(message){
   const data=Buffer.from(message,'utf8');let header;
   if(data.length<126)header=Buffer.from([0x81,data.length]);
   else if(data.length<65536){header=Buffer.alloc(4);header[0]=0x81;header[1]=126;header.writeUInt16BE(data.length,2);}
   else throw Error('Test frame too long');
   if(!socket.destroyed)socket.write(Buffer.concat([header,data]));
  },close(){socket.destroy();}};
  testSockets.add(entry);
  socket.on('close',()=>testSockets.delete(entry));socket.on('error',()=>testSockets.delete(entry));
 }catch{socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');}
});
server.listen(Number(process.env.PORT||39771),'127.0.0.1',()=>console.log('DUPLA_TEST_SERVER_READY',server.address().port));
process.on('SIGTERM',()=>server.close(()=>db.close()));
