import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalXml } from '../src/xml-fingerprint.js';
import { fingerprint, changedArea } from '../src/fingerprint.js';
import { zipFixture } from './zip-fixture.mjs';
const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const doc = s => `<w:document xmlns:w="${ns}"><w:body>${s}</w:body></w:document>`;
const hash = xml => canonicalXml(xml,'word/document.xml');
test('XML syntax/prefix/attribute-order differences are not content changes',()=>{
  const a=`<w:p xmlns:w="${ns}" w:a="1" w:b="2"><w:r><w:t>A &amp; B</w:t></w:r></w:p>`;
  const b=`<?xml version="1.0"?><x:p xmlns:x="${ns}" x:b='2' x:a='1'>\n <x:r><x:t>A &#38; B</x:t></x:r>\n</x:p>`;
  assert.equal(hash(a),hash(b));
  assert.equal(hash(doc('<w:p/>')),hash(doc('<w:p></w:p>')));
});
test('revision session, proofing and cached pagination do not invalidate writing',()=>{
  const a=doc('<w:p w:rsidR="A"><w:proofErr w:type="spellStart"/><w:r><w:t>text</w:t></w:r><w:r><w:lastRenderedPageBreak/></w:r></w:p>');
  const b=doc('<w:p w:rsidR="B"><w:r><w:t>text</w:t></w:r></w:p>'); assert.equal(hash(a),hash(b));
});
test('volatile settings ignored; protection/tracking/layout settings preserved',()=>{
  const settings=s=>`<w:settings xmlns:w="${ns}">${s}</w:settings>`;
  const a=canonicalXml(settings('<w:rsids><w:rsidRoot w:val="123"/></w:rsids><w:proofState w:spelling="dirty"/><w:zoom w:percent="100"/><w:trackRevisions/>'),'word/settings.xml');
  const b=canonicalXml(settings('<w:zoom w:percent="125"/><w:trackRevisions/>'),'word/settings.xml');assert.equal(a,b);
  for(const extra of ['<w:documentProtection w:edit="readOnly"/>','<w:doNotTrackMoves/>','<w:doNotTrackFormatting/>','<w:defaultTabStop w:val="720"/>']) assert.notEqual(b,canonicalXml(settings('<w:trackRevisions/>'+extra),'word/settings.xml'));
  assert.notEqual(b,canonicalXml(settings(''),'word/settings.xml'));
});
test('only the internal GoBack bookmark is omitted; user bookmarks retained',()=>{
  assert.equal(hash(doc('<w:p><w:bookmarkStart w:id="1" w:name="_GoBack"/><w:r><w:t>x</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>')),hash(doc('<w:p><w:r><w:t>x</w:t></w:r></w:p>')));
  assert.notEqual(hash(doc('<w:p><w:bookmarkStart w:id="1" w:name="UserBookmark"/></w:p>')),hash(doc('<w:p/>')));
});
test('text, significant spaces, paragraph structure, formatting and revisions remain protected',()=>{
  const base=hash(doc('<w:p><w:r><w:t>text</w:t></w:r></w:p>'));
  for(const content of ['<w:p><w:r><w:t> text</w:t></w:r></w:p>','<w:p><w:r><w:t>edit</w:t></w:r></w:p>','<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>text</w:t></w:r></w:p>','<w:p><w:r><w:t>text</w:t></w:r></w:p><w:p/>','<w:p><w:del w:author="person"><w:r><w:delText>text</w:delText></w:r></w:del></w:p>']) assert.notEqual(base,hash(doc(content)));
  assert.notEqual(hash(doc('<w:p><w:r><w:t> </w:t></w:r></w:p>')),hash(doc('<w:p><w:r><w:t></w:t></w:r></w:p>')));
});
test('DTD, unknown entities, malformed XML and unbound prefixes fail closed',()=>{
  for(const xml of ['<!DOCTYPE d [<!ENTITY a SYSTEM "file:///secret">]><d>&a;</d>','<d>&unknown;</d>','<d><a></d>','<x:d/>','<d/><d/>','<d a="1" a="2"/>']) assert.throws(()=>hash(xml));
});
test('ZIP normalization tolerates harmless export churn and diagnostics reveal categories only',async()=>{
  const a=await fingerprint(zipFixture({'word/document.xml':doc('<w:p w:rsidR="1"/>')}));
  const b=await fingerprint(zipFixture({'word/document.xml':doc('<w:p w:rsidR="2"/>')},true));assert.equal(a,b);
  const c=await fingerprint(zipFixture({'word/document.xml':doc('<w:p><w:r><w:t>private words</w:t></w:r></w:p>')}));assert.equal(changedArea(a,c),'document content');assert.ok(!changedArea(a,c).includes('private'));
});

const relns = 'http://schemas.openxmlformats.org/package/2006/relationships';
const ctns = 'http://schemas.openxmlformats.org/package/2006/content-types';
const rels = items => `<Relationships xmlns="${relns}">${items}</Relationships>`;
const rel = (id, target, extra = '') => `<Relationship Id="${id}" Type="test" Target="${target}" ${extra}/>`;
const types = items => `<Types xmlns="${ctns}">${items}</Types>`;
const override = name => `<Override PartName="/${name}" ContentType="test"/>`;
test('add-in state addition, removal and changes do not invalidate the document through package references', async () => {
  const base = {
    'word/document.xml': doc('<w:p/>'),
    '_rels/.rels': rels(rel('doc', 'word/document.xml')),
    '[Content_Types].xml': types(override('word/document.xml')),
  };
  const withPane = {
    ...base,
    '_rels/.rels': rels(rel('pane', 'word/webextensions/taskpanes.xml') + rel('props', 'docProps/core.xml') + rel('doc', 'word/document.xml')),
    '[Content_Types].xml': types(override('docProps/core.xml') + override('word/webextensions/taskpanes.xml') + override('word/document.xml')),
    'word/_rels/document.xml.rels': rels(rel('pane', './webextensions/taskpanes.xml')),
    'word/webextensions/taskpanes.xml': '<state selected="1"/>',
    'word/webextensions/webextension1.xml': '<addin nonce="123"/>',
    'word/webextensions/_rels/taskpanes.xml.rels': rels(rel('x', 'webextension1.xml')),
    'docProps/core.xml': '<props/>',
  };
  const expected = await fingerprint(zipFixture(base));
  assert.equal(expected, await fingerprint(zipFixture(withPane, true)));
  withPane['word/webextensions/webextension1.xml'] = '<addin nonce="456"/>';
  assert.equal(expected, await fingerprint(zipFixture(withPane)));
});
test('relationship order is irrelevant but hyperlink and image targets remain protected', async () => {
  const parts = link => ({'word/document.xml': doc('<w:p/>'), 'word/_rels/document.xml.rels': rels(link)});
  const a = rel('link', 'https://example.com', 'TargetMode="External"'), b = rel('image', 'media/image1.png');
  const expected = await fingerprint(zipFixture(parts(a + b)));
  assert.equal(expected, await fingerprint(zipFixture(parts(b + a))));
  assert.notEqual(expected, await fingerprint(zipFixture(parts(a.replace('example.com', 'example.org') + b))));
  assert.notEqual(expected, await fingerprint(zipFixture(parts(a + b.replace('image1', 'image2')))));
  assert.notEqual(expected, await fingerprint(zipFixture(parts(a + b + rel('external', 'word/webextensions/foo', 'TargetMode="External"')))));
});
test('comments, custom XML, media and unknown parts are still checked', async () => {
  const base = {'word/document.xml': doc('<w:p/>')};
  const expected = await fingerprint(zipFixture(base));
  for (const [name, content] of Object.entries({'word/comments.xml':'<comment>edit</comment>', 'customXml/item1.xml':'<data>edit</data>', 'word/media/image.png':'changed image', 'word/unknown.xml':'<edit/>'})) {
    assert.notEqual(expected, await fingerprint(zipFixture({...base, [name]:content})));
  }
});

test('metadata is recognized by content type outside the conventional folder; unused thumbnail defaults are ignored', async () => {
  const base = {'word/document.xml':doc('<w:p/>'), '[Content_Types].xml':types(override('word/document.xml')), '_rels/.rels':rels(rel('doc','word/document.xml'))};
  const changed = {...base,
    '[Content_Types].xml':types(override('word/document.xml') + '<Override PartName="/session/pane.xml" ContentType="application/vnd.ms-office.webextensiontaskpanes+xml"/><Override PartName="/session/app.xml" ContentType="application/vnd.ms-office.webextension+xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>'),
    '_rels/.rels':rels(rel('doc','word/document.xml') + rel('pane','session/pane.xml')),
    'session/pane.xml':'<pane width="250"/>', 'session/app.xml':'<app id="random"/>',
    'session/_rels/pane.xml.rels':rels(rel('app','app.xml')), 'docProps/thumbnail.jpeg':'thumbnail'
  };
  assert.equal(await fingerprint(zipFixture(base)), await fingerprint(zipFixture(changed)));
  const content = {...base, 'word/media/picture.jpeg':'image'};
  assert.notEqual(await fingerprint(zipFixture(content)), await fingerprint(zipFixture({...content, '[Content_Types].xml':types(override('word/document.xml') + '<Default Extension="jpeg" ContentType="image/jpeg"/>')})));
});
test('root and mixed-case add-in metadata directories and their references are excluded consistently', async () => {
  const base = {'word/document.xml':doc('<w:p/>'), '_rels/.rels':rels(rel('doc','word/document.xml')), '[Content_Types].xml':types(override('word/document.xml'))};
  for (const name of ['webextensions/taskpanes.xml', 'word/webExtensions/taskpanes.xml']) {
    const changed = {...base, [name]:'<pane width="250"/>', '_rels/.rels':rels(rel('pane',name) + rel('doc','word/document.xml')), '[Content_Types].xml':types(override(name)+override('word/document.xml'))};
    assert.equal(await fingerprint(zipFixture(base)),await fingerprint(zipFixture(changed)));
  }
});
test('root relationship renumbering is harmless; retargeting the document is not', async () => {
  const parts = relationship => ({'word/document.xml':doc('<w:p/>'), '_rels/.rels':rels(relationship)});
  const expected = await fingerprint(zipFixture(parts(rel('rId1','word/document.xml'))));
  assert.equal(expected, await fingerprint(zipFixture(parts(rel('rId9','word/document.xml')))));
  assert.notEqual(expected, await fingerprint(zipFixture(parts(rel('rId9','word/other.xml')))));
});

test('diagnostics identify standard parts and omit content, attributes, custom names and hashes', async () => {
  const {changeDetails}=await import('../src/fingerprint.js');
  const a=new Map(),b=new Map();
  const first=await fingerprint(zipFixture({'word/document.xml':doc('<w:p/>'),'word/fontTable.xml':'<fonts><font name="secret person"/></fonts>', 'private-filename.xml':'<secret>private text</secret>'}),a);
  const second=await fingerprint(zipFixture({'word/document.xml':doc('<w:p/>'),'word/fontTable.xml':'<fonts><font name="another secret"/></fonts>', 'private-filename.xml':'<secret>changed private text</secret>'}),b);
  const report=changeDetails(first,second,a,b);
  assert.match(report,/word\/fontTable.xml/); assert.match(report,/attributes changed/);
  for (const value of ['secret','private','another', ...JSON.parse(first).map(p=>p[1])]) assert.ok(!report.includes(value));
});

test('note paragraph identity churn is ignored while note text, formatting and reference IDs are preserved', async () => {
  const notes = (type,stamp,content='note',id='1',format='') => `<w:${type}s xmlns:w="${ns}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:${type} w:id="${id}"><w:p w14:paraId="${stamp}" w14:textId="${stamp}"><w:r>${format}<w:t>${content}</w:t></w:r></w:p></w:${type}></w:${type}s>`;
  for (const type of ['footnote','endnote']) {
    const name=`word/${type}s.xml`;
    const hashNotes=async xml=>fingerprint(zipFixture({'word/document.xml':doc('<w:p/>'),[name]:xml}));
    const first=await hashNotes(notes(type,'123'));
    assert.equal(first,await hashNotes(notes(type,'456')));
    assert.notEqual(first,await hashNotes(notes(type,'456','edited')));
    assert.notEqual(first,await hashNotes(notes(type,'456','note','2')));
    assert.notEqual(first,await hashNotes(notes(type,'456','note','1','<w:rPr><w:b/></w:rPr>')));
    assert.notEqual(first,await hashNotes(notes(type,'456').replace('w14:paraId','w:paraId')));
  }
});
test('diagnostics name changed standard attributes without their values', async () => {
  const {changeDetails}=await import('../src/fingerprint.js');
  const a=new Map(),b=new Map();
  const first=await fingerprint(zipFixture({'word/document.xml':doc('<w:p w:id="private-one"/>')}),a);
  const second=await fingerprint(zipFixture({'word/document.xml':doc('<w:p w:id="private-two"/>')}),b);
  const report=changeDetails(first,second,a,b);
  assert.match(report,/w:id/); assert.ok(!report.includes('private'));
});
