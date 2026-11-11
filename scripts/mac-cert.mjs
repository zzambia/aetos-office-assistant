#!/usr/bin/env node
// Creates a trusted localhost TLS certificate for Word on macOS.
// No npm dependencies. Uses mkcert when available, otherwise OpenSSL.
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.certs');
const certPath = join(dir, 'localhost-cert.pem');
const keyPath = join(dir, 'localhost-key.pem');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const noTrust = args.has('--no-trust');

const run = (cmd, argv, inherit = false) => {
  const result = spawnSync(cmd, argv, inherit ? { stdio: 'inherit' } : { encoding: 'utf8' });
  return { ok: result.status === 0 && !result.error, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
};
const exists = async path => { try { await access(path, constants.R_OK); return true; } catch { return false; } };
const openssl = (await exists('/usr/bin/openssl')) ? '/usr/bin/openssl' : 'openssl';

if (process.platform !== 'darwin') {
  console.error('This script is for macOS. On Windows use desktop/START_HERE.txt; on Linux create a trusted localhost certificate yourself.');
  process.exit(1);
}

await mkdir(dir, { recursive: true });

if (!force && await exists(certPath) && await exists(keyPath)) {
  const check = run(openssl, ['x509', '-in', certPath, '-noout', '-checkend', '604800']);
  if (check.ok) {
    console.log('Using the existing localhost certificate in .certs/ (valid for at least 7 more days).');
    if (noTrust) console.log('Skipping trust because --no-trust was passed.');
    else if (isTrusted()) printReady();
    else trust();
  } else {
    console.log('The existing certificate is expiring or unreadable; replacing it.');
    await regenerate();
  }
} else {
  await regenerate();
}

function isTrusted() {
  return run('security', ['verify-cert', '-c', certPath, '-p', 'ssl', '-s', 'localhost']).ok;
}

function printReady() {
  console.log('Trusted localhost certificate ready.');
  console.log(`  certificate: ${certPath}`);
  console.log(`  private key: ${keyPath}`);
  console.log('Quit and reopen Word after starting the server so WKWebView picks up the trust change.');
}

async function regenerate() {
  const mkcert = run('mkcert', ['-version']);
  if (mkcert.ok) {
    console.log('mkcert found; creating a locally trusted certificate.');
    if (!run('mkcert', ['-install'], true).ok) {
      console.error('mkcert -install failed. Fix the error above, then run: npm run mac:cert -- --force');
      process.exit(1);
    }
    const made = run('mkcert', ['-cert-file', certPath, '-key-file', keyPath, 'localhost', '127.0.0.1', '::1'], true);
    if (!made.ok) { console.error('mkcert could not create the certificate.'); process.exit(1); }
  } else {
    console.log('mkcert not found; creating a self-signed certificate with OpenSSL.');
    const configPath = join(dir, 'openssl.cnf');
    await writeFile(configPath, `[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3_req

[dn]
CN = localhost
O  = AETOS Office Assistant local development

[v3_req]
basicConstraints = critical, CA:TRUE
keyUsage         = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage = serverAuth
subjectAltName   = @alt_names

[alt_names]
DNS.1 = localhost
IP.1  = 127.0.0.1
IP.2  = ::1
`);
    const made = run(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '825', '-nodes',
      '-keyout', keyPath, '-out', certPath, '-config', configPath, '-extensions', 'v3_req']);
    if (!made.ok) {
      console.error(made.stderr || 'OpenSSL could not create the certificate.');
      process.exit(1);
    }
    await chmod(keyPath, 0o600);
  }

  if (noTrust) {
    console.log(`Certificate written to ${certPath}`);
    console.log('Skipping trust because --no-trust was passed.');
    return;
  }
  // mkcert already trusted its root CA, so only add an explicit trust entry if
  // the certificate still does not verify.
  if (isTrusted()) printReady();
  else trust();
}

function trust() {
  const keychain = run('security', ['default-keychain', '-d']).stdout.trim().replace(/^"|"$/g, '');
  const target = keychain || join(process.env.HOME || '', 'Library/Keychains/login.keychain-db');
  console.log(`Trusting the certificate for the current user in ${target}`);
  const added = run('security', ['add-trusted-cert', '-r', 'trustRoot', '-k', target, certPath], true);
  if (!added.ok) {
    console.error('\nCould not add the certificate to the login keychain trust settings.');
    console.error('If macOS denied authorization, run this instead and enter your password:');
    console.error(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
    console.error('Then run: npm run mac:doctor');
    process.exit(1);
  }
  const verified = run('security', ['verify-cert', '-c', certPath, '-p', 'ssl', '-s', 'localhost']);
  if (!verified.ok) {
    console.error('The certificate was imported but could not be verified for localhost.');
    console.error(verified.stderr.trim() || 'Run: npm run mac:doctor');
    process.exit(1);
  }
  printReady();
}
