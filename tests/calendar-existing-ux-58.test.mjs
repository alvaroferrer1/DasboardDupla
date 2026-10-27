import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../edge/public/app.js',import.meta.url),'utf8');
test('calendario existente es el flujo principal, sin crear otro por defecto',()=>{
 const attach=app.indexOf('id="shared-calendar-attach"');
 assert.ok(attach>0);
 // Solo el calendario conjunto que ya tenéis (indicado por el usuario el 2026-10-21): nunca se ofrece crear otro.
 assert.ok(!app.includes('id="shared-calendar-create"'));
 assert.match(app,/DUPLA no crea calendarios/);
 assert.match(app,/1c7cfd3eac8076266d57645e87107495f0025248d22d55d20752f7d81c3ba1d7@group\.calendar\.google\.com/);
 assert.match(app,/Vincular «DUPLA · Nuestro calendario»/);
});
test('sin lectura iCal ni calendarios personales: solo OAuth al calendario conjunto',()=>{
 assert.ok(!app.includes('/api/calendar/ical'));assert.ok(!app.includes('cal-ical-form'));
 assert.match(app,/data-action="google-start"/);assert.match(app,/alvarosferris@gmail\.com/);
});
