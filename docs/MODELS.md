# Connecting a model

AETOS Office Assistant does not ship with a model, an account or a subscription.
You point it at a provider you already use.

## What kind of endpoint works

The endpoint must be an **OpenAI-compatible chat completions API**:

- it accepts `POST` with a JSON body,
- it returns either server-sent events (`text/event-stream`) or one JSON
  completion,
- it allows **browser CORS requests** from the add-in origin.

Compatible options include most hosted providers, plus local tools such as
Ollama, LM Studio and llama.cpp's OpenAI-compatible server.

## Saving a connection

Open **Model connection** in the task pane and fill in:

| Field | Meaning |
|---|---|
| Connection name | Any label you choose, for example `Work assistant`. |
| Endpoint | The complete URL, for example `https://provider.example/v1/chat/completions`. |
| Model identifier | The provider's exact model name, for example `gpt-4o-mini`. |
| API key | Optional. Sent as an `Authorization: Bearer …` header. |

Save it, and optionally mark it as the **default** connection. Up to **32**
connections may share an endpoint. No provider or model is preselected.

While drafting you can expand **Model** in the task pane to override the
connection for the current session only.

## Endpoint rules

The endpoint is refused if it contains:

- a redirect,
- credentials in the URL,
- a query string or a fragment.

Hosted endpoints must use HTTPS. Plain HTTP is allowed only for `localhost`,
`127.0.0.1` and `::1`, for local development. Browser mixed-content and
private-network policies may still block HTTP loopback; use trusted HTTPS in
that case.

The provider must accept CORS requests from the add-in origin, including `POST`
with `Content-Type`, and `Authorization` if you use a key.

## What is sent to the model

A single request containing:

```json
{
  "model": "<your model identifier>",
  "messages": [ ... ],
  "stream": true
}
```

The **only** document information in those messages is your instruction and the
**selected plain text**. There are no tools, no conversation history, no images
and no surrounding context.

The document itself is never transmitted. AETOS Office Assistant does compute a
local fingerprint of the open document to check whether it changed while you
were reviewing a suggestion; that fingerprint stays on your machine. See
[ARCHITECTURE.md](ARCHITECTURE.md).

## Response requirements

- **Streaming:** the stream must end with `finish_reason: stop` and a `[DONE]`
  marker.
- **Non-streaming:** exactly one assistant text completion with
  `finish_reason: stop`.

Anything else — a truncated stream, a refusal, malformed JSON or a timeout — is
reported as an error. Partial text from a failed request stays visible and
copyable, but cannot be applied to the document.

## Where settings and keys are stored

Connection settings and API keys are saved **unencrypted in the browser's
`localStorage`** on your machine, scoped to the add-in origin.

- The key field is intentionally visible on screen.
- Clearing the key and saving removes the stored value.
- Nothing is written into Word documents, and nothing is synchronized between
  devices.
- Word or browser policy may isolate or clear that storage; if connections
  disappear, re-enter them.

Do not use a shared browser profile for private credentials.

## Trying it without a real provider

A synthetic endpoint is included for host testing. It returns fixed Markdown and
never logs request bodies or credentials.

```sh
node scripts/test-endpoint.mjs
```

Default URL: `http://localhost:8787/v1/chat/completions`. Save separate
connections with the model identifiers `sse`, `json`, `truncated`, `filtered`,
`malformed` and `timeout` to exercise each response path.
