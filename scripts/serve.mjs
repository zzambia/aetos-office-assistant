import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist'), port = Number(process.env.PORT || 3000);
if (!process.env.AETOS_TLS_CERT || !process.env.AETOS_TLS_KEY) { console.error('Set AETOS_TLS_CERT and AETOS_TLS_KEY to a trusted localhost TLS certificate and private key. See README.md.'); process.exit(1); }
const options = { cert: await readFile(process.env.AETOS_TLS_CERT), key: await readFile(process.env.AETOS_TLS_KEY) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.xml': 'application/xml' };
https.createServer(options, async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'https://localhost').pathname), file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !['GET','HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self'; img-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'none'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`AETOS Office Assistant: https://localhost:${port}`));
