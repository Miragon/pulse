# @miragon/pulse-engine-core

[![npm](https://img.shields.io/npm/v/@miragon/pulse-engine-core)](https://www.npmjs.com/package/@miragon/pulse-engine-core)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The neutral core of Pulse's engine family: the contract of the engine dialects, the shared
language of the dialects Pulse speaks. Camunda 7 family engines (Operaton, CIB seven, Camunda 7)
and Camunda 8 hold the same runtime data, named, numbered and paged differently. This package
fixes the questions Pulse asks a process engine and the words of the answers, in Pulse's own
vocabulary: process, version, instance and element ids, read models, queries, bulk operations,
migration plans and one error. Both dialects answer the reads with an implementation of their own,
and the conformance kit proves that they mean the same thing; the writes, the bulk operations and
the migration plans, answered by Camunda 7 alone, and the tenants, whose laws run on Camunda 7
alone while c8-core maps a cluster's tenants, stand here ahead of that rule, as
[the admission rule](#the-admission-rule) lists. Below 1.0: pin the exact version and update all
`@miragon/pulse-*` packages together.

The engine family is the neutral layer above the dialects: its module, the MCP server's engine
module, serves every dialect, and this package is its core. A dialect (Camunda 7 REST, and
Camunda 8's REST API, read-only) is a family of its own whose core or adapter implements this
contract, Camunda 8's its reads.

## Install

```sh
npm install @miragon/pulse-engine-core
```

It has no runtime dependency and no peers.

## Minimal example

Prove that your implementation of the ports means what the contract says:

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
kit.registerTenantLaws(async () => ({
  runtime: myRuntime,
  world: await seededWorld,
  tenantWorld: await seedTenantWorld(myEngine),
}))
```

The kit binds every law to any `(name, fn)` runner and throws an `Error` naming the law and what
it found when one fails. Your harness deploys diagrams with the world's element ids into your engine and seeds the
world's instances; the fake seeds it in memory. An engine whose reads lag behind its writes
declares `writeVisibility`, one whose bulk work runs in the background `asyncWork`. The tenant
laws read the tenant world beside the read world: the world's keys deployed in two tenants
(`WORLD_TENANT_DEPLOYMENTS`, no instance), which your harness deploys after the read laws ran or
into an engine of its own, since the read world's other readers (a recorded board, the screens)
count every process. The kit proves itself: 98 saboteurs, each the fake with one flaw, fail
exactly their laws (the package's `test/`).

## What it provides

- **`.`:** the ports `ProcessRuntime` (17 methods, from `describeEngine` to `checkMigration?`,
  three of them optional) and `ProcessCommands` (6 writes: retry an incident, set a variable, move a
  token, cancel and migrate instances in bulk, stop a bulk operation; Camunda 7's alone, as the
  admission rule's table lists); the branded ids
  (`InstanceId("…")`, `DefinitionId`, `BpmnProcessId`, `TenantId`, `ElementId` and more); the
  read models, every one that names a version or a process key with its tenant (`tenantId`, null
  for none, never `""` or a default id: a process is a key in one tenant, owner decision of
  2026-11-26, so `listVersions` takes the key and the tenant and `getCalledProcesses` the calling
  version's id and tenant, `CallingVersion`); the read models
  (`DefinitionSummary` and `VersionSummary` with their counts of running instances, instances with
  an incident and open root incidents, `InstanceSummary`, `InstanceDetail`, `Incident`,
  `ElementStatistics`, `Variable` …), the queries
  (`InstanceFilter`, `VariableCondition`, `PageRequest`, `Page`, `InstanceCount`), bulk operations and migration
  plans; `RuntimeError` with its closed `RuntimeFailure`, and `FailingRuntime`, a runtime that
  refuses every call with one error; the rules `ValueKinds` (the kind of a JSON value, with
  `isWholeNumber` whether it is a whole number of 64 bits, from `WHOLE_NUMBER_MIN` to
  `WHOLE_NUMBER_MAX`, exact on its digits, and with `isFiniteNumber` whether it is a number a
  double holds, decided on its text: `Number()` of it is finite),
  `MoveReasons` (when a reason for a token move is valid) and `RootCauses`, the root cause of a
  failure text in every dialect: `of` takes the last `Caused by:` line of a stack trace, else its
  first non-blank line, a leading class name shortened to its simple name, in one line of at most
  300 characters; `lineOf` is the line a viewer opens the text at, none without a `Caused by:`
  line; and `ProcessTenants`, the process a key names without a tenant on every surface: the
  key's process without a tenant where the key has a version without one, else its first tenant in
  the order of the tenant ids by code unit (`summaryOf` among a list's processes, `tenantOf`
  among the tenants a key's versions name, `versionsOf` with its versions over `listVersions` and
  `listDefinitions`, given a version's id the tenant that holds it).
- **`./testing`:** the conformance kit (`ConformanceKit` with 55 read laws, 15 command laws and
  3 tenant laws), its fixed world (`WORLD_*`, the three neutral diagrams `NEUTRAL_DIAGRAMS` with
  fixed element ids), its tenant world (`WORLD_TENANT`, `WORLD_TENANT_DEPLOYMENTS`) and
  `FakeEngine`, an in-memory engine that passes every law (`FakeWorld.seedWithTenants` adds the
  tenant world), with `PatchedRuntime` and `PatchedCommands` to change one answer of it in a test.

A board reads lists by these laws: instances and incidents come newest first, in the same order
on every read, incidents also across pages of one, and every page but the last holds its limit,
also where a dialect drops rows of the engine's answer (an instance with an incident from a list
of those without one, the copy of an incident in a calling instance).

## Where dialects differ

Two dialects answer the same question with the same meaning, or the contract says where they part,
never with a flag that can disagree with what the engine does:

- **A count may be a lower bound.** `countInstances` returns an `InstanceCount`: `{ count }` is
  exact, `{ count, atLeast: true }` means the engine stopped counting there (Camunda 8's search
  stops at 10,000). The laws require an exact count over the world and no count below 0 in any
  scope, also where an engine's history misses instances its runtime runs, and a surface shows a
  lower bound as one (`≥ 10,000`, `10k+`). So may the open root incidents of a process or a
  version (`incidents`, with `incidentsAtLeast: true` where the engine stopped counting).
- **Incidents are root incidents.** A `DefinitionSummary` counts the open root incidents over
  every version of its process, a `VersionSummary` those of its version (`incidents`): an incident
  counts at the process it was raised in, never as a copy at a calling instance's call activity
  (Camunda 7 holds one there, Camunda 8 none), so a caller waiting for it is an instance with an
  incident (`withIncident`) whose process counts no incident for it. Two laws hold it over the
  world, exactly; their saboteurs count the copy, a process by its latest version alone, every
  version at each version, the instances with an incident as incidents, or a lower bound within
  the world. Each failing instance of the world holds one incident, so the laws cannot tell the
  incidents from the instances that hold one of their own: a dialect's own tests pin that it counts
  incidents. The field is required, a breaking change for an implementation outside this
  repository (2026-11-21).
- **Camunda 7 keeps the incidents' order across pages within a bound.** `GET /incident` sorts by
  the time alone, so the dialect reads every run of incidents raised in the same millisecond whole
  and orders it by id, up to 500 incident rows in a run: every row the filter matches at that
  instant counts, the copies in calling instances and the rows the search drops included, not the
  root incidents alone. Of a longer run, which no request holds whole, incidents may repeat and
  about as many be missed, even within one page, wherever the database orders the run anew between
  requests; the incidents raised before or after it keep their order. The laws' world never
  reaches such a run (c7-core's README).
- **A question an engine cannot answer** fails as `RuntimeError` `unsupported`, never as
  `rejected` (a refused change) or `misconfigured` (a connection to fix). So does a command on a
  connection that only reads: it fails before the write leaves, never as a missing item.
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
  no field for it, and the conformance world never reaches that many.

## What it leaves to you

No runtime dependency, no DOM and no Node globals: it imports only its own modules and runs in any
JavaScript host. Reaching an engine (HTTP, credentials, the dialect's REST paths), the links into
an engine's web UI and every word a person reads about a failure stay with the dialect's
implementation and the surface that uses it. So do the use cases of the surfaces: grouping,
triage, verdicts and which recovery to offer.

## Who uses it

- Pulse for VS Code and Pulse for Orca speak it today: the runtime view they share asks these
  ports, their C7 adapter answers them over the Camunda 7 REST API and their C8 adapter the reads
  over Camunda 8's REST API.
- [`@miragon/pulse-c7-core`](https://www.npmjs.com/package/@miragon/pulse-c7-core), the core of
  that dialect, applies its root-cause rule for the Pulse CLI and the MCP server, and its
  `C7Runtime` (`./runtime`) answers every read of `ProcessRuntime` for the C7 adapter and the
  engine connector.
- [`@miragon/pulse-c8-core`](https://www.npmjs.com/package/@miragon/pulse-c8-core), the core of
  the Camunda 8 dialect, answers the reads of `ProcessRuntime` in `C8Runtime` and decides the kind
  of each failure, for the C8 adapter and the engine connector, each over its own wire.
- [`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
  the MCP server's engine module, runs `ProcessRuntime` over its own wire (`runtimeOf`), with its
  failures as `RuntimeError`, and builds the server's boards over it with the board builder.
- [`@miragon/pulse-board`](https://www.npmjs.com/package/@miragon/pulse-board), the board file
  format, reads a board's numbers in its builder (`./builder`) over seven reads of
  `ProcessRuntime`, by the laws a board reads lists by.

## The admission rule

A port, read model or rule stands in `@miragon/pulse-engine-core` when both dialects answer it with
the same meaning, proven by a law of the conformance kit that both run. The read laws run on
Camunda 7 (Operaton and CIB seven over the C7 adapter's and the MCP server's wires) and on
Camunda 8 (a local cluster over the C8 adapter's and the MCP server's wires); the command and
tenant laws run on Camunda 7 alone. What stands here ahead of that, the table lists, each with why
and the laws that admit it once both dialects run them; a further entry ahead of the rule is the
owner's decision in review, as a row of the table. A rule only one dialect's surfaces apply (the
verdict, the message signature, durations) stays in that dialect's core until the other answers it
too. `FailingRuntime`, the contract's own runtime that refuses every call with one error, answers
no engine and stands outside the rule, as the `./testing` entry does.
`scripts/engine-core-admission.test.mjs` holds every export of the main entry and each member of
`ProcessRuntime` to one of these, by the topics the kit names its laws by (`definitions:`,
`incidents:` …): a proof by laws one dialect runs alone fails, and so does a row whose laws both
run.

| Admitted ahead                                                                                                                              | Answered by                                                            | Why it stands here                                                                                                                                                                                                                                                        | Admitted once both run                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ProcessCommands`, `VariableChange`, `TokenMove`, `CancelOptions`, `MoveReasons`                                                            | Camunda 7; Camunda 8 is read-only in Pulse                             | The writes of Pulse for VS Code and Pulse for Orca: their runtime view writes through one port for every dialect, and `MoveReasons` is its rule of a token move's reason                                                                                                  | `commands:`                                                            |
| `BulkOperation`, `BulkFailure`, `BulkOperationKind`, `BulkOperationId`, `ProcessRuntime.getBulkOperation`, `ProcessRuntime.getBulkFailures` | Camunda 7; Camunda 8 answers no operation and no failure               | The progress of the bulk writes above, which the runtime view reads through the read port                                                                                                                                                                                 | `bulk:`                                                                |
| `MigrationPlan`, `MigrationCheck`, `MigrationProblem`, `ElementMapping`, `ProcessRuntime.proposeMigration`, `ProcessRuntime.checkMigration` | Camunda 7; Camunda 8 leaves the optional pair out                      | The plan the editors check before a migration; the pair entered as optional before the first release, on the evidence of the Camunda 8 adapter's branch (#543), so that adapter landed without a break                                                                    | `migration:`, on a runtime that declares the pair                      |
| `TenantId`, `ProcessTenants`, `TenantReads`, `TenantVersions`                                                                               | Camunda 7; c8-core maps a cluster's tenants over a fake transport only | The owner's decision of 2026-11-26 that the tenant is part of a process's identity: a version, a process and a call name their tenant (`tenantId`), Camunda 8's default tenant (`<default>`) read as none, and `ProcessTenants` picks the process a key names without one | `tenants:`, on a cluster with tenants in the C8 adapter's suite (#531) |

Entered by the rule: the open root incidents of a process and a version (`incidents`) on
2026-11-21, their laws passing on the fake, on Operaton and CIB seven and on a local Camunda 8
cluster over the wires above. Three answers Camunda 8 needs entered ahead before the first release
(a count that may be a lower bound, the failure `unsupported` and the declared variable
conditions) and stand by the rule since the read laws passed on Camunda 8 (2026-11-17 and
2026-11-21). `RootCauses` moved here from c7-core, which applies it as c8-core does; the law
"incidents: details name their root cause in one line and point at a line of their text" holds
both to the bounds of its reading, and its `lineOf` keeps c7-core's (no line without a
`Caused by:` line, by the owner's decision). A breaking change for an implementation outside this
repository came with the tenants: `DefinitionRef`, `CalledProcess` and `CalledInstance` require
`tenantId`, `listVersions` and `getCalledProcesses` take the tenant.

It is imported where a dialect is implemented (the `src` of a dialect's core, its main entry alone
and never from the core's `./testing`: c7-core applies `RootCauses` and its `./runtime` answers
`ProcessRuntime`, c8-core's `C8Runtime` answers it too; the C7 and C8 adapters of the editor
hosts), where the runtime view of Pulse for VS Code and Pulse for Orca reads the answers, which
keeps no contract of its own, and in the board builder of `@miragon/pulse-board`, its main entry
alone. The engine connector, the MCP server's module, runs it in its server layers, its main entry
alone, admitted for the server's boards (the owner's decision of 2026-11-16, the case #488 names:
a second interface needs the same use case with the same rules). The Pulse CLI reaches it through
c7-core; importing it directly waits until the CLI serves a second dialect, an admission decision
in review. The repository holds that to its import graph (`engine-core-consumers` in its
dependency-cruiser config) and the package to its own modules (`family-core-is-a-leaf`).

## Stability

Below 1.0 without a stability promise: the laws and the fake follow Pulse for VS Code, and a new
question its views need lands as a port, a read model, a law and a saboteur by the admission rule,
ahead of it only as a row of its table. A change that breaks an implementation says so in the
changelog.

## Help and feedback

- **Documentation:** the Pulse servers, CLI and VS Code extension built on this contract are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in [CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md).
Two rules hold this package on top of the repository's.

### Mutation testing

The three rules, `RootCauses`, `ValueKinds` and `MoveReasons`, are mutation-tested every night in
the repository (StrykerJS over `src/model/root-causes.ts`, `value-kinds.ts` and `move-reasons.ts`
against the package's own tests; owner decision 2026-11-09). They are the contract's rules a
dialect applies: `RootCauses` in all three interfaces of Pulse (the CLI reaches it through c7-core,
the MCP server through c7-core and c8-core), `ValueKinds` in c7-core and c8-core (a variable's
kind) and the runtime view's core, `MoveReasons` in the editor hosts alone, the runtime view's
core and the C7 adapter. A surviving mutant is a wrong rule wherever one runs. Nothing else of the
package is mutated. Locally: `pnpm --fail-if-no-match --filter @miragon/pulse-engine-core exec stryker run`.

### Style

The house rules of Pulse for VS Code, which this package came from: classes, not module
functions (one class per file, public methods first, static utility classes per topic, the
branded id constructors aside), no comments (names and types carry the intent, and no rule is
switched off inline), complexity 10, 300 lines per file (400 for a test file), 60 per function,
no engine word such as a vendor's name or `processDefinitionKey` anywhere in it. The repository's
ESLint config holds the package to them.

## License

[MIT](LICENSE) © Miragon GmbH
