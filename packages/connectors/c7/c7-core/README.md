# @miragon/pulse-c7-core

[![npm](https://img.shields.io/npm/v/@miragon/pulse-c7-core?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-c7-core)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The core of the Camunda 7 REST dialect family c7 (Operaton, CIB seven, Camunda 7), its workflow
domain: where a process instance waits and why, how an engine is doing, and what retry and
advance would send, and the pure engine REST rules every caller of this API needs (dates,
filters, sorting, variable writes, incident recovery). It runs on an engine port you implement
and returns data.

## Who uses it

[pulse-cli](https://www.npmjs.com/package/@miragon/pulse-cli) bundles it: `inspect`, `status`,
`wait`, `advance` and `retry` run on it and word its results as command lines and CLI errors.
[@miragon/pulse-engine-connector](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
the engine module that serves every dialect, runs inspect and status on it over its client, as
the MCP tools `engine_inspect_process_instance` and `engine_status`, and builds its cockpit's
failure clusters and health verdict from the same `messageSignature` (the incident mask),
`causeKeyOf` (one cause) and `engineVerdict` (`ok`, `warning` or `critical`, by thresholds you
pass), so the CLI's `status`, `engine_status` and the cockpit count one cause alike and judge an
engine by one rule.
Pulse for VS Code bundles it in its C7 adapter: an instance's panel reads the instance through
`loadInstance`.
It is the shared domain of every Pulse interface to this API family, so an MCP tool and a CLI
command answer the same question by the same rules.

One port per API family: the vendors differ in runtime configuration, never in this package.

## What it is not

No HTTP and no authentication. Its one runtime dependency is
[@miragon/pulse-engine-core](https://www.npmjs.com/package/@miragon/pulse-engine-core), the
engine family's core and the contract every engine dialect implements, whose rules it applies (the
root cause of a failure text, `RootCauses`); it imports nothing else but its own modules. It names
no command, flag or tool: next steps are structured (`{ action: "retry", processInstanceId }`),
errors are `WorkflowError`s with a `reason` (`{ kind: "selection-ambiguous", candidates, more }`),
and the caller words both. The English texts that describe the engine's state are the package's
and shared by every caller: the finding messages of the status triage, its truncation notes and
the summaries of planned writes (`execute job j1`).

## Install

```sh
npm install @miragon/pulse-c7-core
```

## The API in brief

- **Port:** `createEnginePort(transport)` turns your `EngineTransport` (send an operation by its
  REST operation id, read an answer as JSON or text, read an engine failure) into the
  `EnginePort` the workflows run on, with the shared read rules: pages of 500, a missing resource
  as undefined, blank texts as undefined. A missing resource is an engine 404 whose exception type
  is neither `NotFoundException` (no such endpoint, a wrong REST root) nor `QueryParamException`,
  so your `failure` reading must carry the engine's `engineType`: without it a missing instance
  fails instead of reading as missing. `isMissing(failure)` is that rule on its own, the one
  missing-resource rule of the family: the MCP server, the CLI and the VS Code extension read
  every 404 through it, so a wrong REST root fails loud instead of reading as "none".
  `isUnknownEndpoint(failure)`, on which it builds, tells a 404 that is no engine answer (no
  exception type, or `NotFoundException`), for a hint to check the REST root.
- **Inspect:** `inspectInstance(port, selection, options)` selects an instance by id, by business
  key or by key with `latest`, and loads its view: wait states with their ids, root-cause
  incidents, called instances, optionally variables, the history timeline and stacktraces (cut
  after `MAX_STACKTRACE_LINES` lines).
- **Status:** `readStatus({ port, now }, options)` triages one engine: findings with severity, the
  overall status, definitions, incident groups with their root cause, topics, jobs and batches,
  every cut named in `truncated`.
- **Plans:** the pure parts of retry (`planRetry`, `retriesWrite`), advance (`chooseWait`,
  `advanceSteps`) and wait (`parseCondition`, `decide`, `poll`).
- **Routes:** the route of each operation of the REST API, generated from the one spec (below):
  method, path template, effect (`read`, `write`, `delete`, `bulk`), whether a named engine
  (`/engine/{name}`) serves it and the media types of its answers. `CORE_ROUTES` holds what this
  package sends, reads only (a plan's writes are yours to send); `@miragon/pulse-c7-core/routes`
  exports `ROUTES`, all 399, as an entry of its own, so a bundle that needs only the core's carries
  no more. `routeOf(routes, method, path)` finds a request's route (a literal segment wins over a
  placeholder from the left: `GET /process-instance/count` is no instance id),
  `intentOf(route, method)` says whether it only reads (a `POST` query or evaluation does; a
  request no route knows reads only as `GET` or `HEAD`), and `routedTransport(routes, wire)` is an
  `EngineTransport` that sends each operation as its route over your `RoutedWire` (refusing one the
  table lacks or the wrong number of path values before anything is sent).
  `failureOf(status, problem)` is the engine failure of an error answer: the status and the
  exception type, message and code its body states (`problemOf` of @miragon/pulse-http reads them).
- **Engine REST rules:** the one home of what the engine expects other than what a caller
  naturally sends: dates (`toEngineDate`, `engineDateInput` in a `DateInputReading`:
  `OFFSET_REQUIRED` refuses a time without an offset, `UTC_WITHOUT_OFFSET` reads it as UTC;
  `engineDateMillis`, `latestEngineDate`), true-only and `…Like` filters (`trueOnly`,
  `complementaryFlags`, `engineLike`, `engineKeyList`, `engineInstanceSearch`), paired sorting
  (`engineSorting`), variable writes and typing (`toEngineVariable(s)`, `autoTypedValue`),
  incident recovery (`incidentRecovery`), the raw variable read flag (`RAW_VARIABLES`, and
  `RAW_VARIABLES_QUERY`, its text form for a port's query), the history timeline of activity rows
  (`timelineOf`) and the cause of a failure (`causeOf(text, fallback)`: the root cause of a stack
  trace or error details by engine-core's `RootCauses.of`, else the fallback, such as the
  incident's message).

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

## The spec and the route table

`spec/api.json` is the one OpenAPI spec of the Camunda 7 REST API in Pulse, Operaton's (from
operaton-mcp's `operaton-rest-api.json`), vendored as it is; the same 399 operations as CIB seven's
and Camunda 7's, which differ in descriptions, in the name of a task's form reference
(`operatonFormRef`, `camundaFormRef`) and in `TelemetryInternalsDto`. `spec/patches.json` corrects
it with RFC 6902 patches: bodies and parameters the engines read otherwise, and the form reference
under both names. This package's `generate` (turbo runs it before every build;
`packages/connectors/c7/c7-core/scripts/generate-routes.ts`) applies them
(`packages/connectors/c7/c7-core/scripts/patches.ts`) and writes the patched spec (under
`spec/patched/`, ignored by git) and, from it, `src/generated/routes.json` and
`src/generated/core-routes.json`, with the effect rule in
`packages/connectors/c7/c7-core/scripts/effects.ts`. @miragon/pulse-c7-client's `generate`
(hey-api) writes its SDK from the patched spec, and the CLI's `catalog` its commands, each effect
taken from the route table. Neither the spec nor the generator ships: the package carries the two
tables only.

## Testing helpers

`@miragon/pulse-c7-core/testing` exports the verified workflow fixture, the status fixture,
wait states of every kind, `fakePort` (a recording port over canned answers that refuses any
operation without a route) and `fakeClock`. It also exports the rules behind the entry's
functions that tests reach directly, and `INSPECT_OPERATIONS` and `STATUS_OPERATIONS`, the
operations each composite sends: a port that maps operations one by one holds its table equal to
them in a test.
