# @miragon/pulse-c8-core

The core of Pulse's Camunda 8 dialect family: the reads of a Camunda 8 cluster (8.9 and newer,
SaaS and Self-Managed) through the Orchestration Cluster REST API (`/v2`), mapped onto the read
models of `@miragon/pulse-engine-core`, the engine contract every dialect implements. It reads and
never writes. Two surfaces run it, each over its own wire on `@miragon/pulse-http` and in its own
words: the C8 adapter of the editor hosts (`packages/connectors/c8/c8-adapter`) and the MCP
server's engine module (`@miragon/pulse-engine-connector`, whose `src/lib/engine` alone imports
it, for the engine list and the boards:
[Camunda 8 on the server](https://miragon.github.io/pulse/mcp/camunda8)), which is why it is
published. Below 1.0, pin the exact version and update all `@miragon/pulse-*` packages together.

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
  c8-core's own (a refused condition) passes as it is, any other gets its kind from
  `C8Failures` (a cluster below the floor `misconfigured`) and its message and hint from the
  surface's `wordsOf(error, kind)`, so each surface names its engine in it as it does elsewhere.
  That option differs from the `failureOf` of c7-core's `C7Runtime`, which builds the
  `RuntimeError` itself: here c8-core decides the kind and builds the error, and `wordsOf` only
  words it, so one failure has one kind on every surface.
- **The kind of a failure (`C8Failures`).** `C8Failures.kindOf` is the one rule from a
  `CamundaFailure` to the contract's failure, total over the statuses, the transport's reasons and
  the token's troubles: 401 `unauthorized`, 403 `forbidden`, a redirect and a 404 `misconfigured`,
  any other status `engineFailure`; no answer `unreachable`, an answer above the cap or no JSON
  `unexpectedResponse`, a request the transport refuses or a login it cannot send
  `misconfigured`; a token by its trouble. An error the transport copies no fields of is
  `unexpectedResponse`. c8-core words what holds on every surface itself, the surface's hint
  first: a 403 that names missing secondary storage says that the cluster has nothing to read,
  followed by the `tail` of the surface's words where it gives one (the server's `(engine c8)`),
  and a 404 that names no missing resource gets the hint that the profile's url must be the
  cluster's REST root and end in `/v2`.
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
  offset up to 10,000 rows, and a search over keys asks for at most 1,000 at a time, as does the
  search for the latest versions of the processes a diagram's calls name (`latestOf`, by their
  ids, never every process of the cluster), which sends nothing for no id, since a cluster reads
  an empty `$in` as no condition. A lookup by
  key reads a 404 with the title `NOT_FOUND` as none, and so a key the transport refuses as a path
  value before sending it (`.`, `..`, an empty segment); any other failure fails the read.
- **The readers (`src/reading`) and mappings (`src/mapping`).** One reader per question of the
  contract (definitions and versions, diagrams, element statistics, called processes, instances and
  their counts, an instance's detail and wait states, incidents, variable names) and the version
  floor (8.9), each a class over the REST client (the definitions and versions count their open
  incidents, which the cluster never copies, with one incident search per process and per version
  that has an instance with incident, its total without a row, a lower bound,
  `incidentsAtLeast`, where the search stops counting; none for one without, which holds no
  incident; at most eight such searches at once, `FewAtOnce`, as an instance's detail reads its
  members; one that fails fails the read of the definitions or versions, so every surface that lists
  a cluster's processes, a board's engine and a process screen's versions included, fails with it),
  and the mappings from the checked views onto
  engine-core's read models: keys that are Java longs, page cursors, the BPMN text a reader needs
  (read in one pass over the tags and their attributes, in time that grows with the text, no tag
  of a text over 4 Mi characters; the tag reader is a copy of the board builder's, held equal by
  `scripts/xml-tag-readers.test.mjs`), and the root cause by engine-core's `RootCauses`.

## Rules

- A family core: its src imports its own modules and engine-core's main entry alone, no other
  workspace package, no npm package and no Node built-in (`family-core-is-a-leaf`,
  `engine-core-consumers` in the repository's `.dependency-cruiser.cjs`); it builds to `dist` with
  no DOM and no Node types.
- The house rules of Pulse for VS Code, as for engine-core: classes, no comments, complexity 10,
  300 lines per file (`eslint.config.mjs`).
- `test/` holds the runtime, the kind of every failure, every reader, mapping and view to a fake of
  the transport port (`test/support/fake-transport.ts`, which answers by route, as a cluster
  would), and the world's seed to a fake of its port (`test/testing/seed-world.test.ts`); the
  adapter's `test/rest/camunda-http.test.ts` holds its wire to the same port and the copied
  reasons and troubles equal to the transport's.
- Its rules are mutation-tested every night in the repository (StrykerJS over `src/mapping`,
  `src/reading/instance-filters.ts`, `src/reading/version-floor.ts` and `src/c8-failures.ts`
  against the package's own tests; owner decision 2026-11-17): how the cluster's answers map onto
  the contract's read models, the contract's instance filters as the cluster's, the version floor
  and the kind of every failure, which the C8 adapter and the MCP server both run, so a surviving
  mutant is a wrong answer on every surface. The REST client, the readers and `src/testing` (the
  recorded board, the world and its seed) are not mutated.

```sh
pnpm --filter @miragon/pulse-c8-core test   # the runtime, its failures, the readers, the mappings and the views, coverage floors
pnpm --filter @miragon/pulse-c8-core build  # dist, which the C8 adapter's tests and bundles read
pnpm --fail-if-no-match --filter @miragon/pulse-c8-core exec stryker run  # the mutation run (--mutate <file> narrows it)
```

## Testing helpers

`@miragon/pulse-c8-core/testing` exports the conformance world of `@miragon/pulse-engine-core/testing`
as a Camunda 8 cluster holds it, and a board and the shared screens recorded from it.

`C8WorldSeed.seed(engine, plan)` seeds that world into a cluster over a port the caller hands in
(`C8SeedEngine`: the REST root, a `fetch`-shaped `send` that signs its requests in, the `wait`
between two polls and the clock, `now`), so it needs no `fetch`, no file, no timer and no login of
its own: it deploys the world's diagrams (`label@1`, `order@1`, `order@2` marked as a second
version, `dispatch@1`), starts its instances with their business ids and variables, fails every
job of `charge-payment` and `render-label` without retries, sets the local variable on its element
instance and waits until the secondary storage shows the world (the active instances per process
and the open incidents of the kit's fake world, to which this package's test holds the seed, and
the local variable), at most two minutes per step by the port's clock. It answers the cluster's
keys by alias as strings, which the caller brands into engine-core's `SeededWorld`. The plan is
engine-core's `WORLD_DEPLOYMENTS`, `WORLD_INSTANCES` and `WORLD_LOCAL_VARIABLE` with the text of
each diagram: the Zeebe diagrams of the world, with the kit's element ids, live in `world/` beside
`src/` (not in the tarball), and each suite reads them from the repository. `world/waits.bpmn`,
a process that waits for a message, a timer and a signal, is no part of the world: the C8
adapter's suite deploys it for its wait states, and its `c8:up` reads every diagram there. Three
suites seed it: the C8 adapter's conformance suite
(`packages/connectors/c8/c8-adapter/test/c8-conformance.engine.test.ts`), the MCP server's
(`packages/connectors/engine/engine-connector/src/lib/core-adapter/c8-runtime.engine.test.ts`),
both on a local cluster only until #531, and this package's own test over a fake port
(`test/testing/seed-world.test.ts`), which also holds the diagrams to the job types and elements
the seed relies on.

`C8_BOARD_ENGINE` is a board and a model: the text of a board file over one cluster with every
widget and a refused one (its diagram over the process that calls another, so its badge counts the
incident in the called instance), that cluster's answers to the board's reads under `/v2`
(`C8RecordedAnswer`: method, decoded path, query and JSON body, and the JSON answered, or for the
diagram's XML the text with its content type), recorded once from the world `C8WorldSeed` seeds on
`camunda/camunda:8.10.9` with H2 and no security, and the board they give in the JSON form of
`@miragon/pulse-board` (`BoardData`). It ships here because this package makes the requests: each
surface serves the answers to its own wire on the transport's recorded engine
(`startRecordedEngine` of `@miragon/pulse-http/testing/loopback`) and must build exactly that board,
so a board shows the same numbers on every surface without a cluster; the C8 adapter does
(`packages/connectors/c8/c8-adapter/test/c8-board-numbers.test.ts`), which also holds the board's
numbers to those of the kit's fake world, as the recorded Camunda 7 board's are, and so does the
MCP server's board feed over its own Camunda 8 wire
(`packages/connectors/engine/engine-connector/src/data/board-data.numbers.test.ts`), which leaves
each answer out in turn too, so the board shows that read's failure in its place and never a 0.
Both conformance suites hold a live cluster's board to the recording's numbers, so a cluster that
answers otherwise shows there. A request the runtime changes misses its answer and is named. No
script of the repository records the answers, so they are recorded by hand, as they were the
first time: start that cluster with the C8 adapter's `startCluster`
(`packages/connectors/c8/c8-adapter/test/support/engine-container.ts`, under
`PULSE_ENGINE_IMAGE=camunda/camunda:8.10.9`, `PULSE_C8_STORAGE=h2` and `PULSE_C8_SECURITY=none`),
seed the world with `C8WorldSeed` (as the adapter's `seedWorld` in
`packages/connectors/c8/c8-adapter/test/support/seed-world.ts` does), let the C8 adapter build the
board twice through a proxy in front of the cluster that keeps each request (method, decoded path,
query and JSON body) with the JSON the cluster answers, or its text and content type for an answer
that is no JSON, check that both builds give the same board and that a build over the kept answers
on `startRecordedEngine` gives it too with no request unanswered, and write the board file, the
answers and that board into `packages/connectors/c8/c8-core/src/testing/board-engine.json`.

`C8_SCREEN_ENGINE` is the same for the screens Pulse's surfaces share (`@miragon/pulse-screens`):
one cluster's answers to the screens' reads under `/v2`, the time a surface builds them at (`asOf`)
and the screens they give in their JSON form: the engine screen (`expected.engine`,
`EngineScreenData`); the instance screens (`InstanceScreenData`) of DSP-3001, which waits at its
call activity for the incident of the instance it called (`expected.instance`), and of that called
instance (`expected.calledInstance`); the process screens (`ProcessScreenData`) of pulse-order at
its latest version (`expected.process`) and at its version 1 (`expected.olderVersion`) and of
pulse-dispatch (`expected.callingProcess`); and the first page of every instance of pulse-order's
version 1 with the counts of each scope (`expected.instanceList`, `InstanceListData`); the editors'
C8 adapter and the MCP server's Camunda 8 wire build each exactly, with the figures of the recorded
Camunda 7 screens. Its answers come from one run of their own, recorded by hand on 2026-11-20 as
the board's, made anew with the process screens and the instance list, and with the board on
2026-11-21, when the definitions and versions counted their open incidents, and without the board
on 2026-11-26, when the called processes were read by their ids (the board reads none): the world
seeded with `C8WorldSeed` on `camunda/camunda:8.10.9` with H2 and no security, waited for until
every screen held the kit world's figures, every screen built twice through a proxy in front of
the cluster that keeps each request with what the cluster answers (the same answer both times),
and once more over the kept answers on `startRecordedEngine`, with no request unanswered. So every
key they name is that cluster's, and a screen built over them later reads the same instances and
versions; one that reads more is recorded again with the others in one run, never joined from
another recording.
