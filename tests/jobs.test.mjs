import test from 'node:test';
import assert from 'node:assert/strict';
import { hourlyJobs, runHourlyJobs } from '../edge/jobs.mjs';

const app = () => { const hechos = []; return new Proxy({ hechos }, { get: (t, k) => k === 'hechos' ? t.hechos : async () => { hechos.push(k); if (k === 'processGuardianReview') throw Error('fallo simulado'); } }); };

test('Trabajos de cada hora: si uno falla, los demás se ejecutan igualmente', async () => {
 const a = app(), err = console.error; console.error = () => {};
 try { await runHourlyJobs(a, {}); } finally { console.error = err; }
 assert.ok(a.hechos.includes('processGuardianReview'));
 assert.ok(a.hechos.includes('flushPushNotices'), 'el último trabajo sigue corriendo tras el fallo');
});

test('Automatizaciones y webhooks solo corren si se activan a propósito', () => {
 const nombres = e => hourlyJobs(app(), e).map(([n]) => n);
 assert.ok(!nombres({}).includes('automations'));
 assert.ok(!nombres({}).includes('webhooks'));
 assert.ok(nombres({ DUPLA_AUTOMATIONS_ENABLED: 'true' }).includes('automations'));
});
