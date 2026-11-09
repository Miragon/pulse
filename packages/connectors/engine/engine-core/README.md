# @miragon/pulse-engine-core

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-core?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-engine-core)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The neutral core of Pulse's engine family: the contract every engine dialect implements, the
shared language of the dialects Pulse speaks. Camunda 7 family engines (Operaton,
CIB seven, Camunda 7) and Camunda 8 hold the same runtime data, named, numbered and paged
differently. This package fixes the questions Pulse asks a process engine and the words of the
answers, in Pulse's own vocabulary: process, version, instance and element ids, read models,
queries, bulk operations, migration plans and one error. Each dialect answers them with an
implementation of its own, and the conformance kit proves that it means the same thing.

The engine family is the neutral layer above the dialects: its module, the MCP server's engine
module, serves every dialect, and this package is its core. A dialect (Camunda 7 REST today,
Camunda 8 later) is a family of its own whose core implements this contract. Pulse for VS Code
speaks it today: its core asks these ports, and its C7 adapter answers them over the Camunda 7
REST API. [@miragon/pulse-c7-core](https://www.npmjs.com/package/@miragon/pulse-c7-core), the
core of that dialect, applies its root-cause rule for the Pulse CLI and the MCP server.

## What it is not

No runtime dependency, no DOM and no Node globals: it imports only its own modules and runs in any
JavaScript host. Reaching an engine (HTTP, credentials, the dialect's REST paths), the links into
an engine's web UI and every word a person reads about a failure stay with the dialect's
implementation and the surface that uses it. So do the use cases of the surfaces: grouping,
triage, verdicts and which recovery to offer.

## Install

```sh
npm install @miragon/pulse-engine-core
```

## What it holds

- **`.`:** the ports `ProcessRuntime` (17 methods, from `describeEngine` to `checkMigration?`,
  three of them optional) and `ProcessCommands` (6 writes: retry an incident, set a variable, move a
  token, cancel and migrate instances in bulk, stop a bulk operation); the branded ids
  (`InstanceId("…")`, `DefinitionId`, `BpmnProcessId`, `ElementId` and more); the read models
  (`InstanceSummary`, `InstanceDetail`, `Incident`, `ElementStatistics`, `Variable` …), the queries
  (`InstanceFilter`, `VariableCondition`, `PageRequest`, `Page`, `InstanceCount`), bulk operations and migration
  plans; `RuntimeError` with its closed `RuntimeFailure`, and `FailingRuntime`, a runtime that
  refuses every call with one error; the rules `ValueKinds` (the kind of a JSON value),
  `MoveReasons` (when a reason for a token move is valid) and `RootCauses`, the root cause of a
  failure text in every dialect: `of` takes the last `Caused by:` line of a stack trace, else its
  first non-blank line, a leading class name shortened to its simple name, in one line of at most
  300 characters; `lineOf` is the line a viewer opens the text at, none without a `Caused by:`
  line.
- **`./testing`:** the conformance kit (`ConformanceKit` with 48 read laws and 15 command laws),
  its fixed world (`WORLD_*`, the three neutral diagrams `NEUTRAL_DIAGRAMS` with fixed element
  ids) and `FakeEngine`, an in-memory engine that passes every law, with `PatchedRuntime` and
  `PatchedCommands` to change one answer of it in a test.

## Prove an implementation

```ts
import { ConformanceKit } from "@miragon/pulse-engine-core/testing"
import { test } from "vitest"

const kit = new ConformanceKit(test)
kit.registerRuntimeLaws(async () => ({
  runtime: myRuntime,
  unreachableRuntime: myRuntimeAt("http://127.0.0.1:9"),
  world: await seedWorld(myEngine),
}))
kit.registerCommandLaws(async () => ({
  runtime: myRuntime,
  commands: myCommands,
  world: await seedCommandWorld(myEngine),
}))
```

The kit binds every law to any `(name, fn)` runner and throws an `Error` naming the law and what
it found when one fails. Your harness deploys diagrams with the world's element ids into your engine and seeds the
world's instances; the fake seeds it in memory. An engine whose reads lag behind its writes
declares `writeVisibility`, one whose bulk work runs in the background `asyncWork`. The kit
proves itself: 71 saboteurs, each the fake with one flaw, fail exactly their laws (the package's
`test/`).

## Where dialects differ

Two dialects answer the same question with the same meaning, or the contract says where they part,
never with a flag that can disagree with what the engine does:

- **A count may be a lower bound.** `countInstances` returns an `InstanceCount`: `{ count }` is
  exact, `{ count, atLeast: true }` means the engine stopped counting there (Camunda 8's search
  stops at 10,000). The laws require an exact count over the world, and a surface shows a lower
  bound as one (`≥ 10,000`, `10k+`).
- **A question an engine cannot answer** fails as `RuntimeError` `unsupported`, never as
  `rejected` (a refused change) or `misconfigured` (a connection to fix).
- **Refused variable conditions are declared.** `refusedVariableConditions?()` names the kinds an
  engine refuses: `ordering` is `greaterThan` and `lessThan` on a value (`valueJson`), `date` every
  condition on a point in time (`at`), after and before included. The variable laws hold the
  declaration to behaviour: a declared kind fails as `unsupported` in the search and the count, and
  every other condition answers correctly.
- **Migration planning is optional, as a pair.** An engine without `proposeMigration?` and
  `checkMigration?` plans no migration, and a surface offers none; an engine with one of them
  only fails the plan laws. An engine that migrates (`ProcessCommands.migrateInstances`) plans
  too: the migration command laws take their plan from `proposeMigration` and fail without it.
- **Element statistics on Camunda 8 can stay undivided.** Camunda 8 keeps an incident at the
  element that raised it and counts it at every container around it, so its adapter splits a
  container's row with one incident search per container. When that search stops counting (above
  10,000 on Elasticsearch), the row keeps the cluster's counts: every incident inside the
  container reads as raised there and none as in a called instance. "Statistics are disjoint"
  (`active + incidents` is what the element holds) does not hold for such a row. The contract has
  no field for it yet; `ElementStatistics` gains an optional one with the Camunda 8 adapter.

## The admission rule

A port, read model or rule enters `@miragon/pulse-engine-core` when two dialects answer it with
the same meaning, proven by the conformance laws on both. It stays narrow: a further rule (the
verdict, the message signature, durations) moves here only when a second dialect needs it in the
CLI or the MCP server. Only dialect implementations import it (Pulse for VS Code's contract barrel
for its adapters, and the `src` of a dialect's core, its main entry alone and never from the
core's `./testing`: c7-core applies `RootCauses`). A surface reaches it through them; the engine
connector (although this is its own family's core) or the CLI importing it directly waits until
it serves a second dialect, an admission decision in review, the case #488 reopens on: a second
interface needing the same use case with the same rules.

Two admissions came ahead of their second dialect, by the owner's decision, on the evidence of the
Camunda 8 adapter's branch (#543):

- The four answers Camunda 8 needs (a count that may be a lower bound, the failure `unsupported`,
  the declared variable conditions and migration planning as an optional pair) entered before
  the first release, so that adapter lands without a break. Here the laws run them on the fake
  and the C7 adapter, which count exactly, answer every condition and plan migrations; the
  saboteurs prove the other side.
- `RootCauses` moved here from c7-core, since that branch copies its `of` character for
  character. Its `lineOf` keeps c7-core's reading, no line without a `Caused by:` line (by the
  owner's decision), where the copy points at the first non-blank line; the law "incidents: details
  name their root cause in one line and point at a line of their text" holds every adapter to
  the bounds both readings keep.

The repository holds that to its import graph (`engine-core-consumers` in its
dependency-cruiser config) and the package to its own modules (`family-core-is-a-leaf`).

## Mutation testing

The three rules, `RootCauses`, `ValueKinds` and `MoveReasons`, are mutation-tested every night in
the repository (StrykerJS over `src/model/root-causes.ts`, `value-kinds.ts` and `move-reasons.ts`
against the package's own tests; owner decision 2026-11-09). They are the contract's rules a
dialect applies: `RootCauses` in all three interfaces of Pulse (the CLI and the MCP server reach it
through c7-core), `ValueKinds` and `MoveReasons` today in Pulse for VS Code alone, its core and
its C7 adapter. A surviving mutant is a wrong rule wherever one runs. Nothing else of the package
is mutated. Locally: `pnpm --fail-if-no-match --filter @miragon/pulse-engine-core exec stryker run`.

## Stability

Below 1.0 without a stability promise: the laws and the fake follow Pulse for VS Code, and a new
question its views need lands here first, as a port, a read model, a law and a saboteur. A change
that breaks an implementation says so in the changelog.

## Style

The house rules of Pulse for VS Code, which this package came from: classes, not module
functions (one class per file, public methods first, static utility classes per topic, the
branded id constructors aside), no comments (names and types carry the intent, and no rule is
switched off inline), complexity 10, 300 lines per file (400 for a test file), 60 per function,
no engine word such as a vendor's name or `processDefinitionKey` anywhere in it. The repository's
ESLint config holds the package to them.

## License

MIT
