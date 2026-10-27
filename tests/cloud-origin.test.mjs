import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedSocketOrigin} from '../edge/origin.mjs';
function r(url,origin,site='same-origin'){
 const h=new Headers({'Sec-Fetch-Site':site});if(origin!==null)h.set('Origin',origin);
 return new Request(url,{headers:h});
}
test('WebSocket solamente desde el mismo origen HTTPS',()=>{
 const url='https://dos-espacios.ejemplo.workers.dev/api/ws';
 assert.equal(isAllowedSocketOrigin(r(url,'https://dos-espacios.ejemplo.workers.dev')),true);
 assert.equal(isAllowedSocketOrigin(r(url,'https://dos-espacios.ejemplo.workers.dev','cross-site')),false);
 assert.equal(isAllowedSocketOrigin(r(url,'https://web-maliciosa.example')),false);
 assert.equal(isAllowedSocketOrigin(r(url,'http://dos-espacios.ejemplo.workers.dev')),false);
 assert.equal(isAllowedSocketOrigin(r(url,null)),false);
 assert.equal(isAllowedSocketOrigin(r(url,'null')),false);
 assert.equal(isAllowedSocketOrigin(r('http://demo.unsafe.com/api/ws','http://demo.unsafe.com')),false);
 assert.equal(isAllowedSocketOrigin(r('http://localhost:8787/api/ws','http://localhost:8787')),true);
});
