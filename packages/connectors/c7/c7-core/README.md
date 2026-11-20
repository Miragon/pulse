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
(`RootCauses`) it applies and whose `ProcessRuntime` reads its `./runtime` entry answers.

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
- **With incident:** one reading of "an instance with an incident" for every caller: an open
  incident the runtime holds now, which every history level answers alike (`WITH_INCIDENT`, the
  runtime's process-instance filter, and `withIncidentBody(flag)`, its typed form for a search
  body or the SDK's typed query, which never sends a false flag the engine would ignore).
  `instancesWithIncident(port, scope)` lists the instances of a version, a process or a business
  key with one, `countWithIncident` counts them, `withIncidentAmong(port, ids)` flags listed
  instances and `withIncidentByVersion` counts per version; the runtime's `InstanceSearch` pages
  the history's rows of those instances and counts them in one runtime count where the runtime
  knows the whole filter. The history's incident filters find nothing below history level FULL,
  which writes no incident to the history: `unrecordedIncidents(port)` tells that from a true
  "none" before a history query by incident answers.
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
- **Runtime:** `@miragon/pulse-c7-core/runtime`, an entry of its own, holds the reads of
  engine-core's `ProcessRuntime` over your port, for a surface that implements that contract:
  `C7Runtime.over(port, { failureOf })` answers every one of them (it refuses no variable
  condition); a failure c7-core words itself is a `RuntimeError` and passes as it is, every other
  error, your wire's, becomes the `RuntimeError` your `failureOf` words. It asks one reader per
  question: `EngineReader` (the product and version telemetry names, else the REST API's version),
  `DefinitionReader` (every process by its latest version, its versions newest first, each with its
  running instances and those "with incident", a version's BPMN XML), `ElementStatisticsReader` (per
  element of a version the waiting tokens, the incidents raised there and those of called
  instances), `CalledProcessReader` (each call activity of a version with the version its binding
  starts), `InstanceSearch` (the history's instances newest first, paged by offset behind the
  contract's cursor, each flagged with "with incident", and their count; a variable condition's
  value as the engine reads it, every integer beyond 2^53 in it digit for digit; at history level
  NONE, whose history holds no instance, it finds none and counts 0 where the history answers, the
  runtime's count with an incident and below 0 without one, a known defect),
  `VariableNameReader` (the variable names of a version's newest 50 instances),
  `InstanceDetailReader` (an instance's detail: `loadInstance`'s rounds without history and its path
  from the history, in parallel with its typed variables of every scope, which the inspection's
  variable map stands in for when they cannot be read, then the version of each called instance one
  of its root incidents was raised in; each value as `JSON.stringify` writes it, so an integer the
  wire kept as raw JSON keeps its digits), `IncidentSearch` (the root incidents newest first, then by
  id, with the version each was raised in and the job or external task `incidentRecovery` names),
  `IncidentDetailsReader` (the stack trace or error details `CAUSE_OPERATIONS` names, else the
  incident's message, with the root cause by engine-core's `RootCauses`), `BulkOperationReader` (a
  batch that cancels or migrates instances from its statistics while the runtime holds it, else from
  the history, counted in items; the failures of a running one from its jobs without retries, at
  most 100, each reason on one line and cut to 300 characters, with the instance it names) and
  `MigrationReader` (the plan the engine generates between two versions and its check of one,
  reading `POST`s that change no event trigger; a mapping is one source and one target activity). A
  by-id read of something the engine does not know answers undefined (an engine 404 that names it,
  or a 500 `NullValueException`, as `inspect` reads an instance that ended); a list is read page by
  page until a shorter page, and an answer that is no list fails. A page of the instances without an
  incident and a page of incidents drop rows of the engine's answer (an instance the runtime flags;
  an incident copied up from a called instance, without its instance or of a version the engine does
  not list), so they fill: after the page and one row more they read further windows from where the
  last one ended, each twice the last up to 500 rows, at most 10 windows in all, the first included,
  while they keep fewer rows than that. Up to that bound a page holds its limit while more follow,
  and its cursor is the engine offset of the next kept row, so a dropped row is not read again;
  after the tenth window it is the first row not read, so a page where nearly every row drops (deep
  call chains, a backlog mostly with incidents) may be short, even empty, but no kept row is
  skipped. The instances without an incident ask the flags of every running row of each window (an
  ended instance holds no open incident; at limit 50 one request more, for the 51st). The cut is in
  the engine's order, and only the page returned is sorted: `GET /incident` sorts by the time alone,
  so of two kept incidents raised in the same millisecond at a page's boundary one may repeat or be
  skipped if the database orders them differently between two reads. The readers stay inside the
  entry; beside `C7Runtime` it exports the reads a surface's commands check before they write:
  `findActivityTree` (the activity instance tree of a running instance, its scopes and transition
  instances, a move's token among them; none for an instance that does not run or an id no engine
  assigns, without a request), `readHistoricInstances` (the history's instances a query finds, newest
  first, so a migration submits only those that still run), `readBatchStatistics` and
  `findHistoricBatch` (a batch while the runtime holds it, else from the history, for a Stop). The
  history's instance query, the variable names and the migration plan and its check are `POST`s
  that only read: your transport sends a route by its method, the body as JSON.
  `JsonView` reads an engine answer with checks: `JsonView.of(answer, "incident")` is the object,
  `requiredString("id")`, `optionalNumber("version")`, `optionalList("children")` and the like read
  its values as the engine documents them, and an answer of another shape fails as
  `RuntimeError("unexpectedResponse")` in words that name what was wrong (`id is missing`,
  `incidents[1] is not an object`); an integer the caller kept as raw JSON (`JSON.rawJSON`, beyond
  2^53) is a value, never an object. `isEngineId(value)` is the one id rule of the family (a letter,
  digit or underscore, then word characters, dots, colons and hyphens), so an id that would change a
  path or a query is refused before a request leaves; a read of the entry fails one as
  `RuntimeError("misconfigured")` or reads it as none.
- **Engine REST rules:** dates (`toEngineDate`, `engineDateInput` in a `DateInputReading`:
  `OFFSET_REQUIRED` refuses a time without an offset, `UTC_WITHOUT_OFFSET` reads it as UTC;
  `engineDateMillis`, `latestEngineDate`), true-only and `…Like` filters (`trueOnly`,
  `complementaryFlags`, `engineLike`, `engineKeyList`, `engineInstanceSearch`), paired sorting
  (`engineSorting`), variable writes and typing (`toEngineVariable(s)`, which refuses a value that
  is or holds a number that is not finite, since JSON would carry it as null; `autoTypedValue`),
  incident recovery (`incidentRecovery`, over `BUILT_IN_INCIDENT_TYPES`, the two types the engine
  raises itself), the root incident (`isRootIncident`, and `rootIdOfCopy`, the root incident a
  copy stands for: Camunda 7 copies an incident of a called instance up its call chain, each copy
  naming its root in `rootCauseIncidentId`; one without that field is a root, the one reading of
  the status triage, the inspection, the retry plan, the runtime, the engine module and the C7
  adapter), the raw variable read flag (`RAW_VARIABLES`, and `RAW_VARIABLES_QUERY` for a
  port's query), the history timeline (`timelineOf`), the request that holds an incident's cause
  (`CAUSE_OPERATIONS`, an operation id per built-in type) and the cause of a failure
  (`causeOf(text, fallback)`: the root cause of a stack trace or error details by engine-core's
  `RootCauses.of`, else the fallback, such as the incident's message).

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
  `engine_inspect_process_instance` and `engine_status`, builds its cockpit's failure clusters
  and health verdict from the same rules, flags its instance rows with `withIncidentAmong`, takes
  the filter of its instance list, its scope counts and `engine_list_process_instances` from
  `withIncidentBody` and checks a history query by incident with `unrecordedIncidents`. Its
  engine suite runs `C7Runtime` over the server's own wire, the generated SDK through its engine
  port, against the conformance kit's read laws on real engines; no tool runs the runtime. On that
  wire an integer beyond 2^53 arrives as a string of its exact digits, so `InstanceDetailReader`
  writes such a variable's value as a JSON string there, where the adapter's wire keeps it a
  number; no read law reads one.
- Pulse for VS Code and Pulse for Orca bundle it in their C7 adapter: its `C7Runtime` answers
  every read of the engine contract over the adapter's wire, whose failures the adapter words (an
  instance's panel through `loadInstance`), its commands read what they check before a write
  over the same port (a move's token with `findActivityTree`, a migration's running instances with
  `readHistoricInstances`, a Stop's batch with `readBatchStatistics` and `findHistoricBatch`), the
  adapter reads every answer of its writes through `JsonView` and checks every id it writes with
  `isEngineId`, an incident's retry and the incident list take
  its job or external task from `incidentRecovery`, its details their request from
  `CAUSE_OPERATIONS`; a variable change without a type that is no JSON string, object or array is
  typed by `autoTypedValue`, every change is sent in the form of `toEngineVariable`, and every "with
  incident" (a process's and a version's count, an instance list's scope and its rows' flags) is the
  runtime's of `with-incident.ts`.

## Testing helpers

`@miragon/pulse-c7-core/testing` exports the verified workflow fixture, the status fixture, wait
states of every kind, `fakePort` (a recording port over canned answers that refuses any operation
without a route) and `fakeClock`. It also exports the rules behind the entry's functions that
tests reach directly, and `INSPECT_OPERATIONS`, `STATUS_OPERATIONS`, `WITH_INCIDENT_OPERATIONS`
and `RUNTIME_OPERATIONS`, the operations each composite and the runtime's readers send: a port that
maps operations one by one holds its table equal to them in a test.

`seedC7World` and `seedC7CommandWorld` seed the conformance world of
`@miragon/pulse-engine-core/testing` into a Camunda 7 engine of the family over its REST API: they
take the engine's REST root, a fetch-shaped `send` (`fetch` itself fits), a `wait` between polls,
the world's plan (engine-core's `WORLD_*` values fit its types as they are) and the diagram text of
each process, and answer the engine's ids as plain strings, which your harness brands into
engine-core's `SeededWorld` and `CommandWorld`; its unknown ids are fixed. The world's diagrams are
files of the repository, not of the package:
[`packages/connectors/c7/c7-core/world/`](https://github.com/Miragon/pulse/tree/main/packages/connectors/c7/c7-core/world).

`C7_BOARD_ENGINE` is a board and a model: the text of a board file over one engine with every
widget and a refused one, that engine's answers to the board's reads (`C7RecordedAnswer`: method,
decoded path, query and JSON body, and the JSON answered), recorded once from the seeded world on
Operaton 2.1.5, and the board they give in the JSON form of
[`@miragon/pulse-board`](https://www.npmjs.com/package/@miragon/pulse-board) (`BoardData`). It
ships here because this package makes the requests: the MCP server's engine connector and the
editors' C7 adapter each serve the answers to their own wire on the transport's recorded engine
(`startRecordedEngine` of `@miragon/pulse-http/testing/loopback`) and must build exactly that board,
so a board shows the same numbers on every surface without an engine. A request the runtime changes
misses its answer and is named. No script of the repository records the answers, so they are
recorded by hand, as they were the first time: seed the world with `seedC7World` into
`operaton/operaton:2.1.5` at history level FULL, let both wires build the board through a proxy in
front of the engine that keeps each request (method, decoded path, query and JSON body) with the
JSON the engine answers, check that both build the same board, and write the board file, the answers
and that board into `packages/connectors/c7/c7-core/src/testing/board-engine.json`.

`C7_SCREEN_ENGINE` is the same for the screens Pulse's surfaces share
([`@miragon/pulse-screens`](https://www.npmjs.com/package/@miragon/pulse-screens)): one engine's
answers to the screens' reads, the time a surface builds them at (`asOf`) and the screens they give
in their JSON form: the engine screen (`expected.engine`, `EngineScreenData`) and the instance
screens (`InstanceScreenData`) of DSP-3001, which waits at its call activity for the root incident
of the instance it called (`expected.instance`), and of that called instance, which holds it
(`expected.calledInstance`). The editors' C7 adapter builds each exactly over its wire. Its answers
come from one run of their own, recorded by hand on 2026-11-20 as the board's: the world seeded
with `seedC7World` into `operaton/operaton:2.1.5` at history level FULL, every screen built twice
through a proxy in front of the engine that keeps each request with what the engine answers (the
same answer both times but for the telemetry, which counts the engine's commands and keeps its
first), and once more over the kept answers on `startRecordedEngine`, with no request unanswered.
So every id they name is that engine's, and a screen built over them later (a process, an instance
list) reads the same instances and versions; one that reads more is recorded again with the others
in one run, never joined from another recording, whose ids are another engine's (`C7_BOARD_ENGINE`
is a run of its own). An answer that is no JSON (a job's stack trace) keeps its text and content type
(`C7RecordedAnswer`).

## Help and feedback

- **Documentation:** the Pulse servers, CLI and modules built on these rules are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the spec, its patches and the route table are generated and refreshed is in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
