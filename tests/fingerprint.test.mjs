import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/fingerprint.js';
import { zipFixture } from './zip-fixture.mjs';
const parts={'word/document.xml':'<doc>hello</doc>','word/header1.xml':'<header/>','word/footer1.xml':'<footer/>','word/styles.xml':'<styles/>','docProps/core.xml':'metadata'};
test('fingerprint ignores ZIP compression/timestamps and volatile document metadata',async()=>{
  const a=await fingerprint(zipFixture(parts,false,1)),b=await fingerprint(zipFixture({...parts,'docProps/core.xml':'updated metadata'},true,42));assert.equal(a,b);
});
test('freshness detects edits in body, headers, footers and styles',async()=>{
  const a=await fingerprint(zipFixture(parts));
  for(const name of ['word/document.xml','word/header1.xml','word/footer1.xml','word/styles.xml']) assert.notEqual(a,await fingerprint(zipFixture({...parts,[name]:'<changed/>'})));
});
test('malformed and non-Word ZIP files fail closed',async()=>{
  await assert.rejects(()=>fingerprint(new Uint8Array(30)));await assert.rejects(()=>fingerprint(zipFixture({'file.txt':'hello'})));
});
