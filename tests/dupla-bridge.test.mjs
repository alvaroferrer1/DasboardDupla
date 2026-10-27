import test from 'node:test';
import assert from 'node:assert/strict';
import { toGoogleEvent } from '../edge/google-calendar.mjs';
import { decodeServerFrames } from '../scripts/websocket-verify.mjs';

test('Agenda: las fechas y cambios de mes al exportar a Google conservan el día correcto',()=>{
 const midnight=toGoogleEvent({title:'Vuelo temprano',event_date:'2026-12-14',event_time:'23:30'});
 assert.equal(midnight.start.dateTime,'2026-12-14T23:30:00');
 assert.equal(midnight.end.dateTime,'2026-12-15T00:30:00');
 assert.equal(midnight.start.timeZone,'Europe/Madrid');
 const day=toGoogleEvent({title:'Año nuevo',event_date:'2026-12-31'});
 assert.equal(day.start.date,'2026-12-31');assert.equal(day.end.date,'2027-01-01');
 for(const d of ['2026-02-30','2026-13-10','2026-03-30HACK','2026-04-31'])assert.throws(()=>toGoogleEvent({title:'Inválido',event_date:d}),/Fecha/);
 for(const t of ['24:12','12:99','12:00:00'])assert.throws(()=>toGoogleEvent({title:'Inválido',event_date:'2026-11-11',event_time:t}),/Hora/);
});

test('WebSocket: traduce tramas parciales y extendidas sin confundir eventos',()=>{
 const data=Buffer.from(JSON.stringify({space:'work',projectId:'proyecto'}));
 const f=Buffer.concat([Buffer.from([0x81,data.length]),data]);
 assert.deepEqual(decodeServerFrames(f.subarray(0,3)).frames,[]);
 const decoded=decodeServerFrames(f);
 assert.deepEqual(decoded.frames,[data.toString()]);assert.equal(decoded.remainder.length,0);
 const extended=Buffer.from('v'.repeat(170));const ext=Buffer.alloc(4);ext[0]=0x81;ext[1]=126;ext.writeUInt16BE(extended.length,2);
 assert.equal(decodeServerFrames(Buffer.concat([ext,extended])).frames[0].length,170);
 assert.throws(()=>decodeServerFrames(Buffer.from([0x81,0x80])),/enmascarada/);
});
