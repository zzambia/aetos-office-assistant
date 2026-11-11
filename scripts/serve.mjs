import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve('dist'), port = Number(process.env.PORT || 3000);
const certPath = resolve(process.env.AETOS_TLS_CERT || '.certs/localhost-cert.pem');
const keyPath = resolve(process.env.AETOS_TLS_KEY || '.certs/localhost-key.pem');
if (!existsSync(certPath) || !existsSync(keyPath)) {
  console.error('Set AETOS_TLS_CERT and AETOS_TLS_KEY to a trusted localhost TLS certificate and private key.');
  if (process.platform === 'darwin') console.error('On macOS, create a trusted certificate with: npm run mac:cert');
  console.error('See README.md and docs/MAC.md.');
  process.exit(1);
}
const options = await Promise.all([readFile(certPath), readFile(keyPath)])
  .then(([cert, key]) => ({ cert, key }))
  .catch(error => {
    console.error(`Could not read the TLS certificate or key: ${error.message}`);
    process.exit(1);
  });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml' };
async function handler(req, res) {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname), file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !['GET','HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self'; img-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404).end('Not found'); }
}
function listen(server, host) {
  return new Promise((resolveListen, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolveListen(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
// Word on macOS may resolve localhost to ::1 first, so listen on both loopback
// addresses. Neither listener accepts traffic from another machine.
const servers = [https.createServer(options, handler), https.createServer(options, handler)];
await listen(servers[0], '127.0.0.1');
try { await listen(servers[1], '::1'); }
catch (error) {
  if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT'].includes(error.code)) throw error;
  servers[1].close();
  console.warn('IPv6 loopback is unavailable; serving IPv4 loopback only.');
}
console.log(`AETOS Office Assistant: https://localhost:${port}`);
console.log(`Serving ${root} on loopback only. Keep this running while Word uses the add-in.`);
