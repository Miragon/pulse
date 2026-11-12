# @miragon/pulse-c7-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-c7-client)](https://www.npmjs.com/package/@miragon/pulse-c7-client)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

A typed TypeScript client for the REST API of Camunda 7, CIB seven and Operaton: the SDK of the
Camunda 7 REST dialect family c7, next to its core
[`@miragon/pulse-c7-core`](https://www.npmjs.com/package/@miragon/pulse-c7-core). Below 1.0: pin
the exact version and update all `@miragon/pulse-*` packages together.

In a Pulse server you get it through
[`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
which depends on it; install it yourself when your own code or your own module calls the engine
REST API. There is no official TypeScript client for CIB seven; this one is usable by any
CIB seven, Operaton or Camunda 7 project.

## Install

```sh
npm install @miragon/pulse-c7-client
```

It has no runtime dependency and no peers.

## Minimal example

The client sends every request through the `fetch` you hand it. Here that is the `asFetch` of
[`@miragon/pulse-http`](https://www.npmjs.com/package/@miragon/pulse-http), the transport the
Pulse MCP server uses, which signs each request, holds the deadline to the last byte, never
follows a redirect, caps the answer and masks secrets:

```ts
import { createEngineClient } from "@miragon/pulse-c7-client"
import { getProcessDefinitions } from "@miragon/pulse-c7-client/sdk"
import { basicCredential, createHttp } from "@miragon/pulse-http"

const http = createHttp(
  {
    url: "http://localhost:8410/engine-rest",
    credential: basicCredential("demo", "demo"),
    timeoutMs: 30_000,
  },
  { fetch: globalThis.fetch, now: Date.now },
)
const client = createEngineClient({
  baseUrl: http.root,
  fetch: http.asFetch({ intentOf: (request) => (request.method === "GET" ? "read" : "write") }),
})
const definitions = await getProcessDefinitions({ client, query: { latestVersion: true } })
```

`createEngineClient({ baseUrl, fetch, requestValidator })` calls the `fetch` with the finished
`Request` and adds nothing of its own: no credential, no deadline, no redirect rule, no error
mapping. A `requestValidator`, when given, checks each call before anything is sent; the Pulse
MCP server's refuses a path value `""`, `.` or `..`, which the `Request` would resolve away before
the `fetch` sees it. SDK functions return the response payload directly and reject on an HTTP
error.

## What it provides

| Subpath   | Contents                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| `.`       | `createEngineClient`, `withCallerSignal`, `USER_AGENT`, the SDK-bound reads, batch reports |
| `./sdk`   | The generated SDK, one typed function per REST operation                                   |
| `./types` | The generated request and response types                                                   |

Import only these three subpaths: the layout of the generated output changes with any
`@hey-api/openapi-ts` upgrade, so it is not exported. The pure engine REST rules (dates, filters,
sorting, variable writes, incident recovery, the route table) are in
[`@miragon/pulse-c7-core`](https://www.npmjs.com/package/@miragon/pulse-c7-core), which this
package does not import.

## Errors and signals

An engine error rejects with what the engine sent (its parsed `ExceptionDto`, the text, or `{}`)
and a transport failure with what the `fetch` threw; install an error interceptor
(`client.interceptors.error.use(…)`) to word them, as the Pulse engine connector does for the
model. A call that brings a `fetch`, a `requestValidator` or an `auth` of its own, per call or
through `setConfig`, is refused, even as `undefined`: it would leave the given one, and with it
the credential or the path value rule, out.

`withCallerSignal(client, signal)` returns a view whose reads (`GET`/`HEAD`/`OPTIONS`) also abort
with the caller's signal; writes never do, since aborting a started write cannot undo it. Every
request sends `User-Agent: @miragon/pulse-c7-client/<version>` (`USER_AGENT`), so the engine's
access logs show these calls.

## The SDK-bound reads

These reads handle REST contracts the SDK defaults miss: the `text/plain`-only stacktrace and
error-details endpoints (`fetchJobStacktrace`, `fetchExternalTaskErrorDetails`, `null` for an empty
body), variable reads with `deserializeValues=false` (`readProcessInstanceVariables`,
`readTaskVariables`) and `readBatch`, which falls back from the runtime statistics to the history
record. They decide nothing about a failure: every engine error rejects, a 404 included. Whether a
404 names a missing resource or a wrong REST root is `isMissing` of `@miragon/pulse-c7-core`,
which you apply.

## Help and feedback

- **Documentation:** the Pulse servers, CLI and modules built on this client are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the client is generated from the c7 family's one spec is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH. The generated SDK holds works of others, each under its own licence:
the descriptions of the Operaton REST API's OpenAPI document (Apache License 2.0, with Operaton's
NOTICE) and the fetch client and comments of `@hey-api/openapi-ts` (MIT). Their licence and notice
files are in [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt), which the tarball ships beside
`LICENSE`.
