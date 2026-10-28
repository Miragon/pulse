# Migrating instances to another version

- Status: accepted
- Last reviewed: 2026-10-23

## Context

After a new version is deployed, the running instances stay on the old one. Moving them
needs a migration plan, and in Camunda 7 and CIB seven the Cockpit for that is
enterprise-only. Teams write the REST calls by hand and find unmapped elements only when
the execution fails (issue #17). Operaton, CIB seven and Camunda 7 all have the
migration API in their community editions; only the UI is missing.

Three persona groups reviewed the plan in isolation and signed the merged plan off with
amendments: Sophie (architect for C7 and C8), Aylin and Eva (ops on call and application
security), and Clara, Jonas and Markus (UX, process developer and BPM consultant). Spikes
on Operaton 2.1.5 (below) shaped the contract before any code was written.

## Decision

### The flow

```mermaid
sequenceDiagram
  actor user as User
  participant definition as Definition panel
  participant tab as Migration tab (core MigrationPanel)
  participant host as extension: bulk dialog, audit
  participant engine as ProcessRuntime and ProcessCommands

  user->>definition: tick rows, Migrate to version…
  definition->>tab: openMigration (core-owned ids, source version)
  tab->>engine: listVersions, diagrams, statistics, ids still on the source
  tab->>engine: proposeMigration(source, target), checkMigration(plan)
  tab->>engine: searchInstances(ids at each element where tokens wait)
  user->>tab: change the mapping (select per row or a click on the target diagram)
  tab->>engine: checkMigration(plan), 300 ms after the last edit, latest wins
  user->>tab: Migrate 41 instances…
  tab->>engine: checkMigration(frozen plan), statistics, waiting ids, re-read the ids
  tab->>host: confirmBulk (count, versions, what changes and what stays)
  tab->>engine: migrateInstances(plan, ids) through the audited commands
  engine-->>tab: BulkOperationId
  loop while a panel of the process is watched
    tab->>engine: getBulkOperation(id)
  end
  tab->>engine: getBulkFailures(id) when items failed; two counts: still on the source, now on the target
```

1. **Entry.** Only the selection bar of the definition panel offers "Migrate to
   version…", and only when the process has another version. The intent
   `openMigration` names nothing: the core hands its own selection (a fixed id list, at
   most 1000) and the shown version to `PanelEffects.openMigration` and clears the
   selection. There is no entry without a fixed id list (Eva's veto): "Select all n
   running" covers a whole version.
2. **The migration tab** (`MigrationPanel`, one per engine and process; opening it again
   hands over the new selection) is titled "Order fulfillment v2 → v3 · shop-dev". The
   target picker lists the other versions of the same BPMN process id; the latest is
   preselected only when it is newer than the source, never an older one. On load the
   selection is narrowed to the instances that still run on the source.
3. **The mapping** comes from the engine (`proposeMigration`, `updateEventTriggers:
false`). The table is the primary editor: one native select per source element
   ("Map Review order to", "Not mapped" and the target elements of the same kind), its
   problem linked by `aria-describedby`; rows with a problem come first, then rows
   without a mapping where instances wait. The diagrams help: a click on a source shape
   focuses its row, a click on a target shape maps the focused row; the focused row's
   candidates are outlined dashed on the target. The core resolves every intent against
   both diagrams (`MigrationElements`); one mapping per source element.
4. **Check on every edit.** `checkMigration` runs 300 ms after the last edit, one call at
   a time, and only the newest result counts (`MigrationChecks`). The action row says
   "12 mapped · no problems · checked just now" ("All 12 elements map by id" when the
   ids match) and shows the button or what blocks it; the button is never greyed out.
5. **Elements without a mapping where selected instances wait** are flagged in the table
   ("no mapping", "3 selected wait here") and on the source diagram (danger dashed
   outline). Where tokens wait comes from the source's element statistics (tasks, wait
   events, receive tasks, call activities, async-before transitions; not embedded
   sub-process scopes). Which of the selected wait there costs one `searchInstances` per
   element: for every element with tokens when there are at most 10, otherwise only for
   those without a mapping, and none when even those are more than 10. The button gives
   way to "3 of 44 wait at Review order, which has no mapping in v3." with "Leave the 3
   out" ("1 of 44 waits …", "Leave the one out"); an element without a mapping that Pulse
   could not count blocks with "… Map them first." and offers no leave-out (a refresh
   counts it). The summary then says "1 without a mapping" instead of "no problems", and
   the reason is announced politely. Leaving out is shown in the dialog, audited and named
   in the outcome.
6. **Restarting timers.** An unmapped boundary timer of an element where instances wait
   gets a warning, not a refusal: "The timer 3 days at Await payment starts again."
7. **Migrate.** The plan is frozen when the button is pressed; edits while the dialog is
   open never reach the engine. Before the dialog the core checks the frozen plan again,
   reads the statistics and the waiting ids again (an instance may have moved on to an
   element without a mapping) and re-reads the ids; any problem refuses with a message
   and asks nothing. When the mapping, the target, the source, the selection or what is
   left out changed meanwhile, it refuses with "The plan changed while Pulse checked it.",
   so the dialog and the audit always describe the plan that is submitted. The confirmation is the bulk cancel's ([writes.md](writes.md)): the
   modal, the typed count everywhere, the typed host on production, unclassified and
   remote engines, no reason (the C7 body has no field for one). The modal keeps one short
   line per fact: the first three instances, what was skipped or left out, "Each migrates
   on its own; failed ones stay on v2.", restarting timers, an older or not-latest target,
   incidents, called instances, "New or unmapped timers and subscriptions start now."
   where the source has catching events, "Migrating can't be undone." and, without a
   login, "No login: the engine doesn't record who migrated." The mapping count is on
   the screen. The modal no longer says that listeners and input/output mappings run only
   where the plan starts or ends a scope: it is the engine's rule, the same for every
   migration, and belongs here rather than in each modal.
8. **One code path: every migration is a batch.** `MigrateInstancesAction` is the second
   `BulkAction`; `BulkRuns`, `BulkFollow`, Stop and the strip are those of the bulk
   cancel and show in both tabs ("Migrating instances: 20 of 44 done").
9. **The outcome comes from counts, never from `failed`.** When the operation is worked
   off, the core counts the submitted ids still on the source and those now on the target
   (`BulkAction.arrivedFilter`); the rest ended meanwhile. "Migrated 41 instances to v3.
   3 left out, still on v2." or "Migrated 37 of 41 to v3. 4 still on v2." (danger).
10. **Failures and the leftover batch.** When items failed, the core reads
    `getBulkFailures` once per run: when the run is worked off, or before a Stop of a run
    with failed items if that comes first, because removing the batch removes the engine's
    messages; a failed read neither holds up the outcome nor the Stop. "Show why" opens a read-only document with
    each failed instance, its business key and the engine's reason; a reason that names an
    instance Pulse did not submit is listed without one, and a failure of an instance that
    ended meanwhile reads "ended meanwhile". A C7 batch with failed jobs never ends, so
    the strip says "The engine keeps the batch with 4 failed items." and offers "Remove
    batch", which is `stopBulkOperation`: audited, never automatic. Until it is removed, the
    tab refuses a new migration ("The engine keeps the batch of the last run with 4 failed
    items. Remove it first."), the strip offers no Dismiss and no other bulk write of the
    process starts, so no batch is left behind for good. Back in the tab, the
    selection holds the instances still on the source and the mapping is kept, so the next
    "Migrate 4 instances…" is one fix away. A tab that was hidden while another panel
    followed the run loads again when it is shown.
11. **An unknown submit outcome** (`unreachable`, a timeout, an engine 5xx) reads "Unknown
    whether migrating started." with "Check instances" (the same two counts); Pulse never
    submits again on its own. When the read that filters the ids fails before the submit,
    nothing was sent: the adapter says so and the start counts as refused.

### Contract

Three reads and one write, no new port (all three groups): writes already flow through
`ProcessCommands`, the write policy and `AuditedCommands`, and progress already is a read.

| Method                             | Port              | Effect                                                                                                                                     |
| ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `proposeMigration(source, target)` | `ProcessRuntime`  | the engine's mapping between two versions as `MigrationPlan { sourceDefinitionId, targetDefinitionId, mappings: ElementMapping[] }`        |
| `checkMigration(plan)`             | `ProcessRuntime`  | `MigrationCheck { problems: { mapping?, message }[] }`; it knows nothing about tokens                                                      |
| `getBulkFailures(id)`              | `ProcessRuntime`  | at most 100 `BulkFailure { instanceId?, reason }` of a bulk operation; `instanceId` is optional because an engine may name it only in text |
| `migrateInstances(plan, ids)`      | `ProcessCommands` | one asynchronous bulk operation of kind `migrateInstances`; ended and unknown ids are skipped; nothing left is `rejected`                  |

The laws are in [runtime-contract.md](runtime-contract.md). A later plan file is keyed by
BPMN process id and version numbers, not by `DefinitionId`s, which differ per engine.

### Audit

| Line                                                                                                                                                                       | When                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `confirm migrateInstances … confirmation=typeCount answer=confirmed source=<def> target=<def> mappings=12 leftOut=3 incidents=5 mode=batch selected=47 skipped=3 count=44` | after the dialog           |
| `migrateInstancesPlan … part=1/1 map=Activity_A>Activity_A,Activity_B>Activity_C`, 100 pairs a line                                                                        | before the submit          |
| `migrateInstances … part=1/1 ids=…`, 100 ids a line                                                                                                                        | before the submit          |
| `migrateInstances … source= target= mappings= count= result=done bulk=<operation id>` (`oplog=none` without a login)                                                       | after the submit           |
| `migrateInstancesOutcome … bulk=<operation id> phase=finished migrated=37 stillOnSource=4 ended=0 failed=4`                                                                | when the run is worked off |

Element ids are not values; the pairs make a run reproducible in another environment
until plans exist as files (Markus' condition for "later"). Never the engine's failure
text: it can carry business data from listeners and expressions.

### Facts from the spikes (Operaton 2.1.5)

- `POST /migration/generate` and `/migration/validate` are reads. Generate maps tasks, call activities and boundary and intermediate catch events by id,
  not start or end events or gateways; validate reports only failing instructions
  ("Activities have incompatible types (UserTaskActivityBehavior is not compatible with
  ServiceTaskExpressionActivityBehavior)").
- In a migration batch an ended or unknown id becomes a failed job (a deletion batch
  skips it). So the adapter filters the ids first: one query for those unfinished on the
  plan's source.
- A failed batch job has `retries: 0` and no `processInstanceId`; the instance id is only
  in its message ("Cannot migrate process instance '<id>': …"). The batch never ends while
  failed jobs exist; deleting it removes them and their messages.
- An incident and a suspension move with the instance. A mapped timer keeps its due
  date; an unmapped boundary timer becomes a new job that starts again.
- The engine keeps no user operation log entry without an authenticated user.
- The historic `activeActivityIdIn` filter misses a token that waits before an
  async-before task; `activityIdIn` finds it and no element an instance already left.
  The C7 adapter filters by `activityIdIn` since; the element law covers it.

### Decisions on the open questions of #17

| Question                            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan as a versioned workspace file? | Later (unanimous). The mapping pairs go to the audit now. A file will be untrusted input: checked like an intent and by the engine, it carries no ids and no engine, starts nothing and cannot lower the confirmation.                                                                                                                                                                                                                              |
| Synchronous below a threshold N?    | No: one code path (unanimous after sign-off; 3:3 in the first round). Sophie vetoed a `wait` flag in the contract: Camunda 8 migrates atomically only one instance per request. Aylin, Eva and Jonas withdrew after the spikes: sync names only one failing instance, has no count in its answer and adds a request timeout as an unknown outcome. If users ask for it: an optional `migrateInstancesAtomically?(plan, ids)`, N ≤ 25, never a flag. |
| Instances with incidents?           | Eligible (unanimous): fixing an instance with a new version is the main case. The dialog says "5 have an incident and keep it; retry them on v3."                                                                                                                                                                                                                                                                                                   |
| `updateEventTriggers`?              | Fixed `false` (unanimous): due dates stay, nothing fires again; the dialog says which timers start again.                                                                                                                                                                                                                                                                                                                                           |

## Consequences

- Migration is the first feature that adds three reads at once; `ProcessRuntime` grows
  by `proposeMigration`, `checkMigration` and `getBulkFailures`, and every runtime
  (the fake, `FailingRuntime`, test doubles) implements them.
- The migration tab does not refresh on its own: the mapping is the user's work. The
  bulk poll goes on, and the tab loads again when the run is worked off or on Refresh,
  keeping the mapping.
- Out of scope: other process keys, variables in the plan, skipping listeners or
  input/output mappings, query-based selection, plans as files, `updateEventTriggers`,
  migrating a sub-process scope by itself, adopting a batch after a window reload.
- Review record: `.context/migration/` (not versioned).
