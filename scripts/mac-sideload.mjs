#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

// Installs dist/manifest.xml into Word for Mac's sideload folder and can clear
// Word's disposable add-in caches. Only the add-in manifest is touched.
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'manifest.xml');
const args = new Set(process.argv.slice(2));
const manifestName = 'aetos-office-assistant.xml';

if (process.platform !== 'darwin') {
  console.error('This script is for macOS. On Windows use desktop/START_HERE.txt.');
  process.exit(1);
}

const wordApp = ['/Applications/Microsoft Word.app', join(homedir(), 'Applications/Microsoft Word.app')].find(existsSync);
const container = join(homedir(), 'Library', 'Containers', 'com.microsoft.Word');
const wef = join(container, 'Data', 'Documents', 'wef');
const target = join(wef, manifestName);

if (!existsSync(container)) {
  console.error('Word for Mac has not created its sandbox container yet.');
  console.error('Open Microsoft Word once, quit it completely (Cmd+Q), then run this command again.');
  process.exit(1);
}

if (args.has('--uninstall')) {
  try {
    await rm(target, { force: true });
    console.log(`Removed ${target} if it was present.`);
  } catch (error) { permissionHelp(error); }
  console.log('Quit and reopen Word to complete removal.');
  process.exit(0);
}

if (!existsSync(source)) {
  console.error('dist/manifest.xml is missing. Run: npm run build');
  process.exit(1);
}

const xml = await readFile(source, 'utf8');
const read = tag => new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`).exec(xml)?.[1] || 'unknown';
const sourceLocation = /<SourceLocation[^>]*DefaultValue="([^"]+)"/.exec(xml)?.[1] || 'unknown';
const version = read('Version');
const id = read('Id');

await mkdir(wef, { recursive: true }).catch(permissionHelp);
await copyFile(source, target).catch(permissionHelp);

if (args.has('--clear-cache')) {
  const caches = join(container, 'Data', 'Library', 'Caches');
  if (existsSync(caches)) {
    let removed = 0;
    try {
      for (const entry of await readdir(caches)) {
        await rm(join(caches, entry), { recursive: true, force: true });
        removed++;
      }
    } catch (error) { permissionHelp(error); }
    console.log(`Cleared ${removed} Word cache entr${removed === 1 ? 'y' : 'ies'}.`);
  }
}

console.log('AETOS Office Assistant is sideloaded for Word on macOS.');
console.log(`  manifest: ${target}`);
console.log(`  id:       ${id}`);
console.log(`  version:  ${version}`);
console.log(`  origin:   ${sourceLocation}`);
if (wordApp) console.log(`  Word:     ${wordApp}`);

if (args.has('--open')) {
  const opened = spawnSync('open', ['-a', 'Microsoft Word'], { stdio: 'inherit' });
  if (!opened.ok) console.error('Could not launch Word. Open it from Applications.');
} else {
  console.log('\nNext:');
  console.log('  1. Start the server in another terminal: npm start');
  console.log('  2. Fully quit Word (Cmd+Q) if it is open, then reopen it.');
  console.log('  3. Choose Insert > Add-ins (or My Add-ins) > AETOS Office Assistant.');
  console.log('If the add-in does not appear, run: npm run mac:sideload -- --clear-cache');
}

// macOS privacy protection can deny access to another app's sandbox container.
function permissionHelp(error) {
  if (!['EPERM', 'EACCES'].includes(error?.code)) {
    console.error(`Could not update Word's add-in manifest: ${error?.message || error}`);
    process.exit(1);
  }
  console.error('\nmacOS blocked access to Word\'s protected sandbox container.');
  console.error('Grant Full Disk Access to the terminal app running this command:');
  console.error('  System Settings > Privacy & Security > Full Disk Access');
  console.error('Enable Terminal (or iTerm/VS Code), quit and reopen it, then rerun:');
  console.error('  npm run mac:sideload');
  console.error('\nOr install the manifest manually in Finder:');
  console.error('  1. Choose Go > Go to Folder and open:');
  console.error('     ~/Library/Containers/com.microsoft.Word/Data/Documents');
  console.error('  2. Create a folder named wef if it does not exist.');
  console.error('  3. Copy dist/manifest.xml into wef as aetos-office-assistant.xml.');
  process.exit(1);
}
