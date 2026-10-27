// R0212-R0214/R0233: push con contenido cifrado (RFC 8291). Se descifra con la implementación de referencia
// independiente (http_ece, del autor del RFC), no con código propio.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { encryptPayload, validKeys } from '../edge/web-push.mjs';
const ece = createRequire(import.meta.url)('http_ece');

test('Push cifrado aes128gcm: el móvil (implementación de referencia) lo descifra exacto', async () => {
  const ua = createECDH('prime256v1'); ua.generateKeys();
  const auth = randomBytes(16);
  const keys = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  assert(validKeys(keys));
  const payload = JSON.stringify({ title: 'DUPLA · Angie', body: 'añadió una tarea «Confirmar hotel» · Viaje a Budapest', path: '/' });
  const body = Buffer.from(await encryptPayload(keys, payload));
  assert(!body.includes(Buffer.from('Confirmar hotel')), 'el texto nunca viaja en claro');
  const plain = ece.decrypt(body, { version: 'aes128gcm', privateKey: ua, authSecret: auth });
  assert.equal(plain.toString('utf8'), payload);
});

test('Claves de dispositivo inválidas: no se cifra con basura', () => {
  assert.equal(validKeys({ p256dh: 'abc', auth: 'x' }), false);
  assert.equal(validKeys(null), false);
});
