import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToOoxml } from '../src/markdown.js';
test('required Markdown types become native Word structures',()=>{
  const xml=markdownToOoxml('# Heading\n\n**bold** *italic* ~~strike~~ [link](https://example.com) `code`\n\n- first\n  1. nested\n  2. next\n- second\n\n| A | B |\n| --- | --- |\n| one | two |\n\n```js\nconst x = 1;\n```');
  for(const token of ['<w:b/>','<w:i/>','<w:strike/>','<w:outlineLvl','<w:numPr>','<w:ilvl w:val="1"','<w:hyperlink','<w:tbl>','Consolas']) assert.ok(xml.includes(token),token);
});
test('active HTML and dangerous links remain inert, URLs are XML escaped',()=>{
  const xml=markdownToOoxml('<script>alert(1)</script> [bad](javascript:evil) [good](https://example.com/?a=1&b=2)');
  assert.ok(!xml.includes('<script>'));assert.ok(xml.includes('&lt;script&gt;'));assert.ok(!xml.includes('javascript:'));assert.ok(xml.includes('a=1&amp;b=2'));assert.ok(!xml.includes('altChunk'));
});
test('explicit boundaries add native paragraphs and malformed tables fail before mutation',()=>{
  const normal=markdownToOoxml('hello'),bounded=markdownToOoxml('hello',{leadingBoundary:true,trailingBoundary:true});
  assert.equal((normal.match(/<w:p>/g)||[]).length,1);assert.equal((bounded.match(/<w:p>/g)||[]).length,3);
  assert.throws(()=>markdownToOoxml('|A|B|\n|---|---|\n|one|'));
});
test('paragraph and control-character limits apply to rendered results',()=>{
  assert.throws(()=>markdownToOoxml('a\u0000b'));
  assert.throws(()=>markdownToOoxml(''));
  assert.throws(()=>markdownToOoxml('- x\n'.repeat(4095),{leadingBoundary:true,trailingBoundary:true}));
});
