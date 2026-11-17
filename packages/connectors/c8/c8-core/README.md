# @miragon/pulse-c8-core

The core of Pulse's Camunda 8 dialect family: the reads of a Camunda 8 cluster (8.9 and newer,
SaaS and Self-Managed) through the Orchestration Cluster REST API (`/v2`), mapped onto the read
models of `@miragon/pulse-engine-core`, the engine contract every dialect implements. It reads and
never writes. Two surfaces run it, each over its own wire on `@miragon/pulse-http` and in its own
words: the C8 adapter of the editor hosts (`packages/connectors/c8/c8-adapter`) and the MCP
server's engine module (`@miragon/pulse-engine-connector`, whose `src/lib/engine` alone imports
it), which is why it is published. Below 1.0, pin the exact version and update all
`@miragon/pulse-*` packages together.

Thomas Heinrichs wrote these readers, the REST client and its query rules, the runtime and the
translation of its failures for Pulse for VS Code in
[#543 feat(vscode): read Camunda 8 on SaaS and Self-Managed](https://github.com/Miragon/pulse/pull/543);
they left the C8 adapter for this package so that every surface that reads Camunda 8 runs the same
reads and gives one failure the same kind.

## What it holds

- **The runtime (`C8Runtime`).** `C8Runtime.over(transport, { wordsOf })` answers the engine
  contract's `ProcessRuntime` read-only over a surface's transport: the version floor (8.9) before
  every question, then the question's reader; `refusedVariableConditions()` names `ordering` and
  `date`, no migration planning, no bulk operation. A failure becomes a `RuntimeError`: one of
  c8-core's own (the floor, a refused condition) passes as it is, any other gets its kind from
  `C8Failures` and its message and hint from the surface's `wordsOf(error, kind)`. That option
  differs from the `failureOf` of c7-core's `C7Runtime`, which builds the `RuntimeError` itself:
  here c8-core decides the kind and builds the error, and `wordsOf` only words it, so one failure
  has one kind on every surface.
- **The kind of a failure (`C8Failures`).** `C8Failures.kindOf` is the one rule from a
  `CamundaFailure` to the contract's failure, total over the statuses, the transport's reasons and
  the token's troubles: 401 `unauthorized`, 403 `forbidden`, a redirect and a 404 `misconfigured`,
  any other status `engineFailure`; no answer `unreachable`, an answer above the cap or no JSON
  `unexpectedResponse`, a request the transport refuses or a login it cannot send
  `misconfigured`; a token by its trouble. An error the transport copies no fields of is
  `unexpectedResponse`. c8-core words what holds on every surface itself, the surface's hint
  first: a 403 that names missing secondary storage says that the cluster has nothing to read, and
  a 404 that names no missing resource gets the hint that the profile's url must be the cluster's
  REST root and end in `/v2`.
- **The transport port (`src/port`).** `CamundaTransport` is what a surface hands the REST client:
  `get` and `post` resolve the JSON of an answer (read losslessly), `text` the text of one (a
  diagram's XML), and every request is a read. `failure(error)` reads a rejection of the transport
  as a `CamundaFailure`, fields only and no words: an error answer or a redirect
  (`answered`: its status, the problem's title and what it states, as the surface masked them),
  a request that got no answer or was never sent (`transport`: the reason and code of the
  transport's failure, a structural copy of `@miragon/pulse-http`'s `FailureReason`), or no token
  (`token`: the trouble, a structural copy of the OAuth client's `TokenFailureKind`, its status,
  code, problem, hold and cap; the token endpoint stays out). Each surface brings its own wire on
  `@miragon/pulse-http`, copies those fields and words its own failures; this package imports no
  transport. The C8 adapter's wire is `CamundaHttp` over its `CamundaWire`; the server's is
  `createC8Connection` of the engine module (`src/lib/engine/c8-connection.ts`), its words
  `src/lib/engine/c8-errors.ts`.
- **The REST client (`src/rest`).** `RestCamundaClient` has one method per call of `/v2` the reads
  need, and `CamundaViews` checks each field of an answer, so an answer of another shape fails as
  an `UnexpectedAnswerError`. A search pages by its cursor up to 10,000 rows, a statistics read by
  offset up to 10,000 rows, and a search over keys asks for at most 1,000 at a time. A lookup by
  key reads a 404 with the title `NOT_FOUND` as none, and so a key the transport refuses as a path
  value before sending it (`.`, `..`, an empty segment); any other failure fails the read.
- **The readers (`src/reading`) and mappings (`src/mapping`).** One reader per question of the
  contract (definitions and versions, diagrams, element statistics, called processes, instances and
  their counts, an instance's detail and wait states, incidents, variable names) and the version
  floor (8.9), each a class over the REST client, and the mappings from the checked views onto
  engine-core's read models: keys that are Java longs, page cursors, the BPMN text a reader needs,
  and the root cause by engine-core's `RootCauses`.

## Rules

- A family core: its src imports its own modules and engine-core's main entry alone, no other
  workspace package, no npm package and no Node built-in (`family-core-is-a-leaf`,
  `engine-core-consumers` in the repository's `.dependency-cruiser.cjs`); it builds to `dist` with
  no DOM and no Node types.
- The house rules of Pulse for VS Code, as for engine-core: classes, no comments, complexity 10,
  300 lines per file (`eslint.config.mjs`).
- `test/` holds the runtime, the kind of every failure, every reader, mapping and view to a fake of
  the transport port (`test/support/fake-transport.ts`, which answers by route, as a cluster
  would); the adapter's
  `test/rest/camunda-http.test.ts` holds its wire to the same port and the copied reasons and
  troubles equal to the transport's.

```sh
pnpm --filter @miragon/pulse-c8-core test   # the runtime, its failures, the readers, the mappings and the views, coverage floors
pnpm --filter @miragon/pulse-c8-core build  # dist, which the C8 adapter's tests and bundles read
```

## Testing helpers

`@miragon/pulse-c8-core/testing` exports `C8_BOARD_ENGINE`, a board and a model: the text of a
board file over one cluster with every widget and a refused one (its diagram over the process that
calls another, so its badge counts the incident in the called instance), that cluster's answers to
the board's reads under `/v2` (`C8RecordedAnswer`: method, decoded path, query and JSON body, and
the JSON answered, or for the diagram's XML the text with its content type), recorded once from the
conformance world of `@miragon/pulse-engine-core/testing` on `camunda/camunda:8.10.9` with H2 and
no security, and the board they give in the JSON form of `@miragon/pulse-board` (`BoardData`). It
ships here because this package makes the requests: each surface serves the answers to its own wire
on the transport's recorded engine (`startRecordedEngine` of
`@miragon/pulse-http/testing/loopback`) and must build exactly that board, so a board shows the same
numbers on every surface without a cluster; the C8 adapter does
(`packages/connectors/c8/c8-adapter/test/c8-board-numbers.test.ts`), which also holds the board's
numbers to those of the kit's fake world, as the recorded Camunda 7 board's are. A request the
runtime changes misses its answer and is named. No script of the repository records the answers,
so they are recorded by hand, as they were the first time: start that cluster with the C8
adapter's `startCluster` (`packages/connectors/c8/c8-adapter/test/support/engine-container.ts`,
under `PULSE_ENGINE_IMAGE=camunda/camunda:8.10.9`, `PULSE_C8_STORAGE=h2` and
`PULSE_C8_SECURITY=none`), seed the world with its `seedWorld`
(`packages/connectors/c8/c8-adapter/test/support/seed-world.ts`), let the C8 adapter build the board
twice through a proxy in front of the cluster that keeps each request (method, decoded path, query
and JSON body) with the JSON the cluster answers, or its text and content type for an answer that
is no JSON, check that both builds give the same board and that a build over the kept answers on
`startRecordedEngine` gives it too with no request unanswered, and write the board file, the
answers and that board into `packages/connectors/c8/c8-core/src/testing/board-engine.json`.
