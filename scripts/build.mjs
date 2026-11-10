import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { VERSION } from '../src/version.js';

const out = new URL('../dist/', import.meta.url); await mkdir(out, { recursive: true });
for (const path of ['index.html', 'help.html', 'src', 'assets']) await cp(new URL(`../${path}`, import.meta.url), new URL(path, out), { recursive: true });
// Give every module a build-specific URL, including transitive imports.
for (const file of await readdir(new URL('src/', out))) {
  if (!file.endsWith('.js')) continue;
  const path = new URL(`src/${file}`, out);
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/(from\s+['"])(\.\/[^'"?]+\.js)(['"])/g, `$1$2?v=${VERSION}$3`));
}
const index = new URL('index.html', out);
await writeFile(index, (await readFile(index, 'utf8')).replace('./src/app.js', `./src/app.js?v=${VERSION}`).replace('./src/style.css', `./src/style.css?v=${VERSION}`));
const origin = process.env.AETOS_ORIGIN || 'https://localhost:3000';
const url = new URL(origin); if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw Error('AETOS_ORIGIN must be an HTTPS origin.');
const manifest = (await readFile(new URL('../manifest.xml', import.meta.url), 'utf8')).replaceAll('https://localhost:3000', url.origin.replaceAll('&', '&amp;'));
await writeFile(new URL('manifest.xml', out), manifest);
console.log(`Built AETOS Office Assistant for ${url.origin}`);
