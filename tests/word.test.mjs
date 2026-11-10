import test from 'node:test';
import assert from 'node:assert/strict';
import { WordHost } from '../src/word.js';
import { zipFixture } from './zip-fixture.mjs';
function setup() {
  const state={text:'selected',xml:'<w:p><w:r><w:t>selected</w:t></w:r></w:p>',position:1,document:'unchanged',mutations:[],locked:false};
  const ctx={sync:async()=>{},document:{getSelection:()=>range(state.position)}};
  function range(position) {
    return {position,context:ctx,text:state.text,isEmpty:!state.text,load(){return this;},track(){},untrack(){},
      getOoxml(){return {value:state.xml};}, parentBody:{type:'MainDoc',load(){}},parentTableCellOrNullObject:{isNullObject:!state.inCell,load(){},body:{getRange(){return {cellBody:true};}}},
      compareLocationWith(other){return {value:other.cellBody ? (state.cellRelation || 'Equal') : this.position===other.position?'Equal':'Before'};},getRange(){return this;},
      paragraphs:{items:[{}],load(){},getFirst(){return {getRange:()=>range(position)};},getLast(){return {getRange:()=>range(position)};}},
      insertOoxml(xml,location){if(state.locked)throw Error('protected');state.mutations.push({xml,location});}
    };
  }
  const document={url:'https://example.com/document.docx',getFileAsync(type,opts,cb){const data=zipFixture({'word/document.xml':state.exportXml ? state.exportXml() : `<doc>${state.document}</doc>`});cb({status:'succeeded',value:{size:data.length,sliceCount:1,getSliceAsync(i,cb){cb({status:'succeeded',value:{data:[...data]}});},closeAsync(cb){cb({status:'succeeded'});}}});}};
  globalThis.Office={context:{document},FileType:{Compressed:'compressed'},AsyncResultStatus:{Succeeded:'succeeded'}};
  globalThis.Word={run:async(...args)=>args.at(-1)(ctx)};
  return state;
}
test('Word adapter does not mutate during prepare, applies with one insertion call',async()=>{
  const state=setup(),host=new WordHost(),snapshot=await host.prepare();assert.equal(state.mutations.length,0);await host.apply(snapshot,'**new**','replace');assert.equal(state.mutations.length,1);assert.ok(state.mutations[0].xml.includes('<w:b/>'));
});
test('Word adapter rejects changed content and mismatched location without mutation',async()=>{
  const state=setup(),host=new WordHost(),snapshot=await host.prepare();state.position=2;await assert.rejects(()=>host.apply(snapshot,'new','replace'));assert.equal(state.mutations.length,0);
  state.position=1;await host.inspect(snapshot);state.document='edited';await assert.rejects(()=>host.apply(snapshot,'new','replace'));assert.equal(state.mutations.length,0);assert.equal(snapshot.invalid,true);
});
test('Word adapter rejects document switches and invalid Markdown before mutation',async()=>{
  const state=setup(),host=new WordHost(),snapshot=await host.prepare();await assert.rejects(()=>host.apply(snapshot,'','replace'));assert.equal(state.mutations.length,0);
  Office.context.document={...Office.context.document,url:'another'};await assert.rejects(()=>host.apply(snapshot,'new','replace'));assert.equal(state.mutations.length,0);
});
test('host refusal is sanitized and marked uncertain to prevent duplicate acceptance',async()=>{
  const state=setup(),host=new WordHost(),snapshot=await host.prepare();state.locked=true;
  await assert.rejects(()=>host.apply(snapshot,'new','replace'),e=>e.uncertain&&e.message.includes('Word refused'));assert.equal(state.mutations.length,0);
});

test('prepare and accept tolerate fresh export revision-session IDs but still reject text edits', async()=>{
  const state=setup(); let exportCount=0;
  state.exportXml=()=>`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p w:rsidR="${++exportCount}"><w:r><w:t>${state.document}</w:t></w:r></w:p></w:body></w:document>`;
  const host=new WordHost(),snapshot=await host.prepare(); await host.inspect(snapshot);
  assert.equal(snapshot.invalid,false); assert.equal(state.mutations.length,0);
  state.document='actual edit'; await assert.rejects(()=>host.apply(snapshot,'new','replace')); assert.equal(state.mutations.length,0);
});
test('cursor and all plain text within a cell are accepted; crossing its boundary is refused', async () => {
  for (const text of ['', 'selected']) {
    const state=setup(); state.inCell=true; state.text=text;
    const host=new WordHost(), snapshot=await host.prepare();
    await host.apply(snapshot,'replacement','replace');
    assert.equal(state.mutations.length,1);
  }
  const state=setup(); state.inCell=true; state.cellRelation='Contains';
  await assert.rejects(() => new WordHost().prepare(), /whole cells and table boundaries/);
  assert.equal(state.mutations.length,0);
});

test('unstable package permits preview but never application, and exposes no text in diagnostic', async () => {
  const state=setup(); let exports=0;
  state.exportXml=()=>`<doc>private text ${++exports}</doc>`;
  const host=new WordHost(),snapshot=await host.prepare();
  assert.equal(snapshot.source,'selected'); assert.equal(snapshot.invalid,true);
  assert.match(snapshot.diagnostic,/word\/document.xml/);
  assert.ok(!snapshot.diagnostic.includes('private text'));
  await assert.rejects(()=>host.apply(snapshot,'new','replace'));
  assert.equal(state.mutations.length,0);
});
test('unstable package still refuses changed selected text during preparation', async () => {
  const state=setup(); let exports=0;
  state.exportXml=()=>{ if (++exports === 2) state.text='edited'; return `<doc>${exports}</doc>`; };
  await assert.rejects(()=>new WordHost().prepare()); assert.equal(state.mutations.length,0);
});
