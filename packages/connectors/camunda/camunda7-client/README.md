# @miragon/pulse-camunda7-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-camunda7-client?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-camunda7-client)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

A typed TypeScript client for the REST API of Camunda 7, CIB seven and Operaton.

## Install

```sh
npm install @miragon/pulse-camunda7-client zod
```

## Overview

TypeScript client for the [CIB Seven](https://cibseven.org/) REST API: an SDK
generated with [`@hey-api/openapi-ts`](https://heyapi.dev/) plus hand-written,
MCP-oriented Zod input schemas. There is no official TypeScript client for
CIB Seven; this package fills that gap for Pulse and is
usable by any CIB Seven / Camunda 7 project.

## Exports

| Subpath     | Contents                                                                 |
| ----------- | ------------------------------------------------------------------------ |
| `.`         | `createCamunda7Client` factory, `EngineRequestError` + schema re-exports |
| `./sdk`     | Generated SDK, one typed function per REST operation                     |
| `./types`   | Generated request/response types                                         |
| `./schemas` | Zod input schemas (see below)                                            |

These four subpaths are the public API. The internal layout of the generated
output (`dist/generated/**`) is not: it may change with any `@hey-api/openapi-ts`
upgrade, so deep imports are deliberately not exported.

## Client behavior

SDK functions return the response payload directly (`responseStyle: "data"`)
and reject on HTTP error responses (`throwOnError: true`). Both options are
declared once in the generator config (`openapi-ts.config.ts`) and applied at
runtime through `createClientConfig` (`src/hey-api.ts`), which the generated
default client and `createCamunda7Client` share, so generated types and runtime
behavior always agree.

```ts
import { createCamunda7Client } from "@miragon/pulse-camunda7-client"
import { getProcessDefinitions } from "@miragon/pulse-camunda7-client/sdk"

const client = createCamunda7Client({
  baseUrl: "http://localhost:8410/engine-rest",
  authType: "basic",
  username: "demo",
  password: "demo",
})
const definitions = await getProcessDefinitions({ client, query: { latestVersion: true } })
```

Every `createCamunda7Client` client, whatever its auth type, rejects with an
`EngineRequestError` (an `Error` with `kind`, `httpStatus`, `type`,
`engineMessage`, `engineCode`, `engineId`) instead of the raw error body, with
a message that is safe and useful to show a model (engine text truncated, the
request's credentials masked):
`[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)`,
`engine prod-a unreachable (ECONNREFUSED)` (no connection: the engine never
saw the request), `connection to engine prod-a failed (ECONNRESET)` (dropped
mid-request; a write adds that it may still have been applied), or
`engine prod-a did not respond within 30000 ms (timeout)`. Pass `engineId` to
name the engine in those messages and `timeoutMs` to change the per-request
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
pnpm spec:refresh <version>   # e.g. pnpm spec:refresh 2.2.0 — downloads + extracts the spec
pnpm generate                 # regenerate src/generated from the new spec
git diff                      # review spec + SDK changes, run the repo verification suite
```

Commit the spec and the regenerated output together: `src/generated/` is
checked in and CI assumes it matches the spec.

## MCP-oriented input schemas

`src/schemas/` (exported as `./schemas`) are hand-written Zod schemas for the
MCP tools in `@miragon/pulse-camunda7-connector`: flat parameter objects with
LLM-friendly descriptions, sensible defaults, and conservative bounds. They
are intentionally narrower than the full REST API surface and are not
generated from the spec. They are the package's value-add for building MCP
tools on top of the raw SDK, and can be ignored by non-MCP consumers.
