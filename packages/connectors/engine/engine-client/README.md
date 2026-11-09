# @miragon/pulse-engine-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-client)](https://www.npmjs.com/package/@miragon/pulse-engine-client)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

A typed TypeScript client for the REST API of Camunda 7, CIB seven and Operaton, with deadlines and
error messages safe to show a model. Below 1.0: pin the exact version and update all
`@miragon/pulse-*` packages together.

In a Pulse server you get it through
[`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
which depends on it; install it yourself when your own code or your own module calls the engine
REST API.

## Install

```sh
npm install @miragon/pulse-engine-client
```

It has no runtime dependency and no peers.

## Minimal example

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

`authType` is `basic`, `bearer` (with `token`), `passthrough` (with a `tokenProvider` that returns
each caller's bearer token) or `none`. SDK functions return the response payload directly and
reject on an HTTP error.

## What it provides

| Subpath   | Contents                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `.`       | `createEngineClient`, `withCallerSignal`, `EngineRequestError`, the SDK-bound reads and batch reports |
| `./sdk`   | The generated SDK, one typed function per REST operation                                              |
| `./types` | The generated request and response types                                                              |

Import only these three subpaths: the layout of the generated output changes with any
`@hey-api/openapi-ts` upgrade, so it is not exported. The pure engine REST rules (dates, filters,
sorting, variable writes, incident recovery) are in
[`@miragon/pulse-engine-core`](https://www.npmjs.com/package/@miragon/pulse-engine-core).

## Errors and deadlines

Every `createEngineClient` client rejects with an `EngineRequestError` (an `Error` with `kind`,
`httpStatus`, `type`, `engineMessage`, `engineCode`, `engineId`) instead of the raw error body. Its
message truncates engine text and masks the request's credentials:

- `[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)`
- `engine prod-a unreachable (ECONNREFUSED)`: no connection, the engine never saw the request
- `connection to engine prod-a failed (ECONNRESET)`: dropped mid-request; a write adds that it may
  still have been applied
- `engine prod-a did not respond within 30000 ms (timeout)`

A client never follows a redirect, since a followed 302/303 turns a write into a GET: a 3xx rejects
with `[302] redirect to https://sso.example/login (engine prod-a)` and the fix (point the engine URL
at the REST API root itself; a redirect to a login page means missing or expired credentials). A
404 that is no engine answer (a JAX-RS `NotFoundException` or an error page without an exception
type) adds "No such endpoint: check that the engine URL points at the REST API root itself".

Pass `engineId` to name the engine in those messages and `timeoutMs` to change the per-request
deadline (default 30 000 ms). `withCallerSignal(client, signal)` returns a view whose reads
(`GET`/`HEAD`/`OPTIONS`) also abort with the caller's signal; writes never do, since aborting a
started write cannot undo it. Every request sends `User-Agent: @miragon/pulse-engine-client/<version>`,
so the engine's access logs show these calls.

The deadline lives in the client's `fetch`, so it binds each request after every request
interceptor. A custom `fetch` (per call or via `setConfig`) replaces it, so wrap
`client.getConfig().fetch` instead. Request interceptors should mutate the request
(`request.headers.set(…)`): one that returns a new `Request` keeps the deadline, but can detach
the caller's signal.

## The SDK-bound reads

These reads handle REST contracts the SDK defaults miss: the `text/plain`-only stacktrace and
error-details endpoints (`fetchJobStacktrace`, `fetchExternalTaskErrorDetails`, `null` for an empty
body), variable reads with `deserializeValues=false` (`readProcessInstanceVariables`,
`readTaskVariables`) and `readBatch`, which falls back from the runtime statistics to the history
record. They decide nothing about a failure: every engine error rejects, a 404 included. Whether a
404 names a missing resource or a wrong REST root is `isMissing` of `@miragon/pulse-engine-core`,
which you apply.

## Help and feedback

- **Documentation:** the Pulse servers, CLI and modules built on this client are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the client is generated and how to refresh its OpenAPI spec is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
