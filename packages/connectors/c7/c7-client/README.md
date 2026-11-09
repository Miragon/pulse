# @miragon/pulse-c7-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-c7-client?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-c7-client)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

A typed TypeScript client for the REST API of Camunda 7, CIB seven and Operaton: the SDK of the
Camunda 7 REST dialect family c7, next to its core
[`@miragon/pulse-c7-core`](../c7-core/README.md).

## Install

```sh
npm install @miragon/pulse-c7-client
```

## Overview

TypeScript client for the Camunda 7 REST API that CIB seven, Operaton and
Camunda 7 serve: an SDK generated with
[`@hey-api/openapi-ts`](https://heyapi.dev/), a client factory over the `fetch`
you hand it, and the reads whose REST contract the SDK defaults miss.
There is no official TypeScript client for CIB seven; this package fills that
gap for Pulse and is usable by any CIB seven, Operaton or Camunda 7 project.
It has no runtime dependency and imports no other package: the wire
(credentials, deadline, redirects, size cap, failures) is the `fetch`'s, the
pure engine REST rules (dates, filters, sorting, variable writes, incident
recovery, the route table) live in [`@miragon/pulse-c7-core`](../c7-core/README.md),
which this package does not import.

## Exports

| Subpath   | Contents                                                                                   |
| --------- | ------------------------------------------------------------------------------------------ |
| `.`       | `createEngineClient`, `withCallerSignal`, `USER_AGENT`, the SDK-bound reads, batch reports |
| `./sdk`   | Generated SDK, one typed function per REST operation                                       |
| `./types` | Generated request/response types                                                           |

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
`User-Agent: @miragon/pulse-c7-client/<version>` (`USER_AGENT`), so the
engine's access logs show Pulse's calls.

`createEngineClient({ baseUrl, fetch, requestValidator })` builds a client
that sends every request through the `fetch` it is given, called with the
finished `Request`, and adds nothing of its own: no credential, no deadline, no
redirect rule, no error mapping. The Pulse MCP server hands it the `asFetch` of
[`@miragon/pulse-http`](../../../core/http/README.md), which signs each request,
holds the deadline to the last byte, never follows a redirect, caps the answer
and masks secrets; its `requestValidator` refuses a path value `""`, `.` or
`..`, which the `Request` would resolve away before the `fetch` sees it.

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

An engine error rejects with what the engine sent (its parsed `ExceptionDto`,
the text, or `{}`) and a transport failure with what the `fetch` threw; install
an error interceptor (`client.interceptors.error.use(…)`) to word them, as the
Pulse engine connector does for the model. A call that brings a `fetch`, a
`requestValidator` or an `auth` of its own, per call or through `setConfig`, is
refused, even as `undefined`: it would leave the given one, and with it the
credential or the path value rule, out. `withCallerSignal(client, signal)` returns a
view whose reads (`GET`/`HEAD`/`OPTIONS`) also abort with the caller's signal;
writes never do, since aborting a started write cannot undo it.

## OpenAPI spec: origin & refresh

The SDK is generated from the one Camunda 7 REST spec of the c7 family,
`packages/connectors/c7/c7-core/spec/api.json` in the Pulse repository (Operaton's REST API
1.0.1, the same operations CIB seven and Camunda 7 serve), with the RFC 6902 patches of
`packages/connectors/c7/c7-core/spec/patches.json` applied: c7-core's `generate` writes that
patched spec, which c7-core's route table and the CLI's catalog read too, and `pnpm generate`
(turbo runs it before every build, c7-core's first) reads it as a file. A task's form reference
is named both ways: `TaskDto` and `FormDto` carry `camundaFormRef` (CIB seven, Camunda 7) and
`operatonFormRef` (Operaton), both of type `OperatonFormRef`. `TelemetryInternalsDto` is
Operaton's (`operaton-integration`, no `license-key`).

To refresh, replace the spec and regenerate:

```bash
pnpm generate                 # c7-core's patched spec and route tables, then the SDK here
git diff                      # review spec + SDK changes, run the repo verification suite
```

Commit the spec and the regenerated output together: `src/generated/` is
checked in, and CI's TypeScript job fails when the build rewrites it.

## The SDK-bound reads

`src/sdk-reads/` holds the reads whose REST contract differs from the SDK
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
