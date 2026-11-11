// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

// Synthetic host-test fixture. No inference, credentials or request-body logs.
import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.TEST_PORT || 8787), origin = process.env.AETOS_ORIGIN || 'https://localhost:3000';
const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let raw='', request;
  try { for await (const chunk of req) {raw+=chunk;if(raw.length>1048576)throw Error();} request=JSON.parse(raw); } catch {res.writeHead(400).end();return;}
  const allowed = Object.keys(request).sort().join(',') === 'messages,model,stream' && request.stream === true && request.messages?.length === 2 && request.messages[0].role === 'system' && request.messages[1].role === 'user';
  if (!allowed) {res.writeHead(400).end();return;}
  try { const user=JSON.parse(request.messages[1].content);if(Object.keys(user).sort().join(',')!=='instructions,source')throw Error(); } catch {res.writeHead(400).end();return;}
  const text = '# AETOS Office Assistant test\n\n**Bold**, *italic*, ~~strike~~ and `code`.\n\n- First item\n  1. Nested item\n- Second item\n\n[Example link](https://example.com)\n\n| Column A | Column B |\n| --- | --- |\n| Alpha | Beta |';
  if (request.model === 'json') {res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});
  const emit=(content,reason=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta:content?{content}:{},finish_reason:reason}]})}\n\n`);
  if(request.model==='malformed'){res.end('data: invalid\n\n');return;}
  if(request.model==='timeout'){const timer=setTimeout(()=>res.end(),100000);res.on('close',()=>clearTimeout(timer));return;}
  let i=0;const timer=setInterval(()=>{
    if(i<text.length){emit(text.slice(i,i+12));i+=12;return;}
    clearInterval(timer);
    if(request.model==='truncated'){res.end();return;}
    emit('',request.model==='filtered'?'content_filter':'stop');res.end('data: [DONE]\n\n');
  },100);
  res.on('close',()=>clearInterval(timer));
};
const tls = process.env.AETOS_TLS_CERT && process.env.AETOS_TLS_KEY;
const server = tls ? https.createServer({cert:await readFile(process.env.AETOS_TLS_CERT),key:await readFile(process.env.AETOS_TLS_KEY)},handler) : http.createServer(handler);
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic endpoint: ${tls?'https':'http'}://localhost:${port}/v1/chat/completions; models: sse, json, truncated, filtered, malformed, timeout`));
