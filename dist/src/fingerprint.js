import { SafeError } from './core.js?v=0.2.11';
import { canonicalXml, ignoredPart, parseXml } from './xml-fingerprint.js?v=0.2.11';
// Hash uncompressed OPC parts, not ZIP timestamps or compression metadata.
// Exclude volatile descriptive metadata only; retain all document content parts.
export async function fingerprint(zip, diagnosticParts = null) {
  const cap = 64 * 1024 * 1024;
  if (zip.length > cap) throw new SafeError('Document is too large for the local integrity check (64 MiB).');
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength), td = new TextDecoder();
  let end = zip.length - 22;
  while (end >= Math.max(0, zip.length - 65557) && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < Math.max(0, zip.length - 65557)) throw new SafeError('Could not inspect this document format.');
  const entries = v.getUint16(end + 10, true); let offset = v.getUint32(end + 16, true), total = 0; const parts = [], raw = new Map();
  if (entries === 65535 || v.getUint16(end + 4, true) !== 0) throw new SafeError('This document archive format is unsupported.');
  for (let n = 0; n < entries; n++) {
    if (v.getUint32(offset, true) !== 0x02014b50) throw new SafeError('Document archive is invalid.');
    const method = v.getUint16(offset + 10, true), size = v.getUint32(offset + 20, true), expanded = v.getUint32(offset + 24, true), length = v.getUint16(offset + 28, true), local = v.getUint32(offset + 42, true);
    const name = td.decode(zip.subarray(offset + 46, offset + 46 + length));
    offset += 46 + length + v.getUint16(offset + 30, true) + v.getUint16(offset + 32, true);
    if (ignoredPart(name) || name.endsWith('/')) continue;
    total += expanded; if (total > cap) throw new SafeError('Expanded document is too large for the local integrity check (64 MiB).');
    if (v.getUint32(local, true) !== 0x04034b50) throw new SafeError('Document archive is invalid.');
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    let data = zip.slice(start, start + size);
    if (method === 8) {
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = []; let actual = 0;
      try { while (true) { const r = await reader.read(); if (r.done) break; actual += r.value.length; if (actual > expanded || actual > cap) throw new SafeError('Expanded document exceeds its integrity-check limit.'); chunks.push(r.value); } }
      finally { await reader.cancel().catch(() => {}); }
      data = new Uint8Array(actual); let at = 0; for (const chunk of chunks) { data.set(chunk, at); at += chunk.length; }
    } else if (method !== 0) throw new SafeError('Document compression is unsupported.');
    if (data.length !== expanded) throw new SafeError('Document archive is incomplete.');
    if (raw.has(name)) throw new SafeError('Document archive contains duplicate parts.');
    raw.set(name, data);
  }
  // OPC content types identify UI metadata even when a producer uses another path.
  const excludedNames = new Set();
  const manifest = raw.get('[Content_Types].xml');
  if (manifest) {
    const root = parseXml(new TextDecoder('utf-8', { fatal: true }).decode(manifest));
    for (const node of root.children) {
      if (typeof node === 'string' || node.ns !== 'http://schemas.openxmlformats.org/package/2006/content-types' || node.local !== 'Override') continue;
      const attr = key => node.attrs.find(a => a[0] === '' && a[1] === key)?.[2] || '';
      if (['application/vnd.ms-office.webextension+xml', 'application/vnd.ms-office.webextensiontaskpanes+xml'].includes(attr('ContentType'))) {
        const name = attr('PartName').replace(/^\//, '');
        excludedNames.add(name);
        const slash = name.lastIndexOf('/');
        excludedNames.add(name.slice(0, slash + 1) + '_rels/' + name.slice(slash + 1) + '.rels');
      }
    }
  }
  const excluded = name => ignoredPart(name) || excludedNames.has(name);
  const extensions = new Set([...raw.keys()].filter(name => !excluded(name)).map(name => name.split('.').at(-1).toLowerCase()));
  for (let [name, data] of raw) {
    if (excluded(name)) continue;
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(data);
      const canonical = canonicalXml(xml, name, excluded, extensions);
      if (canonical === 'null') continue;
      diagnosticParts?.set(name, canonical);
      data = new TextEncoder().encode(canonical);
    }
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    parts.push([name, [...hash].map(x => x.toString(16).padStart(2, '0')).join('')]);
  }
  parts.sort((a, b) => a[0].localeCompare(b[0]));
  if (!parts.some(p => p[0] === 'word/document.xml')) throw new SafeError('A Word document is required.');
  return JSON.stringify(parts);
}

export function changeDetails(before, after, beforeParts, afterParts) {
  const a = new Map(JSON.parse(before)), b = new Map(JSON.parse(after)), lines = [];
  const safePart = name => /^(word\/(document|settings|fontTable|webSettings|people|footnotes|endnotes|styles|stylesWithEffects|numbering|header\d+|footer\d+|comments\w*)\.xml|word\/printerSettings\/printerSettings\d+\.bin|word\/theme\/theme\d+\.xml|\[Content_Types\]\.xml|_rels\/\.rels|word\/_rels\/document\.xml\.rels)$/.test(name);
  const safeTags = new Set('document body p r t fonts font embedRegular embedBold embedItalic embedBoldItalic fontKey embedSubset val id name settings webSettings optimizeForBrowser allowPNG doNotSaveAsSingleFile people person presenceInfo footnotes footnote endnotes endnote separator continuationSeparator numPr numId pPr rPr lang proofState rsids rsid compat compatSetting docId'.split(' '));
  const label = value => safeTags.has(value) ? value : 'element';
  function walk(x, y, path) {
    if (lines.length >= 60 || JSON.stringify(x) === JSON.stringify(y)) return;
    if (typeof x === 'string' || typeof y === 'string') { lines.push(`${path}: text changed (value omitted)`); return; }
    if (!x || !y || x[0] !== y[0] || x[1] !== y[1]) { lines.push(`${path}: element added, removed or replaced`); return; }
    if (JSON.stringify(x[2]) !== JSON.stringify(y[2])) {
      const oldAttrs = new Map(x[2].map(a => [JSON.stringify(a.slice(0,2)), a[2]]));
      const newAttrs = new Map(y[2].map(a => [JSON.stringify(a.slice(0,2)), a[2]]));
      const known = new Set('paraId textId rsidR rsidRPr rsidP rsidDel rsidRDefault id val type author date durableId'.split(' '));
      const names = [];
      for (const key of new Set([...oldAttrs.keys(), ...newAttrs.keys()])) {
        if (oldAttrs.get(key) === newAttrs.get(key)) continue;
        const [ns, local] = JSON.parse(key);
        const prefix = ns === 'http://schemas.microsoft.com/office/word/2010/wordml' ? 'w14' : ['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main'].includes(ns) ? 'w' : null;
        names.push(prefix && known.has(local) ? `${prefix}:${local}` : 'other attribute');
      }
      lines.push(`${path}: attributes changed (${[...new Set(names)].join(', ')}; values omitted)`);
    }
    for (let i = 0; i < Math.max(x[3].length, y[3].length) && lines.length < 60; i++) {
      const child = y[3][i] ?? x[3][i];
      walk(x[3][i], y[3][i], `${path}/${Array.isArray(child) ? label(child[1]) : 'text'}[${i}]`);
    }
  }
  let unknown = 0;
  for (const name of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(name) === b.get(name)) continue;
    const part = safePart(name) ? name : `unlisted ${/\.(xml|rels)$/i.test(name) ? 'XML' : 'binary'} part ${++unknown}`;
    lines.push(`${part}: ${!a.has(name) ? 'added' : !b.has(name) ? 'removed' : 'changed'}`);
    if (beforeParts.has(name) && afterParts.has(name)) walk(JSON.parse(beforeParts.get(name)), JSON.parse(afterParts.get(name)), part);
    if (lines.length >= 60) { lines.push('Further differences omitted.'); break; }
  }
  return lines.join('\n');
}

export function changedArea(before, after) {
  // Fixed categories only; never expose filenames, XML, document text or keys.
  const original = new Map(JSON.parse(before)), current = new Map(JSON.parse(after));
  const names = new Set([...original.keys(), ...current.keys()]);
  const labels = new Set();
  for (const name of names) if (original.get(name) !== current.get(name)) {
    labels.add(name === 'word/document.xml' ? 'document content' : name === 'word/settings.xml' ? 'document settings' : name === '[Content_Types].xml' ? 'package content types' : /\.rels$/i.test(name) ? 'package relationships' : /word\/(header|footer)/.test(name) ? 'headers or footers' : /word\/(styles|numbering|theme)/.test(name) ? 'formatting' : /webextensions/i.test(name) ? 'add-in metadata' : /comments/i.test(name) ? 'comments' : /^customXml\//.test(name) ? 'custom XML' : /\/media\//.test(name) ? 'images or media' : 'other document parts');
  }
  return [...labels].join(', ');
}
