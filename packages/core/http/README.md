# @miragon/pulse-http

[![npm](https://img.shields.io/npm/v/@miragon/pulse-http?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-http)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

One HTTP transport for the engines Pulse reaches: the Pulse MCP server's engine connector, the
[Pulse CLI](https://www.npmjs.com/package/@miragon/pulse-cli) and the C7 adapter of Pulse for VS
Code and Pulse for Orca, and the OAuth client protocol they share (`./oauth`). It holds the rules
of the wire once, so every client keeps them alike: a deadline to the last byte of the answer,
never a redirect, a size cap, one credential seam with exactly one second attempt after a 401
when the credential renewed, failure reasons as data, lossless JSON and the request's secrets
masked in each error answer, failure and trace.

## What it is not

No runtime dependency and no Node built-in: it runs over the `fetch` you hand it (Node's own, the
VS Code extension host's, which carries the editor's proxy and certificates, a fake in a test) on
the web platform's globals alone (only the test engine of `./testing/loopback` uses Node).
Building requests, reading a dialect's error answers, finding the secrets and every word a person
reads stay with the client that uses it.

## Install

```sh
npm install @miragon/pulse-http
```

## Use

```ts
import {
  basicCredential,
  createHttp,
  encodePathValue,
  HttpFailure,
  joinUrl,
} from "@miragon/pulse-http"

const http = createHttp(
  {
    url: "https://engine.example.com/engine-rest",
    credential: basicCredential("demo", process.env.ENGINE_PASSWORD ?? ""),
    timeoutMs: 30_000,
  },
  { fetch: globalThis.fetch, now: Date.now },
)

try {
  const url = joinUrl(http.root, `/process-instance/${encodePathValue(id)}`)
  const instance = await http.json({ method: "GET", url, intent: "read" }, "string")
} catch (error) {
  if (error instanceof HttpFailure) console.error(error.reason, error.mayHaveApplied)
}
```

`send` answers every status, `call` fails one from 400 on, `json` reads the body as JSON, and
`asFetch` hands a generated SDK (hey-api) a `fetch` that keeps the same rules on the wire. It gets
the URL the SDK's `Request` resolved already, so a path value `.` or `..` is gone by then: check
the path values before the URL is built, in the SDK's `requestValidator` with `pathValueProblem`.

| Rule            | What it means                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline        | `timeoutMs` holds from sending to the last byte of the answer, even where a `fetch` does not hand its signal on to the body.                                                                                                                                        |
| No redirect     | A 3xx fails (`redirect`), naming where it pointed without its query: a followed 302 turns a write into a GET of a login page.                                                                                                                                       |
| Size cap        | 64 MiB by default (`MAX_ANSWER_BYTES`, `maxAnswerBytes`): an announced length fails before the first byte, a streamed body as it crosses the cap, never read whole.                                                                                                 |
| Credential      | `noCredential`, `basicCredential` (RFC 7617 with UTF-8), `bearerCredential` over `staticToken`, `callerToken` (passthrough) or a source of your own that renews.                                                                                                    |
| One retry       | After a 401, exactly one second attempt, and only when the credential is renewable and says it renewed.                                                                                                                                                             |
| Intent          | Each request says whether it reads, never guessed from the method; any other counts as a write: a read-only connection refuses it before sending, and only it can carry `mayHaveApplied`.                                                                           |
| Reasons as data | `HttpFailure.reason` (see `FAILURE_REASONS`) with the status, the system code, the redirect target and what an error body states (`problemOf`).                                                                                                                     |
| Masking         | Every secret of a request (its credential, the headers you name in `secretHeaders`) reads `***` in an error answer, a failure and the trace; an Authorization's scheme stays (`Basic ***`), and JSON stays JSON (a number holding a secret reads `"***"`).          |
| Trace           | `trace` gets each request with its headers as you wrote them, secrets masked, and each answer, a 3xx included; only `revealSecrets: true` shows a request as sent, for a person who asked on this run (the CLI's `--show-secrets`). What a trace throws is dropped. |
| Lossless JSON   | `parseJson` keeps an integer beyond 2^53 as an exact-digit string, a BigInt or a raw JSON number; `stringifyJson` writes a BigInt back digit for digit.                                                                                                             |
| Path values     | `pathValueProblem` and `encodePathValue` refuse `""`, `.` and `..`, which the URL parser would resolve into another resource; `send` refuses such a URL as well, and one with a user or a password.                                                                 |

## OAuth

`@miragon/pulse-http/oauth` holds the OAuth client protocol of every Pulse surface, on the same
wire: the deadline to the last byte, never a redirect, a 1 MiB cap on an answer by default, every
secret of a request (the client's, by `basic` or `post`, and the grant's) masked in a trace and in
an error answer, and a URL with a user or a password refused before sending (a `RangeError`).

| Part           | What it does                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token endpoint | `requestToken` for the code, refresh token and client credentials grants and `revokeToken` (RFC 7009), the client authenticated by `basic`, `post` or as a public client. An answer is checked (a b64token, a Bearer type); a refusal is a `TokenFailure`: its kind, the server's `error` as sent and a hold. |
| Renewal        | `EXPIRY`, one policy for every surface: renew `min(60 s, a tenth of the lifetime)` before expiry, at least 5 s before; a lifetime of 300 s when the answer names none; after a 401 only a token at least 30 s old (`refreshAt`, `isDue`, `renewsAfterRefusal`).                                               |
| Token sources  | `clientCredentialsTokens` (one request at a time; a hold of a minute after a refusal, 5 s after a failure, a rate limit as long as its `Retry-After` asks), `refreshingTokens` (a login renewed under its store's lock), `commandTokens` (a command's token). Each is a `TokenSource` for `bearerCredential`. |
| Store          | `TokenStore` (read, write, a lock per key), `memoryTokenStore` and `tokenKey`, the SHA-256 of what a token is kept for, so no secret stands in clear as a key.                                                                                                                                                |
| Login          | `discover` and `serverMetadata` (the issuer exactly, PKCE S256, endpoints on https or on a host the caller's `isLoopback` accepts), `createPkce`, `authorizationUrl`, `callbackResult` (the state in constant time, then `iss` by RFC 9207).                                                                  |
| JWT            | `jwtClaims`: expiry, subject, user, issuer and audience, without checking the signature.                                                                                                                                                                                                                      |

`refreshingTokens` keeps the refresh token in the store only: under the lock it takes over a newer
token another process got, sends the stored refresh token (never one from memory, a replay that
Keycloak ends the session for), keeps a rotated one and records a refused one, so nothing asks with
it again; a renewal that fails for a passing reason (no answer, a 5xx, a rate limit, a busy lock)
keeps a token that is still valid. `clientCredentialsTokens` keeps none: while its renewal fails,
a request fails until the hold ends, also before the old token expires (the rule of the C8 adapter
it comes from). After a 401 a token source renews once, and the token it got goes out with the
second attempt even when the policy finds it due at once (a lifetime of 5 s or less): one renewal
per attempt. Where tokens are kept, how a person logs in and every word a person reads stay with
the surface.

## The conformance cases

`@miragon/pulse-http/testing` exports `TRANSPORT_CASES`: each a connection, one request, the
engine's answers and what every wiring of the transport must observe. Run each case your client
can express (`casesFor(["basic", "bearer", …])`, and name the rest in your test) against the
recording engine of `@miragon/pulse-http/testing/loopback` (`startCaseEngine(kase)`: real sockets
on 127.0.0.1, a self-signed certificate made at test time, Node only), map what your client got
onto an `Observed` and assert that `caseFindings` finds nothing. Where a case is also one of the error-path goldens of the Pulse
clients, it carries that golden's name. For unit tests without sockets, `recordingFetch(script)`
records each request and answers it with the script's next entry: a `Response`, a function of the
request, `{ fail: "ECONNREFUSED" }` or `{ hang: "headers" }`.

## License

MIT
