# @miragon/pulse-engine-contract

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-contract?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-engine-contract)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The shared language of the engine dialects Pulse speaks. Camunda 7 family engines (Operaton,
CIB seven, Camunda 7) and Camunda 8 hold the same runtime data, named, numbered and paged
differently. This package fixes the questions Pulse asks a process engine and the words of the
answers, in Pulse's own vocabulary: process, version, instance and element ids, read models,
queries, bulk operations, migration plans and one error. Each dialect answers them with an
implementation of its own, and the conformance kit proves that it means the same thing.

Pulse for VS Code speaks it today: its core asks these ports, and its C7 adapter answers them
over the Camunda 7 REST API.

## What it is not

No runtime dependency, no DOM and no Node globals: it imports only its own modules and runs in any
JavaScript host. Reaching an engine (HTTP, credentials, the dialect's REST paths), the links into
an engine's web UI and every word a person reads about a failure stay with the dialect's
implementation and the surface that uses it. So do the use cases of the surfaces: grouping,
triage, verdicts and which recovery to offer.

## Install

```sh
npm install @miragon/pulse-engine-contract
```

## What it holds

- **`.`:** the ports `ProcessRuntime` (16 read questions, from `describeEngine` to
  `checkMigration`) and `ProcessCommands` (6 writes: retry an incident, set a variable, move a
  token, cancel and migrate instances in bulk, stop a bulk operation); the branded ids
  (`InstanceId("…")`, `DefinitionId`, `BpmnProcessId`, `ElementId` and more); the read models
  (`InstanceSummary`, `InstanceDetail`, `Incident`, `ElementStatistics`, `Variable` …), the queries
  (`InstanceFilter`, `VariableCondition`, `PageRequest`, `Page`), bulk operations and migration
  plans; `RuntimeError` with its closed `RuntimeFailure`, and `FailingRuntime`, a runtime that
  refuses every call with one error; the rules `ValueKinds` (the kind of a JSON value) and
  `MoveReasons` (when a reason for a token move is valid).
- **`./testing`:** the conformance kit (`ConformanceKit` with 47 read laws and 15 command laws),
  its fixed world (`WORLD_*`, the three neutral diagrams `NEUTRAL_DIAGRAMS` with fixed element
  ids) and `FakeEngine`, an in-memory engine that passes every law, with `PatchedRuntime` and
  `PatchedCommands` to change one answer of it in a test.

## Prove an implementation

```ts
import { ConformanceKit } from "@miragon/pulse-engine-contract/testing"
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
proves itself: 59 saboteurs, each the fake with one flaw, fail exactly their laws (the package's
`test/`).

## The admission rule

A port, read model or rule enters `@miragon/pulse-engine-contract` when two dialects answer it with
the same meaning, proven by the conformance laws on both. Only dialect implementations import the
contract (Pulse for VS Code's contract barrel for its adapters, and a dialect core's `src` once it
uses a rule of the contract). A surface reaches it through them; the engine connector or the CLI
importing it directly is an admission decision in review, the case #488 reopens on: a second
interface needing the same use case with the same rules.

The repository holds that to its import graph (`engine-contract-consumers` in its
dependency-cruiser config) and the package to its own modules (`engine-contract-is-a-leaf`).

## Stability

Below 1.0 without a stability promise: the laws and the fake follow Pulse for VS Code, and a new
question its views need lands here first, as a port, a read model, a law and a saboteur. A change
that breaks an implementation says so in the changelog.

## Style

The house rules of Pulse for VS Code, which this package came from: classes, not module
functions (one class per file, public methods first, static utility classes per topic, the
branded id constructors aside), no comments (names and types carry the intent, and no rule is
switched off inline), complexity 10, 300 lines per file, 60 per function, no engine word such as
a vendor's name or `processDefinitionKey` anywhere in it. The repository's ESLint config holds the
package to them.

## License

MIT
