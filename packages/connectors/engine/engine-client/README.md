# @miragon/pulse-engine-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-client?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-engine-client)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

A typed TypeScript client for the REST API of Camunda 7, CIB seven and Operaton.

## Install

```sh
npm install @miragon/pulse-engine-client
```

## Overview

TypeScript client for the [CIB seven](https://cibseven.org/) REST API: an SDK
generated with [`@hey-api/openapi-ts`](https://heyapi.dev/), a client factory
with deadlines and engine errors, and the reads whose REST contract the SDK
defaults miss. There is no official TypeScript client for CIB seven; this
package fills that gap for Pulse and is usable by any CIB seven / Camunda 7
project. It has no runtime dependency. The pure engine REST rules (dates,
filters, sorting, variable writes, incident recovery) live in
[`@miragon/pulse-c7-core`](../../c7/c7-core/README.md), which this package
does not import.

## Exports

| Subpath   | Contents                                                                                  |
| --------- | ----------------------------------------------------------------------------------------- |
| `.`       | `createEngineClient` factory, `EngineRequestError`, the SDK-bound reads and batch reports |
| `./sdk`   | Generated SDK, one typed function per REST operation                                      |
| `./types` | Generated request/response types                                                          |

Import only these three subpaths: the layout of the generated output
(`dist/generated/**`) changes with any `@hey-api/openapi-ts` upgrade, so it is
not exported.

## Client behavior

SDK functions return the response payload directly (`responseStyle: "data"`)
and reject on HTTP error responses (`throwOnError: true`). Both options are
declared once in the generator config (`openapi-ts.config.ts`) and applied at
runtime through `createClientConfig` (`src/hey-api.ts`), which the generated
default client and `createEngineClient` share, so generated types and runtime
behavior always agree. Every request sends
`User-Agent: @miragon/pulse-engine-client/<version>`, so the engine's access
logs show Pulse's calls.

```ts
import { createEngineClient } from "@miragon/pulse-engine-client"
import { getProcessDefinitions } from "@miragon/pulse-engine-client/sdk"

const client = createEngineClient({
  baseUrl: "http://localhost:8410/engine-rest",
  authType: "basic",
  username: "demo",
  password: "demo",
})
const definitions = await getProcessDefinitions({ client, query: { latestVersion: true } })
```

Every `createEngineClient` client, whatever its auth type, rejects with an
`EngineRequestError` (an `Error` with `kind`, `httpStatus`, `type`,
`engineMessage`, `engineCode`, `engineId`) instead of the raw error body, with
a message that is safe and useful to show a model (engine text truncated, the
request's credentials masked):
`[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)`,
`engine prod-a unreachable (ECONNREFUSED)` (no connection: the engine never
saw the request), `connection to engine prod-a failed (ECONNRESET)` (dropped
mid-request; a write adds that it may still have been applied), or
`engine prod-a did not respond within 30000 ms (timeout)`. A client never
follows a redirect (a followed 302/303 turns a write into a GET): a 3xx
rejects with `[302] redirect to https://sso.example/login (engine prod-a)` and
the fix (point the engine URL at the REST API root itself, e.g. `https://`; a
redirect to a login page means missing or expired credentials). A 404 that is
no engine answer (a JAX-RS `NotFoundException` or an error page without an
exception type) adds "No such endpoint: check that the engine URL points at the REST
API root itself". Pass `engineId` to name the engine in those messages and `timeoutMs` to change the per-request
deadline (default 30 000 ms). `withCallerSignal(client, signal)` returns a view
whose reads (`GET`/`HEAD`/`OPTIONS`) also abort with the caller's signal;
writes never do, since aborting a started write cannot undo it.

The deadline lives in the client's `fetch`, so it binds each request after
every request interceptor. A custom `fetch` (per call or via `setConfig`)
replaces it, so wrap `client.getConfig().fetch` instead. Request interceptors
should mutate the request (`request.headers.set(…)`): one that returns a new
`Request` keeps the deadline, but can detach the caller's signal.

## OpenAPI spec: origin & refresh

The spec is checked in as `cibseven-open-api-doc.json` (currently reporting
`info.version` **2.1.2**). It originates from the engine's published OpenAPI
artifact `org.cibseven.bpm:cibseven-engine-rest-openapi` (a jar containing
`openapi.json`); Maven Central publishes the minor releases (2.1.0, 2.2.0, …).
The running engine does not serve its spec over HTTP, so the artifact is the
canonical source.

To refresh:

```bash
pnpm spec:refresh <version>   # downloads + extracts the spec, e.g. pnpm spec:refresh 2.2.0
pnpm generate                 # regenerate src/generated from the new spec
git diff                      # review spec + SDK changes, run the repo verification suite
```

Commit the spec and the regenerated output together: `src/generated/` is
checked in and CI assumes it matches the spec.

## The SDK-bound reads

`src/engine-contract/` holds the reads whose REST contract differs from the SDK
defaults: the `text/plain`-only stacktrace and error-details endpoints
(`fetchJobStacktrace`, `fetchExternalTaskErrorDetails`, `null` for an empty
body), variable reads with `deserializeValues=false`
(`readProcessInstanceVariables`, `readTaskVariables`) and `readBatch`, which
falls back from the runtime statistics to the history record. These reads
decide nothing about a failure: every engine error rejects, a 404 included.
Whether a 404 names a missing resource or a wrong REST root is
`@miragon/pulse-c7-core`'s `isMissing`, which the caller applies; this
package stays a leaf and does not import it. The variable reads restate
c7-core's `RAW_VARIABLES`, and the engine connector holds the copy equal.
The MCP tools' input schemas live in `@miragon/pulse-engine-connector` next to
its tools.
