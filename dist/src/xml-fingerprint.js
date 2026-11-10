import { SafeError } from './core.js?v=0.2.9';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WS = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const XML = 'http://www.w3.org/XML/1998/namespace';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
export const ignoredPart = name => /^(docProps|(?:word\/)?webextensions)\//i.test(name);
function resolveTarget(partName, target) {
  const owner = partName === '_rels/.rels' ? '' : partName.replace(/_rels\/([^/]+)\.rels$/, '$1');
  const base = owner.includes('/') ? owner.slice(0, owner.lastIndexOf('/') + 1) : '';
  const segments = [];
  for (const segment of (target.startsWith('/') ? target.slice(1) : base + target).split('/')) {
    if (segment === '..') segments.pop(); else if (segment && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}
const word = ns => ns === W || ns === WS;
const fail = () => { throw new SafeError('The document XML could not be checked safely.'); };
const entity = value => value.replace(/&([^;]+);/g, (_, name) => {
  const fixed = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  if (Object.hasOwn(fixed, name)) return fixed[name];
  if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(name)) return fail();
  const n = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  if (n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return fail();
  return String.fromCodePoint(n);
});

// A bounded, non-executing XML reader for Office-generated parts. DTDs and custom
// entities are refused. Prefix/attribute order and XML serialization are not content.
export function parseXml(xml) {
  xml = xml.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
  const root = { ns: '', local: '', attrs: [], children: [], scope: { xml: XML } }, stack = [root];
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^<>"']*(?:"[^"]*"[^<>"']*|'[^']*'[^<>"']*)*>|[^<]+/g;
  let end = 0, nodes = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== end || ++nodes > 1000000 || stack.length > 256) fail();
    const token = match[0]; end += token.length; const parent = stack.at(-1);
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { parent.children.push(token.slice(9, -3)); continue; }
    if (!token.startsWith('<')) { parent.children.push(entity(token)); continue; }
    if (token.startsWith('<!')) fail();
    if (token.startsWith('</')) { if (stack.length === 1 || token.slice(2, -1).trim() !== parent.qname) fail(); stack.pop(); continue; }
    const tag = /^<([\w:.-]+)([\s\S]*?)(\/?)>$/.exec(token); if (!tag) fail();
    const scope = { ...parent.scope }, rawAttrs = [], rest = tag[2];
    const attribute = /\s+([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let attrEnd = 0;
    for (const m of rest.matchAll(attribute)) { if (m.index !== attrEnd) fail(); attrEnd = m.index + m[0].length; const value = entity((m[2] ?? m[3]).replace(/[\t\n]/g, ' ')); if (m[1] === 'xmlns') scope[''] = value; else if (m[1].startsWith('xmlns:')) scope[m[1].slice(6)] = value; else rawAttrs.push([m[1], value]); }
    if (rest.slice(attrEnd).trim()) fail();
    const expand = (name, isAttr = false) => { const i = name.indexOf(':'); if (i < 0) return [isAttr ? '' : scope[''] || '', name]; const ns = scope[name.slice(0, i)]; if (!ns) return fail(); return [ns, name.slice(i + 1)]; };
    const [ns, local] = expand(tag[1]); const attrs = rawAttrs.map(([name, value]) => [...expand(name, true), value]);
    if (new Set(attrs.map(a => a[0] + '|' + a[1])).size !== attrs.length) fail();
    const node = { ns, local, attrs, children: [], scope, qname: tag[1] }; parent.children.push(node);
    if (!tag[3]) stack.push(node);
  }
  if (end !== xml.length || stack.length !== 1 || root.children.filter(n => typeof n !== 'string').length !== 1 || root.children.some(n => typeof n === 'string' && n.trim())) fail();
  return root.children.find(n => typeof n !== 'string');
}

export function canonicalXml(xml, partName, excluded = ignoredPart, retainedExtensions = null) {
  const root = parseXml(xml), goBack = new Set();
  const attr = (node, ns, name) => node.attrs.find(a => a[0] === ns && a[1] === name)?.[2];
  function scan(node) {
    if (typeof node === 'string') return;
    if (word(node.ns) && node.local === 'bookmarkStart' && attr(node, node.ns, 'name') === '_GoBack') goBack.add(attr(node, node.ns, 'id'));
    node.children.forEach(scan);
  }
  scan(root);
  function normalize(node, preserve = false) {
    if (typeof node === 'string') return preserve || node.trim() ? node : null;
    const isWord = word(node.ns), settings = partName === 'word/settings.xml';
    if (node.ns === REL && node.local === 'Relationship' && attr(node, '', 'TargetMode') !== 'External' && excluded(resolveTarget(partName, attr(node, '', 'Target') || ''))) return null;
    if (node.ns === CT && node.local === 'Override' && excluded((attr(node, '', 'PartName') || '').replace(/^\//, ''))) return null;
    if (node.ns === CT && node.local === 'Default' && retainedExtensions && !retainedExtensions.has((attr(node, '', 'Extension') || '').toLowerCase())) return null;
    // Generated proofing/layout/session state is not a user edit. Never omit
    // documentProtection, trackRevisions, formatting, revisions or ordinary bookmarks.
    if (isWord && ['proofErr', 'lastRenderedPageBreak'].includes(node.local)) return null;
    if (settings && isWord && ['rsids', 'proofState', 'zoom', 'view'].includes(node.local)) return null;
    if (settings && /^http:\/\/schemas\.microsoft\.com\/office\/word\/\d{4}\/wordml$/.test(node.ns) && node.local === 'docId') return null;
    if (isWord && ['bookmarkStart', 'bookmarkEnd'].includes(node.local) && goBack.has(attr(node, node.ns, 'id'))) return null;
    // Package-root relationship IDs have no referencing XML owner; serializers
    // may renumber them when adding UI metadata. Preserve Type/Target/TargetMode.
    const notePart = partName === 'word/footnotes.xml' || partName === 'word/endnotes.xml';
    // Word's paragraph identity/version stamps are not the note's content or
    // reference ID. Compare the actual text/formatting instead. Keep w:id.
    const attrs = node.attrs.filter(a => !(word(a[0]) && /^rsid/.test(a[1])) && !(notePart && isWord && a[0] === W14 && ['paraId', 'textId'].includes(a[1])) && !(partName === '_rels/.rels' && node.ns === REL && node.local === 'Relationship' && a[0] === '' && a[1] === 'Id'));
    attrs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const keepSpace = attr(node, XML, 'space') === 'preserve' || (attr(node, XML, 'space') !== 'default' && preserve) || (isWord && ['t', 'delText', 'instrText', 'delInstrText'].includes(node.local)) || (node.ns.includes('drawingml') && node.local === 't') || (!isWord && node.children.every(c => typeof c === 'string'));
    const children = [];
    for (const child of node.children) {
      const item = normalize(child, keepSpace); if (item == null) continue;
      if (typeof item === 'string' && typeof children.at(-1) === 'string') children[children.length - 1] += item; else children.push(item);
    }
    if (isWord && node.local === 'r' && !attrs.length && !children.length) return null;
    if ((node.ns === REL && node.local === 'Relationships') || (node.ns === CT && node.local === 'Types')) children.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (node.ns === REL && node.local === 'Relationships' && !children.length) return null;
    return [node.ns, node.local, attrs, children];
  }
  return JSON.stringify(normalize(root));
}

// getOoxml returns a Flat OPC package. Only the main document body describes
// the selection; headers, glossary entries and other supporting parts do not.
export function selectionTags(xml) {
  const PKG = 'http://schemas.microsoft.com/office/2006/xmlPackage';
  const root = parseXml(`<selection xmlns:w="${W}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:x="urn:selection-fragment">${xml}</selection>`);
  const elements = node => node.children.filter(c => typeof c !== 'string');
  const packages = elements(root).filter(n => n.ns === PKG && n.local === 'package');
  let selected = root;
  if (packages.length) {
    if (packages.length !== 1) fail();
    const parts = elements(packages[0]).filter(n => n.ns === PKG && n.local === 'part' && n.attrs.some(a => a[0] === PKG && a[1] === 'name' && a[2] === '/word/document.xml'));
    if (parts.length !== 1) fail();
    const data = elements(parts[0]).find(n => n.ns === PKG && n.local === 'xmlData');
    const document = data && elements(data).find(n => word(n.ns) && n.local === 'document');
    selected = document && elements(document).find(n => word(n.ns) && n.local === 'body');
    if (!selected) fail();
  }
  const tags = [];
  function visit(node) { tags.push(node.local); elements(node).forEach(visit); }
  visit(selected);
  return tags;
}
