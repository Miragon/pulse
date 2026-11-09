# @miragon/pulse-c7-core

[![npm](https://img.shields.io/npm/v/@miragon/pulse-c7-core)](https://www.npmjs.com/package/@miragon/pulse-c7-core)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The workflow rules of the Camunda 7 REST dialect family c7 (Operaton, CIB seven, Camunda 7) for
your own tool: where a process instance waits and why, how an engine is doing, what retry and
advance would send, the route of every operation of the REST API, and the REST details every
caller of this API needs. Below 1.0: pin the exact version and update all `@miragon/pulse-*`
packages together.

It runs on an engine port you implement over any HTTP client and returns data, so an MCP tool, a
CLI command and an editor panel answer the same question by the same rules.

## Install

```sh
npm install @miragon/pulse-c7-core
```

It has no peers. Its one runtime dependency is
[`@miragon/pulse-engine-core`](https://www.npmjs.com/package/@miragon/pulse-engine-core), the
engine family's core and the contract every engine dialect implements, whose root-cause rule
(`RootCauses`) it applies.

## Minimal example

Wrap your client in an `EngineTransport`, turn it into a port, and run a workflow on it:

```ts
import {
  createEnginePort,
  type EngineTransport,
  failureOf,
  inspectInstance,
} from "@miragon/pulse-c7-core"

// Your client's answer of one request, read right after it arrived.
type Answer = { readonly body?: unknown; readonly text?: string }

const transport: EngineTransport<Answer> = {
  send: (operationId, input) => yourClient.send(operationId, input),
  json: (answer) => answer.body,
  text: (answer) => answer.text,
  // The status and what the body states: { type, message, code } of the engine's exception.
  failure: (error) =>
    error instanceof YourHttpError ? failureOf(error.status, error.problem) : undefined,
}
const port = createEnginePort(transport)
const view = await inspectInstance(
  port,
  { businessKey: "B-1", latest: true },
  { variables: true, history: false, stacktrace: false },
)
```

`send` sends one operation by its REST operation id; `json`, `text` and `failure` read its answer
and an engine failure. Your `failure` reading must carry the engine's exception type, as
`failureOf(status, problem)` does: without it a missing instance fails instead of reading as
missing.

## What it provides

- **Port:** `createEnginePort(transport)` adds the shared read rules: pages of 500, a missing
  resource as undefined, blank texts as undefined. `isMissing(failure)` is the one
  missing-resource rule (an engine 404 whose exception type is neither `NotFoundException` nor
  `QueryParamException`), so a wrong REST root fails loud instead of reading as "none";
  `isUnknownEndpoint(failure)` tells a 404 that is no engine answer, for a hint to check the REST
  root.
- **Inspect:** `inspectInstance(port, selection, options)` selects an instance by id, by business
  key or by key with `latest`, and loads its wait states with their ids, root-cause incidents,
  called instances, optionally variables, the history timeline and stacktraces (cut after
  `MAX_STACKTRACE_LINES` lines).
- **Status:** `readStatus({ port, now }, options)` triages one engine: findings with severity, the
  overall status, definitions, incident groups with their root cause, topics, jobs and batches,
  every cut named in `truncated`. `engineVerdict` judges an engine `ok`, `warning` or `critical` by
  thresholds you pass; `messageSignature` (the incident mask) and `causeKeyOf` (one cause) group
  incidents alike everywhere.
- **Plans:** the pure parts of retry (`planRetry`, `retriesWrite`), advance (`chooseWait`,
  `advanceSteps`) and wait (`parseCondition`, `decide`, `poll`).
- **Routes:** the route of each operation of the REST API: method, path template, effect (`read`,
  `write`, `delete`, `bulk`), whether a named engine (`/engine/{name}`) serves it and the media
  types of its answers. `CORE_ROUTES` holds what this package sends, reads only (a plan's writes
  are yours to send); `@miragon/pulse-c7-core/routes` exports `ROUTES`, all 399, as an entry of
  its own, so a bundle that needs only the core's carries no more. `routeOf(routes, method, path)`
  finds a request's route (a literal segment wins over a placeholder from the left:
  `GET /process-instance/count` is no instance id), `intentOf(route, method)` says whether it only
  reads (a `POST` query or evaluation does; a request no route knows reads only as `GET` or
  `HEAD`), and `routedTransport(routes, wire)` is an `EngineTransport` that sends each operation as
  its route over your `RoutedWire` (refusing one the table lacks or the wrong number of path values
  before anything is sent). `failureOf(status, problem)` is the engine failure of an error answer:
  the status and the exception type, message and code its body states (`problemOf` of
  `@miragon/pulse-http` reads them).
- **Engine REST rules:** dates (`toEngineDate`, `engineDateInput` in a `DateInputReading`:
  `OFFSET_REQUIRED` refuses a time without an offset, `UTC_WITHOUT_OFFSET` reads it as UTC;
  `engineDateMillis`, `latestEngineDate`), true-only and `…Like` filters (`trueOnly`,
  `complementaryFlags`, `engineLike`, `engineKeyList`, `engineInstanceSearch`), paired sorting
  (`engineSorting`), variable writes and typing (`toEngineVariable(s)`, `autoTypedValue`),
  incident recovery (`incidentRecovery`), the raw variable read flag (`RAW_VARIABLES`, and
  `RAW_VARIABLES_QUERY` for a port's query), the history timeline (`timelineOf`) and the cause of
  a failure (`causeOf(text, fallback)`: the root cause of a stack trace or error details by
  engine-core's `RootCauses.of`, else the fallback, such as the incident's message).

The routes come from one OpenAPI spec of the Camunda 7 REST API, Operaton's, vendored as it is and
corrected with RFC 6902 patches: the same 399 operations as CIB seven's and Camunda 7's, which
differ in descriptions, in the name of a task's form reference (`operatonFormRef`,
`camundaFormRef`) and in `TelemetryInternalsDto`. Neither the spec nor its generator ships: the
package carries the two tables only.

## What it leaves to you

No HTTP and no authentication, and nothing but engine-core at runtime. It names no command, flag
or tool: next steps are structured (`{ action: "retry", processInstanceId }`), errors are
`WorkflowError`s with a `reason` (`{ kind: "selection-ambiguous", candidates, more }`), and your
code words both. The English texts that describe the engine's state are the package's: the
finding messages of the status triage, its truncation notes and the summaries of planned writes
(`execute job j1`).

One port serves the whole API family: the vendors differ in runtime configuration, never in this
package.

## Who uses it

- [`@miragon/pulse-cli`](https://www.npmjs.com/package/@miragon/pulse-cli) bundles it: `inspect`,
  `status`, `wait`, `advance` and `retry` run on it, and its command catalog takes each
  operation's effect from the route table.
- [`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
  the engine module that serves every dialect, runs it as the MCP tools
  `engine_inspect_process_instance` and `engine_status`, and builds its cockpit's failure clusters
  and health verdict from the same rules.
- Pulse for VS Code and Pulse for Orca bundle it in their C7 adapter: an instance's panel reads
  through `loadInstance`.

## Testing helpers

`@miragon/pulse-c7-core/testing` exports the verified workflow fixture, the status fixture, wait
states of every kind, `fakePort` (a recording port over canned answers that refuses any operation
without a route) and `fakeClock`. It also exports the rules behind the entry's functions that
tests reach directly, and `INSPECT_OPERATIONS` and `STATUS_OPERATIONS`, the operations each
composite sends: a port that maps operations one by one holds its table equal to them in a test.

## Help and feedback

- **Documentation:** the Pulse servers, CLI and modules built on these rules are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the spec, its patches and the route table are generated and refreshed is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
