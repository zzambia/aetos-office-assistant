#!/usr/bin/env node
// Read-only readiness check for running AETOS Office Assistant in Word on macOS.
import { access, readFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:tls';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const certPath = join(root, '.certs', 'localhost-cert.pem');
const keyPath = join(root, '.certs', 'localhost-key.pem');
const container = join(homedir(), 'Library', 'Containers', 'com.microsoft.Word');
const wef = join(container, 'Data', 'Documents', 'wef');
const manifestPath = join(wef, 'aetos-office-assistant.xml');
const run = (cmd, argv) => {
  const result = spawnSync(cmd, argv, { encoding: 'utf8' });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
};
const exists = async path => { try { await access(path, constants.R_OK); return true; } catch { return false; } };
const accessState = async path => { try { await access(path, constants.R_OK); return 'ok'; } catch (error) { return error.code || 'error'; } };
const openssl = (await exists('/usr/bin/openssl')) ? '/usr/bin/openssl' : 'openssl';
let failures = 0;
const ok = text => console.log(`  ✓ ${text}`);
const fail = text => { failures++; console.log(`  ✗ ${text}`); };

console.log('AETOS Office Assistant — macOS host check\n');

if (process.platform === 'darwin') ok(`macOS ${run('sw_vers', ['-productVersion']).stdout.trim()}`);
else fail('This check is only meaningful on macOS.');

const major = Number(process.versions.node.split('.')[0]);
if (major >= 22) ok(`Node.js ${process.versions.node}`); else fail(`Node.js ${process.versions.node} is too old; use 22 or later.`);

if (['/Applications/Microsoft Word.app', join(homedir(), 'Applications/Microsoft Word.app')].some(existsSync)) ok('Microsoft Word is installed.');
else fail('Microsoft Word was not found in /Applications.');

if (existsSync(container)) ok('Word sandbox container exists.'); else fail('Open Word once and quit it (Cmd+Q) before sideloading.');

let origin = 'https://localhost:3000';
const wefAccess = await accessState(wef);
const manifestAccess = wefAccess === 'ok' ? await accessState(manifestPath) : wefAccess;
if (manifestAccess === 'ok') {
  const xml = await readFile(manifestPath, 'utf8');
  origin = /<SourceLocation[^>]*DefaultValue="([^"]+)"/.exec(xml)?.[1] || origin;
  const version = /<Version>([^<]+)<\/Version>/.exec(xml)?.[1] || 'unknown';
  ok(`Manifest sideloaded for v${version} (${origin}).`);
} else if (['EPERM', 'EACCES'].includes(manifestAccess)) {
  fail('macOS denied access to Word\'s sideload folder. Grant Full Disk Access to your terminal, or copy the manifest in Finder (docs/MAC.md).');
} else fail('Manifest not sideloaded. Run: npm run mac:sideload');

let trusted = false;
if (await exists(certPath) && await exists(keyPath)) {
  const text = run(openssl, ['x509', '-in', certPath, '-noout', '-text']);
  const end = run(openssl, ['x509', '-in', certPath, '-noout', '-enddate']).stdout.match(/notAfter=(.+)/)?.[1];
  if (text.ok && /DNS:localhost/.test(text.stdout)) ok(`Certificate covers localhost${end ? ` (expires ${end.trim()})` : ''}.`);
  else fail('Certificate is missing the localhost name. Run: npm run mac:cert -- --force');
  const verified = run('security', ['verify-cert', '-c', certPath, '-p', 'ssl', '-s', 'localhost']);
  trusted = verified.ok;
  if (trusted) ok('Certificate is trusted for localhost by macOS.');
  else fail('Certificate is not trusted. Run: npm run mac:cert');
} else fail('No localhost certificate in .certs/. Run: npm run mac:cert');

if (existsSync(join(root, 'dist', 'index.html'))) ok('Built application exists in dist/.');
else fail('dist/ is missing. Run: npm run build');

let url;
try { url = new URL(origin); } catch { fail(`Manifest origin is not a valid URL: ${origin}`); }
if (url) {
  if (url.protocol === 'https:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) ok(`Origin ${url.origin} meets add-in HTTPS/loopback rules.`);
  else fail(`Origin ${url.origin} must be HTTPS on localhost.`);
  if (trusted && await exists(certPath) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    const status = await probe(Number(url.port || 443), await readFile(certPath));
    if (status.ok) ok(`Server is reachable at ${url.origin} (${status.detail}).`);
    else fail(`Server is not reachable at ${url.origin}: ${status.detail}. Start it with: npm start`);
  }
}

console.log('');
if (failures) {
  console.log(`${failures} check${failures === 1 ? '' : 's'} failed. See docs/MAC.md for the full setup.`);
  process.exit(1);
}
console.log('Ready. Start the server with: npm start');
console.log('Then fully quit and reopen Word, and open the add-in from Insert > Add-ins.');

function probe(port, ca) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port, ca, servername: 'localhost', timeout: 4000 }, () => {
      socket.write('GET /help.html HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    });
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => { data += chunk; });
    socket.on('end', () => resolve({ ok: /^HTTP\/1\.1 200/.test(data), detail: data.split('\r\n')[0] || 'no response' }));
    socket.on('error', error => resolve({ ok: false, detail: error.code || error.message }));
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, detail: 'timed out' }); });
  });
}
