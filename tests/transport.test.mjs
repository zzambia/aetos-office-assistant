import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/transport.js';
const connection = {endpoint:'https://example.com/chat/completions',model:'custom',key:'never-print-me'};
const ev = (content, finish_reason = null) => `data: ${JSON.stringify({choices:[{index:0,delta:content == null ? {} : {content},finish_reason}]})}\r\n\r\n`;
const valid = ev('Héllo') + ev(null,'stop') + 'data: [DONE]\r\n\r\n';
function response(body, type='text/event-stream', chunk=3) { const encoded = new TextEncoder().encode(body); let at=0; return new Response(new ReadableStream({pull(c){if(at >= encoded.length){c.close();return;} c.enqueue(encoded.slice(at,at+chunk));at+=chunk;}}),{headers:{'Content-Type':type}}); }
test('SSE tolerates split UTF-8 and CRLF chunks, previews incrementally', async () => { const seen=[]; assert.equal(await generate(connection,[],{fetchImpl:async()=>response(valid),onText:t=>seen.push(t)}),'Héllo'); assert.deepEqual(seen,['Héllo']); });
test('JSON fallback accepts only completed text and request payload is minimal', async () => {
  const messages=[{role:'user',content:'source'}]; let request;
  const result=await generate(connection,messages,{fetchImpl:async(url,init)=>{request=init;return response(JSON.stringify({choices:[{message:{content:'done'},finish_reason:'stop'}]}),'application/json');}});
  assert.equal(result,'done'); assert.deepEqual(JSON.parse(request.body),{model:'custom',messages,stream:true}); assert.equal(request.redirect,'error'); assert.equal(request.credentials,'omit'); assert.equal(request.headers.Authorization,'Bearer never-print-me');
});
test('reject incomplete, filtered, malformed, empty, tool, and post-DONE streams', async t => {
  const failures = [ev('partial'),ev('partial')+'data: [DONE]\n\n',ev('partial','length')+'data: [DONE]\n\n',ev(null,'stop')+'data: [DONE]\n\n','data: bad\n\n',valid+'data: {}\n\n',ev('x','stop')+'data: [DONE]', 'data: {"choices":[{"index":0,"delta":{"tool_calls":[]}}]}\n\n'];
  for(const body of failures) await t.test(body.slice(0,35),async()=>assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>response(body)})));
});
test('partial output survives a failed stream callback', async()=>{let partial='';await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>response(ev('retain me')),onText:t=>partial=t}));assert.equal(partial,'retain me');});
test('response size and output size limits are enforced', async()=>{
  await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>response(' '.repeat(1048577),'application/json',65536)}),/1 MiB/);
  await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>response(ev('x'.repeat(65537)), 'text/event-stream',65536)}),/UTF-8/);
});
test('provider bodies and network errors cannot expose secrets', async()=>{
  await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>new Response('never-print-me',{status:401})}),e=>e.message.includes('401')&&!e.message.includes('never-print-me'));
  await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>{throw Error('never-print-me');}}),e=>!e.message.includes('never-print-me'));
});
test('timeout and explicit cancellation abort requests',async()=>{
  const hang=async(url,{signal})=>new Promise((_,reject)=>{if(signal.aborted)reject(Error());else signal.addEventListener('abort',()=>reject(Error()),{once:true});});
  await assert.rejects(()=>generate(connection,[],{fetchImpl:hang,timeout:5}),/timed out/);
  const c=new AbortController();c.abort();await assert.rejects(()=>generate(connection,[],{fetchImpl:hang,signal:c.signal}),/discarded/);
});
test('JSON refusal, truncation, missing content and redirects are rejected',async()=>{
  for(const c of [{finish_reason:'length',message:{content:'partial'}},{finish_reason:'stop',message:{refusal:'no'}},{finish_reason:'stop',message:{content:null}}]) await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>response(JSON.stringify({choices:[c]}),'application/json')}));
  await assert.rejects(()=>generate(connection,[],{fetchImpl:async()=>new Response('',{status:302,headers:{Location:'https://elsewhere.example'}})}));
});
