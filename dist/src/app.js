// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

/* global Office */
import { Connections, Session, SafeError, messages, bytes, suggestionLimit } from './core.js?v=0.2.12';
import { generate } from './transport.js?v=0.2.12';
import { WordHost } from './word.js?v=0.2.12';
import { VERSION } from './version.js?v=0.2.12';
const $ = id => document.getElementById(id), session = new Session();
function supportsRawDeflate() { try { new DecompressionStream('deflate-raw'); return true; } catch { return false; } }
$('build-version').textContent = `v${VERSION}`;
let connections, host, controller, preparing = false, applying = false, monitoring = false, ready = false, monitorPromise = Promise.resolve();
const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('error', error); };
const report = e => status(e instanceof SafeError ? e.message : 'This operation could not be completed. Check the connection or Word document and retry.', true);
function showDiagnostic(snapshot) {
  $('diagnostic-panel').hidden = !snapshot?.diagnostic;
  $('diagnostic-text').value = snapshot?.diagnostic || '';
}
$('diagnostic-copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('diagnostic-text').value); status('Diagnostic copied. Paste it into the support conversation.'); }
  catch { $('diagnostic-text').focus(); $('diagnostic-text').select(); status('Press Ctrl+C to copy the selected diagnostic.'); }
};
function controls() {
  const active = preparing || applying || session.state === 'generating';
  for (const id of ['mode', 'instructions', 'connection', 'settings-open']) $(id).disabled = active;
  $('generate').disabled = active || !ready;
  $('insert').disabled = $('replace').disabled = active || session.state !== 'complete' || !!session.context?.invalid || !session.text.trim();
  $('discard').disabled = applying || (session.state === 'idle' && !preparing);
  $('copy').disabled = !session.text;
  $('preview').readOnly = session.state !== 'complete' || active;
  $('count').textContent = `${(bytes(session.text) / 1024).toFixed(1)} / 64 KiB`;
  $('preview-label').textContent = session.state === 'generating' ? 'Generating…' : session.state === 'complete' ? 'Editable Markdown' : 'Markdown';
}
function renderConnections() {
  const override = $('connection').value;
  $('connection').replaceChildren(new Option('Default', ''));
  $('saved').replaceChildren(new Option('Add a connection', ''));
  for (const p of connections.items) { $('connection').add(new Option(p.name, p.id)); $('saved').add(new Option(`${p.name}${p.id === connections.defaultId ? ' (default)' : ''}`, p.id)); }
  $('connection').value = connections.items.some(p => p.id === override) ? override : '';
  modelLabel();
}
function modelLabel() { $('model-label').textContent = `Model — ${$('connection').selectedOptions[0]?.textContent || 'Default'}`; }
function loadProfile() {
  const p = connections.items.find(p => p.id === $('saved').value);
  for (const key of ['name', 'endpoint', 'model', 'key']) $(key).value = p?.[key] || '';
  $('default').checked = !!p && p.id === connections.defaultId;
  $('delete').disabled = !p;
}
async function discard() { const old = session.context; controller?.abort(); session.discard(); $('preview').value = ''; controls(); await host?.release(old); }
$('settings-open').onclick = () => { $('writer').hidden = true; $('settings').hidden = false; $('settings-back').focus(); };
$('settings-back').onclick = () => { $('settings').hidden = true; $('writer').hidden = false; $('settings-open').focus(); };
$('saved').onchange = loadProfile; $('connection').onchange = modelLabel;
$('profile-form').onsubmit = e => {
  e.preventDefault();
  try {
    const p = connections.save({ id: $('saved').value || undefined, name: $('name').value, endpoint: $('endpoint').value, model: $('model').value, key: $('key').value }, $('default').checked);
    renderConnections(); $('saved').value = p.id; loadProfile(); status('Connection saved locally.');
  } catch (err) { report(err); }
};
$('delete').onclick = () => { try { connections.remove($('saved').value); renderConnections(); loadProfile(); status('Connection removed.'); } catch (e) { report(e); } };
$('mode').onchange = () => { $('instruction-hint').textContent = $('mode').value === 'draft' ? 'Required for Draft' : 'Optional'; };
$('generate').onclick = async () => {
  if (preparing || applying || session.state === 'generating') return;
  let snapshot, id;
  try {
    const connection = connections.resolve($('connection').value), mode = $('mode').value, instructions = $('instructions').value;
    preparing = true; showDiagnostic(null);
    const previous = session.context; controller?.abort(); session.discard(); $('preview').value = '';
    const preparation = session.sequence; controls(); status('Checking the Word selection…');
    await monitorPromise; await host.release(previous);
    if (preparation !== session.sequence) return;
    snapshot = await host.prepare();
    showDiagnostic(snapshot);
    if (preparation !== session.sequence) { await host.release(snapshot); return; }
    const payload = messages(mode, instructions, snapshot.source);
    id = session.start(snapshot); preparing = false; controller = new AbortController(); controls(); status('Generating. Your document is unchanged.');
    const result = await generate(connection, payload, { signal: controller.signal, onText: text => {
      if (id !== session.sequence) return;
      const preview = $('preview'), following = preview.scrollHeight - preview.scrollTop - preview.clientHeight < 30;
      session.append(id, text); preview.value = text; if (following) preview.scrollTop = preview.scrollHeight; controls();
    } });
    if (session.finish(id, result)) { $('preview').value = result; status(snapshot.notice || 'Ready to review. Edit the Markdown, then choose how to apply it.', !!snapshot.invalid); }
  } catch (e) {
    if (id !== undefined && id === session.sequence) { session.fail(id); report(e); }
    else if (id === undefined) { await host?.release(snapshot); report(e); }
  } finally { preparing = false; controls(); }
};
$('preview').oninput = () => { session.text = $('preview').value; try { suggestionLimit(session.text); status('Edited suggestion ready for review.'); } catch (e) { report(e); } controls(); };
for (const [id, action] of [['insert', 'after'], ['replace', 'replace']]) $(id).onclick = async () => {
  if (session.state !== 'complete' || applying) return;
  applying = true; controls();
  try {
    suggestionLimit(session.text); status('Verifying the document before applying…');
    await monitorPromise; await host.apply(session.context, session.text, action); await discard(); status('Suggestion applied. Use Word’s Undo to undo the edit.');
  } catch (e) {
    // Never retry an uncertain host mutation automatically, or allow a duplicate apply.
    if (e.uncertain) session.state = 'failed'; report(e);
  } finally { applying = false; controls(); }
};
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(session.text); status('Markdown copied.'); } catch { status('Clipboard access was denied. Select the preview text and copy it using your keyboard.', true); } };
$('discard').onclick = async () => { await discard(); status('Suggestion discarded. Content already sent to the provider cannot be recalled.'); };
window.addEventListener('pagehide', () => { controller?.abort(); session.discard(); });
async function monitor() {
  if (!host || !session.context || preparing || applying || monitoring || session.context.invalid) return;
  monitoring = true; const snapshot = session.context;
  try { await host.inspect(snapshot); }
  catch (e) { if (snapshot === session.context && snapshot.invalid) { status('The document changed. Generate again before applying.', true); controls(); } }
  finally { monitoring = false; }
}
async function boot() {
  try {
    connections = new Connections(localStorage); renderConnections(); controls();
    if (!window.Office) { status('Open this add-in in Microsoft Word to generate and apply suggestions. Connection settings are available here.', true); return; }
    const info = await Office.onReady();
    if (info.host !== Office.HostType.Word || !Office.context.requirements.isSetSupported('WordApi', '1.3') || !supportsRawDeflate() || !globalThis.crypto?.subtle) throw new SafeError('This add-in requires WordApi 1.3 and a modern WebView with raw-deflate decompression and Web Crypto. Update Word and macOS/Windows, then reopen the add-in.');
    host = new WordHost(); ready = true; controls(); status('Ready. Place the cursor or select text in Word.');
    setInterval(() => { if (!monitoring) monitorPromise = monitor(); }, 3000);
  } catch (e) { report(e); $('settings-open').disabled = !connections; }
}
boot();
