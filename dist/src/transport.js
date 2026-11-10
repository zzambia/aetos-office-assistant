import { endpoint, LIMIT, SafeError, suggestionLimit } from './core.js?v=0.2.9';

// SSE is framed by blank lines, independently of HTTP chunk boundaries.
export class SSE {
  constructor(onEvent) { this.buffer = ''; this.onEvent = onEvent; }
  push(text, final = false) {
    this.buffer += text;
    let match;
    while ((match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index); this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = frame.split(/\r\n|\n|\r/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) this.onEvent(data);
    }
    if (final && this.buffer.trim()) throw new SafeError('The stream ended with an incomplete event. Generate again.');
  }
}
export async function generate(connection, requestMessages, { signal, onText = () => {}, fetchImpl = fetch, timeout = LIMIT.timeout } = {}) {
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeout);
  let reader, text = '', done = false, stopped = false;
  const append = part => { if (typeof part !== 'string') throw new SafeError('Provider returned invalid text.'); text += part; suggestionLimit(text); onText(text); };
  const event = data => {
    if (done) throw new SafeError('Provider sent data after the completion marker.');
    if (data === '[DONE]') { if (!stopped) throw new SafeError('Provider did not complete successfully.'); done = true; return; }
    let obj; try { obj = JSON.parse(data); } catch { throw new SafeError('Provider returned malformed streaming JSON.'); }
    if (obj.error || !Array.isArray(obj.choices)) throw new SafeError('Provider returned an invalid response.');
    if (obj.choices.length === 0 && obj.usage && stopped) return;
    if (obj.choices.length !== 1 || obj.choices[0].index !== 0) throw new SafeError('Provider must return exactly one text choice.');
    const choice = obj.choices[0];
    if (stopped) throw new SafeError('Provider sent content after finishing.');
    if (!choice.delta || choice.delta.tool_calls || choice.delta.function_call || choice.delta.refusal) throw new SafeError('Provider returned non-writing output or refused the request.');
    if (choice.delta.content != null) append(choice.delta.content);
    if (choice.finish_reason != null) { if (choice.finish_reason !== 'stop') throw new SafeError('Output was filtered, truncated or incomplete. Generate again.'); stopped = true; }
  };
  try {
    const url = endpoint(connection.endpoint);
    const response = await fetchImpl(url, { method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json', ...(connection.key ? { Authorization: `Bearer ${connection.key}` } : {}) },
      body: JSON.stringify({ model: connection.model, messages: requestMessages, stream: true }) });
    if (!response.ok) throw new SafeError(`Provider request failed (HTTP ${response.status}). Check the connection and retry.`);
    if (response.redirected) throw new SafeError('Endpoint redirects are not permitted.');
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!['text/event-stream', 'application/json'].includes(type)) throw new SafeError('Provider must return SSE or JSON.');
    if (!response.body) throw new SafeError('Provider returned no response body.');
    reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let total = 0, json = '';
    const parser = new SSE(event);
    while (true) {
      const part = await reader.read(); if (controller.signal.aborted) throw new SafeError('Generation cancelled.');
      if (part.done) break;
      total += part.value.byteLength; if (total > LIMIT.response) throw new SafeError('Provider response exceeds 1 MiB.');
      const decoded = decoder.decode(part.value, { stream: true });
      if (type === 'text/event-stream') parser.push(decoded); else json += decoded;
    }
    if (type === 'text/event-stream') {
      parser.push(decoder.decode(), true);
      if (!done || !stopped) throw new SafeError('Stream ended before stop and [DONE]. Generate again.');
    } else {
      json += decoder.decode(); let obj; try { obj = JSON.parse(json); } catch { throw new SafeError('Provider returned malformed JSON.'); }
      const c = obj.choices?.[0];
      if (obj.error || obj.choices?.length !== 1 || c?.finish_reason !== 'stop' || !c.message || c.message.tool_calls || c.message.function_call || c.message.refusal) throw new SafeError('Provider returned incomplete or non-writing output.');
      append(c.message.content);
    }
    if (!text.trim()) throw new SafeError('Provider returned empty output.');
    return text;
  } catch (error) {
    if (timedOut) throw new SafeError('Generation timed out after 90 seconds. Try a shorter request.');
    if (signal?.aborted) throw new SafeError('Generation discarded.');
    if (error instanceof SafeError) throw error;
    throw new SafeError('Could not read the provider response. Check endpoint, CORS, TLS and network access.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (reader) { try { await reader.cancel(); } catch {} reader.releaseLock(); } controller.abort(); }
}
