// Ruta alternativa para publicar cuando el operador corta las IPs compartidas de Cloudflare.
// Proxy local CONNECT: solo deja pasar la web de DUPLA y la lleva a otra entrada de Cloudflare.
// No descifra nada: el TLS sigue siendo de extremo a extremo con el certificado real.
import { createServer, connect } from 'node:net';

const HOST = 'dos-espacios-compartido.dos-espacios-ferris.workers.dev';
const ENTRADAS = ['104.18.13.15', '104.18.21.135', '162.159.138.232'];
const PUERTO = Number(process.argv[2] || 8899);

const abrir = (i, ok, ko) => {
  if (i >= ENTRADAS.length) return ko();
  const s = connect({ host: ENTRADAS[i], port: 443, timeout: 6000 });
  s.once('connect', () => { s.setTimeout(0); s.removeAllListeners('error'); ok(s); });
  const sigue = () => { s.destroy(); abrir(i + 1, ok, ko); };
  s.once('error', sigue); s.once('timeout', sigue);
};

createServer(c => {
  c.on('error', () => {});
  c.once('data', d => {
    const [metodo, destino] = d.toString('latin1').split(' ');
    if (metodo !== 'CONNECT' || destino !== `${HOST}:443`) { c.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    abrir(0, s => {
      s.on('error', () => c.destroy());
      c.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      s.pipe(c); c.pipe(s);
    }, () => c.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
  });
}).listen(PUERTO, '127.0.0.1');

setTimeout(() => process.exit(0), 30 * 60 * 1000);
