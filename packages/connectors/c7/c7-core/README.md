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
  called instances, optionally variables, the history timeline (read whole, by POST in
  `INSTANCE_HISTORY_ORDER`) and stacktraces (cut after `MAX_STACKTRACE_LINES` lines).
- **Status:** `readStatus({ port, now }, options)` triages one engine: findings with severity, the
  overall status, definitions, incident groups with their root cause, topics, jobs and batches (the
  running ones and those with failed jobs counted, `/batch/statistics/count`, a count it cannot read
  failing as the reason `unexpected-answer`; the first 100 with failed jobs listed for their
  findings, cut only when that page is full and the engine counts more), every cut named in
  `truncated`. `engineVerdict` judges an engine `ok`, `warning` or `critical` by thresholds you
  pass, over its open root incidents: `rootIncidentCounts` takes the processes' from the statistics
  with `rootIncidents=true` and, of the open incidents read, those outside any process and the
  largest cause over root incidents alone, so a chain of calls one failure stops counts it once
  (`readStatus` names the basis `rootIncidentsTotal` beside `incidentsTotal`, every open incident);
  `messageSignature` (the incident mask) and `causeKeyOf` (one cause) group incidents alike
  everywhere. The triage reads the newest 2,000 open incidents of its scope, a copy in a calling
  instance too (`propagated`), in pages of `TiedPages` walked by their cursors
  (`packages/connectors/c7/c7-core/src/status-incidents.ts`, which also holds the incidents' order
  and tie rule the incident pages below read by): newest first, then by id, every run of up to 500
  incidents raised at one instant read whole within one request, no request for more than 500 rows.
  A page takes all the cap leaves, in windows of 500 rows, each from the last run of the one before:
  five requests for 2,001 incidents and more where those runs hold 499 rows or fewer in all, as on
  the engines measured (up to 6 incidents in one millisecond), at most 10 a page. Every request
  after the first is bounded by `incidentTimestampBefore` a millisecond after the first answer's
  newest incident (strictly before, on both engines), so incidents raised during the walk shift none
  of its offsets, and an incident the walk already holds is never listed again, so each counts once,
  a longer run's too (which keeps the engine's order at plain offsets, as the incident pages below
  say, and may miss some where the database orders it anew). An answer with more rows than it asked
  for (an engine that ignores the paging) ends the walk with that list, as `port.list` does.
- **Definition statistics:** `readDefinitionStatistics(port, { failedJobs })` is the one read of
  `/process-definition/statistics` with `rootIncidents=true` (each version's failed jobs on
  request), `definitionStatisticsOf(answer)` its one parse and `statisticsByKey(rows, type?)` its
  one fold per process key: the latest version by its version number (the first listed of equal
  ones), the sums over every version, the open root incidents per type (of one type where one is
  named) and the versions that hold one. The status triage's definitions, the runtime's
  `DefinitionReader` and the MCP server's overview, incidents dashboard and process incidents take
  a key's numbers from it, so a key counts the same on every surface. An answer it cannot read
  fails (`RuntimeError("unexpectedResponse")`, in the status triage the reason
  `unexpected-answer`), never as a row left out or put under a guessed key. A key sums over the
  versions of every tenant.
- **With incident:** one reading of "an instance with an incident" for every caller: an open
  incident the runtime holds now, which every history level answers alike (`WITH_INCIDENT`, the
  runtime's process-instance filter, and `withIncidentBody(flag)`, its typed form for a search
  body or the SDK's typed query, which never sends a false flag the engine would ignore).
  `instancesWithIncident(port, scope)` lists the instances of a version, a process or a business
  key with one, `countWithIncident` counts them, `withIncidentAmong(port, ids)` flags listed
  instances and `withIncidentByVersion` counts per version; the runtime's `InstanceSearch` pages
  the history's rows of those instances and counts them in one runtime count where the runtime
  knows the whole filter; however many there are, no request to the history carries more than 500
  of their ids. The history's incident filters find nothing below history level FULL, which
  writes no incident to the history: `unrecordedIncidents(port)` tells that from a true "none"
  before a history query by incident answers.
- **Instance search:** `searchedInstances(filters, term)` builds the bodies of the runtime's
  process-instance query (POST, and its count) for a search box, a business key fragment OR a whole
  instance id, beside the scope and the true-only flags. The engine drops `withIncident` beside the
  OR query (`orQueries`) such a search needs in one body, and answers every match (Operaton 2.1.5,
  CIB seven 2.2.0 and 3.0.0), while no incident field beside it reads every open incident; so with
  the flag the search goes out as two top-level halves, the business key and the id, which names at
  most one instance. `countSearchedInstances` counts the halves less their overlap, never below 0
  (three requests, each in its own transaction), and `pageSearchedInstances` pages the business key
  half with the id half's instance where the engine sorts it, both over the caller's
  `InstanceBodyReads`; every other search stays one OR body. No caller joins the flag and an OR
  query itself.
- **Plans:** the pure parts of retry (`planRetry`, `retriesWrite`), advance (`chooseWait`,
  `advanceSteps`) and wait (`parseCondition`, `decide`, `poll`).
- **Migration planning:** `definitionsAtVersion`, `proposeMigrationPlan`, `checkMigrationPlan`,
  `migrationInstructions`, the one home of a migration plan's requests and bodies.
  `definitionsAtVersion(port, key, version)` reads the definitions of a process at a version
  number, or at its latest version (`"latest"`), every tenant's, at most 10, `more` when there are
  more; `definitionsAtVersionRequest` is the request it sends, for a preview.
  `proposeMigrationPlan(port, source, target)` lets the engine generate its plan between two
  definitions and keeps the instructions of one source and one target activity, counting the
  others in `leftOut`; `checkMigrationPlan(port, plan)` has the engine validate a plan, each
  problem with its mapping where it names one. Both are `POST`s that only read and change no event
  trigger, and `migrationInstructions(mappings)` is the instructions they and a migration send (one
  activity a side, `updateEventTrigger: false`). An answer these rules cannot read fails as the
  `WorkflowError` reason `unexpected-answer` (the operation id and what is wrong in the answer,
  `instructions is not a list`), so a caller words it as it words every reason and never as its
  own bug; the contract's `MigrationReader` reads through the same rules and fails such an answer
  as `RuntimeError("unexpectedResponse")`, as every read of `./runtime` does.
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
  error, your wire's, becomes the `RuntimeError` your `failureOf` words. Where your surface keeps
  the diagrams it read, hand that read in as `diagramXml` (a version's XML, undefined for a version
  the engine does not know): every read of a diagram goes through it (`getDiagramXml`, the calls of a
  version, the call activities of its element statistics; the MCP server's one XML cache), else over
  your port. It asks one reader per
  question: `EngineReader` (the product and version telemetry names, else the REST API's version),
  `DefinitionReader` (every process by its latest version, its versions newest first, each with its
  running instances, those "with incident" and its open root incidents, from the one statistics
  read and its fold per key, a version's BPMN XML), `ElementStatisticsReader` (per
  element of a version the waiting tokens, the incidents raised there and those of called
  instances: the statistics with every incident at an element, root incidents wherever no copy can
  lie, and the incidents at the version's call activities that hold one read whole, sorted by id,
  to tell the root incidents from the copies Camunda 7 keeps there; the call activities from the
  version's diagram, kept per reader; every incident of the version where they cannot be told or
  one read takes fewer requests and less than a page of rows beyond theirs; each count on an
  element of the diagram, as Camunda 8 reports it: a multi-instance body's token, failed jobs and
  incidents, which Camunda 7 counts apart, only while its own token waits there, on the activity
  it repeats), `CalledProcessReader` (each call activity of a version with the version its binding
  starts), `InstanceSearch` (the history's instances newest first, paged by offset behind the
  contract's cursor, each flagged with "with incident", and their count; a variable condition's
  value as the engine reads it, every integer beyond 2^53 in it digit for digit; without an
  incident it counts the history's instances minus those of them the runtime holds an open incident
  for, the history's count of the runtime's ids, so the count is what the search lists and never
  below 0; at history level NONE, whose history holds no instance, it finds none and counts 0, the
  runtime's count with an incident where the runtime knows the filter whole; an id list longer
  than 500 goes to the history in chunks of 500, each id once, its count the sum of theirs, its
  page the merge of each chunk's rows up to the page's end, newest first and then by id, so a page
  takes one request per chunk; `historyIdChunk` of `C7RuntimeOptions` sets a smaller chunk, with
  which the C7 adapter's engine suite runs the instance laws once more and pages six ids by one,
  three per request: the first page of one asks each chunk for two of its three rows, as a page of
  50 asks a chunk of 500 for 51),
  `VariableNameReader` (the variable names of a version's newest 50 instances),
  `InstanceDetailReader` (an instance's detail: `loadInstance`'s rounds without history and its path
  from the history, read whole in `INSTANCE_HISTORY_ORDER`, in parallel with its typed variables
  of every scope, which the inspection's
  variable map stands in for when they cannot be read, then the version of each called instance one
  of its root incidents was raised in, as the runtime lists it while that instance runs and else from
  the history, which holds no instance at history level NONE or after its cleanup; its wait states
  and root incidents at the element of the diagram, a multi-instance body's at the activity it
  repeats; each value as `JSON.stringify` writes it, so an integer the wire kept as raw JSON keeps
  its digits; beyond the contract, `getInstanceDetailWithCauses` gives the same detail with each root
  incident's cause as the cockpit's cause view takes it, `causeKeyOf` over the incident as the
  engine names it, a body's by its own id), `IncidentSearch` (the root incidents newest first, then by
  id, across pages too, since up to 500 incident rows raised at one instant are read whole, copies
  and the other rows it drops counted, with the version each was raised in, the element of the
  diagram, a multi-instance body's incident on its activity, and the job or external task
  `incidentRecovery` names; an incident outside any process, a failed job of a batch or of the
  history cleanup, which names no element and no instance, is none of them and never fails the
  search),
  `IncidentDetailsReader` (the stack trace or error details `CAUSE_OPERATIONS` names, else the
  incident's message, with the root cause by engine-core's `RootCauses`), `BulkOperationReader` (a
  batch that cancels or migrates instances from its statistics while the runtime holds it, else from
  the history, counted in items; the failures of a running one from its jobs without retries, at
  most 100, each reason on one line and cut to 300 characters, with the instance it names) and
  `MigrationReader` (the plan the engine generates between two versions and its check of one, over
  the migration planning rules: `POST`s that change no event trigger; a mapping is one source and
  one target activity). A
  by-id read of something the engine does not know answers undefined (an engine 404 that names it,
  or a 500 `NullValueException`, as `inspect` reads an instance that ended); a list is read page by
  page until a shorter page, and an answer that is no list fails. A page of the instances without an
  incident and a page of incidents drop rows of the engine's answer (an instance the runtime flags;
  an incident copied up from a called instance, without its element or instance or of a version the
  engine does not list), so they fill: after the page and one row more they read further windows from where the
  last one ended, each twice the last up to 500 rows, at most 10 windows in all, the first included,
  while they keep fewer rows than that. Up to that bound a page holds its limit while more follow,
  and its cursor is the engine offset of the next kept row, so a dropped row is not read again;
  after the tenth window it is the first row not read, so a page where nearly every row drops (deep
  call chains, a backlog mostly with incidents) may be short, even empty, but no kept row is
  skipped. The instances without an incident ask the flags of every running row of each window (an
  ended instance holds no open incident; at limit 50 one request more, for the 51st), and their cut
  is in the engine's order. `GET /incident` sorts by the time alone, so a page of incidents reads
  every run of up to 500 raised in the same millisecond whole and orders it by id (`TiedPages`,
  `packages/connectors/c7/c7-core/src/tied-pages.ts`): its first window holds the page and two rows
  more, a full window's last run is read again at the next one's start, and its cursor names where a
  run starts and how many of its incidents came before (`<offset>.<skip>`). A run counts every
  incident row the filter matches at that instant, the copies in calling instances and the other
  rows the search drops included, not the root incidents alone. No request asks for more than 500
  rows: a run that fills a window of 500 is told from a longer one by the one row after it, so a run
  of exactly 500 is still read whole. That row counts as one of the 10 windows, so a page asks
  `GET /incident` at most 10 times; where none is left for it, the page ends before that run and the
  next page reads it again. A run of more than 500 is never read whole: its incidents keep the
  engine's order at plain offsets, as the instances do, a cursor into it says so (`<offset>~`), and
  the next page reads on from there with the page and two rows more. A page that stops at the bound
  of 10 requests inside such a run ends at a bare offset instead, and the next page reads the rest
  of the run from there as a run of its own: a rest of more than 500 rows it tells by the one row
  after a window of 500 and pages at plain offsets, a rest of 500 rows or fewer it reads whole and
  orders by id. Where the database orders such a run anew between two requests, its incidents may
  repeat and about as many be missed, even within one page, up to most of the run; the incidents
  raised before or after it never. Beyond the contract, `searchElementRootIncidents` pages the open
  root incidents at one element over every version of a process (`{ bpmnProcessId, elementId }`),
  for the MCP server's page of an activity's incidents: those raised at the element and at its
  multi-instance body, which Camunda 7 lists under an id of its own, each list paged by `TiedPages`
  from a place of its own and the two merged newest first and then by id, each row as the engine
  answers it (`ElementIncident`), a copy a call activity holds no row. Its cursor names where each
  list goes on, `<element>,<body>`, a cursor of `TiedPages` or `-` past the list's end, so each
  incident of either list comes once, across pages too, with the bound above; a page ends before
  the incidents of a list whose page stopped at its 10 requests, short or even empty, and the next
  page reads on there. `TiedPages` hands each item of a page the cursor of a page that starts with
  it (`cursoredPageOf`), which the merge goes on from. The readers stay inside the entry; beside
  `C7Runtime` it exports the reads a surface's commands check before they write:
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
  `complementaryFlags`, `engineLike`, `engineKeyList`), paired sorting
  (`engineSorting`), the one order of an instance's history (`INSTANCE_HISTORY_ORDER`, the
  `sorting` of `POST /history/activity-instance`: by start, then by occurrence, then by id, a
  total order, so pages cut by offset neither repeat nor skip a step of parallel branches or of a
  multi-instance's items, which start within a millisecond; the CLI's `inspect --history`, an
  instance's detail and the engine module's cockpit history read it, and `historySorting` puts a
  caller's sort key before it, so the ties of any key page alike), variable writes and typing
  (`toEngineVariable(s)`, which refuses a value that
  is or holds a number that is not finite, since JSON would carry it as null; `autoTypedValue`),
  incident recovery (`incidentRecovery`, over `BUILT_IN_INCIDENT_TYPES`, the two types the engine
  raises itself), the root incident (`isRootIncident`, and `rootIdOfCopy`, the root incident a
  copy stands for: Camunda 7 copies an incident of a called instance up its call chain, each copy
  naming its root in `rootCauseIncidentId`; one without that field is a root, the one reading of
  the status triage, the inspection, the retry plan, the runtime, the engine module and the C7
  adapter), the multi-instance body (`isMultiInstanceBody`, `elementOfActivity`,
  `multiInstanceBodyOf`: Camunda 7 names the scope a multi-instance activity runs its items in by
  the activity's id with `#multiInstanceBody`, the diagram the activity alone. The rule: a count,
  a group or a badge of an element, and the contract's `elementId` (the runtime's element counts,
  incident search and variable scopes), put the body on its element, as the CLI's `--until` check
  does (the throughput counts the items' passes alone); a row or a cause the engine module keys on
  the engine's id, of one failure (an incident, a job, a copy's root) or of a cluster read and
  fixed by that id (the incidents dashboard rows, the health causes, the cluster detail), keeps
  the body's own id and is named by its element; a read or a write that needs the body's own id
  (an element's page of incidents, the C7 adapter's move) names it. An instance's detail puts its
  wait states and root incidents on the element too, so its screens mark and name them there, while
  each root incident's cause keeps the body's own id (`getInstanceDetailWithCauses`). Outside the
  rule, an instance's path keeps the body's run under its own id beside its items' runs, which name
  the element, since the editors' move rules count an element's unfinished runs as its tokens, and
  an incident's own element in its detail names and marks the body by its own id), the raw variable read
  flag (`RAW_VARIABLES`, and `RAW_VARIABLES_QUERY` for a port's query), the history timeline
  (`timelineOf`), the request that holds an incident's cause (`CAUSE_OPERATIONS`, an operation id
  per built-in type) and the cause of a failure (`causeOf(text, fallback)`: the root cause of a
  stack trace or error details by engine-core's `RootCauses.of`, else the fallback, such as the
  incident's message).

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
  `withIncidentBody`, sends the list's search and its chips as `searchedInstances` and checks a
  history query by incident with `unrecordedIncidents`. Its
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
without a route), `turningTies` (a route that answers a list's window over rows in the engine's
order, every run of rows its one sort key cannot tell apart turned one place further on each
request, as a database may order them anew; `turnTies` turns them once) and `fakeClock`. It also
exports the rules behind the entry's functions that tests reach directly, and `INSPECT_OPERATIONS`,
`STATUS_OPERATIONS`, `WITH_INCIDENT_OPERATIONS` and `RUNTIME_OPERATIONS`, the operations each
composite and the runtime's readers send: a port that maps operations one by one holds its table
equal to them in a test.

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
decoded path, query and JSON body, and the JSON answered), recorded from the seeded world on
Operaton 2.1.5 (made anew on 2026-11-21, when the element statistics read the incidents at call
activities alone, and again that day, when the definitions read their root incidents; on
2026-11-25 its incidents' request asks 52 rows rather than 51, which the three it answers do not
change), and the board they give in the JSON form of
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
in their JSON form: the engine screen (`expected.engine`, `EngineScreenData`); the instance
screens (`InstanceScreenData`) of DSP-3001, which waits at its call activity for the root incident
of the instance it called (`expected.instance`), and of that called instance, which holds it
(`expected.calledInstance`); the process screens (`ProcessScreenData`) of pulse-order at its
latest version (`expected.process`) and at its version 1 (`expected.olderVersion`) and of
pulse-dispatch (`expected.callingProcess`); and the first page of every instance of pulse-order's
version 1 with the counts of each scope (`expected.instanceList`, `InstanceListData`). The editors'
C7 adapter and the MCP server's SDK wire build each exactly. Its answers come from one run of their
own, recorded by hand on 2026-11-20 as the board's, made anew with the process screens and the
instance list, again on 2026-11-21, when the element statistics read the incidents at call
activities alone, and once more that day, when the definitions read their root incidents, and on
2026-11-27, when the paths of DSP-3001 and of the instance it called are asked for by
`POST /history/activity-instance` in `INSTANCE_HISTORY_ORDER`: the world seeded
with `seedC7World` into `operaton/operaton:2.1.5` at history level FULL, every screen built twice
through a proxy in front of the engine that keeps each request with what the engine answers (the
same answer both times but for the telemetry, which counts the engine's commands and keeps its
first), and once more over the kept answers on `startRecordedEngine`, with no request unanswered.
The engine connector's engine suite holds that a world seeded on CIB seven or Operaton answers
those two paths in the recorded order.
So every id they name is that engine's, and every screen built over them reads the same instances
and versions; one that reads more is recorded again with the others
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
