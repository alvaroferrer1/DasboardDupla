import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repeatRule } from '../edge/google-calendar.mjs';

const src=readFileSync(new URL('../edge/api.mjs',import.meta.url),'utf8'),i=src.indexOf('function nextOccurrence(');
const nextOccurrence=new Function(src.slice(i,src.indexOf('\n}',i)+2)+';return nextOccurrence;')();

test('Repeticiones de eventos del calendario (reglas de Google)', ()=>{
 assert.equal(repeatRule({repeat:'none',date:'2026-11-02'}),null);
 assert.equal(repeatRule({repeat:'weekly',date:'2026-11-09'}),'RRULE:FREQ=WEEKLY');
 assert.equal(repeatRule({repeat:'monthly_nth',date:'2026-11-02'}),'RRULE:FREQ=MONTHLY;BYDAY=1MO');
 assert.equal(repeatRule({repeat:'monthly_nth',date:'2026-11-27'}),'RRULE:FREQ=MONTHLY;BYDAY=-1FR');
 assert.equal(repeatRule({repeat:'weekly',date:'2026-11-09',repeat_until:'2026-12-31'}),'RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');
 assert.throws(()=>repeatRule({repeat:'raro',date:'2026-11-09'}));
});

test('Repeticiones de tareas: la siguiente fecha', ()=>{
 assert.equal(nextOccurrence('2030-12-02','monthly_nth'),'2031-01-06'); // 1.er lunes
 assert.equal(nextOccurrence('2030-11-29','monthly_nth'),'2030-12-27'); // último viernes
 assert.equal(nextOccurrence('2030-11-18','biweekly'),'2030-12-02');
 assert.equal(nextOccurrence('2030-11-15','weekdays'),'2030-11-18'); // viernes → lunes
 assert.equal(nextOccurrence('2030-12-24','yearly'),'2031-12-24');
 assert.equal(nextOccurrence('2030-11-30','monthly',30),'2030-12-30'); // la de siempre sigue igual
});
