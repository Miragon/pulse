# Migration plans

A migration plan file says how the instances of one process would move from one version to
another: the BPMN process id, two version numbers and one to one pairs of element ids. It names no
engine, no definition id and no instance, so it fits every engine that has both versions, and
opening it migrates nothing. The [Pulse CLI](../cli/workflow-commands.md) writes it, and Pulse for
VS Code previews it on an engine you pick. Pulse for Orca opens the file as text.

## Write one

```text
pulse plan-migration invoice 1 2
pulse plan-migration invoice 1 --map check=review --unmap notify
```

`pulse plan-migration <key> <source> [target]` asks the engine for its mapping between two
versions of the process (the target defaults to the latest), applies `--unmap <source>` and
`--map <source>=<target>`, has the engine check the result and writes
`.pulse/migrations/invoice-v1-to-v2.migration.json`, or the `.migration.json` path of
`--plan-file`. It changes nothing on the engine, so a read-only profile is enough; when the engine
finds problems, it still writes the file and exits with code 9. Edited by hand in
`.pulse/migrations/`, the file gets completion and checks from its schema:

```json
{
  "schemaVersion": 1,
  "bpmnProcessId": "invoice",
  "source": { "version": 1 },
  "target": { "version": 2 },
  "mappings": [
    { "sourceElementId": "approve", "targetElementId": "approve" },
    { "sourceElementId": "check", "targetElementId": "review" }
  ]
}
```

A multi-instance element maps its scope too, as `<id>#multiInstanceBody`. The format's rules are in
[the README of `@miragon/pulse-migration-plan`](https://github.com/Miragon/pulse/blob/main/packages/core/migration-plan/README.md).

## Preview it

On a `.migration.json` file, run **Pulse: Preview Migration Plan…** from the command palette, the
explorer's context menu or the editor's title bar. Pulse offers the engines that check migration
plans, which a Camunda 8 cluster doesn't: one opens at once, several give a pick. The preview reads
the saved file; Refresh, or the command again, reads the file and the engine anew.

The tab draws both versions and lists each element with its target, its tokens and the check, then
says whether the plan fits. Tokens count what waits at an element across the whole version, active
or with incident; one instance can hold several, so Pulse never sums them. An element where tokens
wait without a mapping is flagged. The bar counts the source version's running instances and those
with incident from the runtime, so every history level reads the same. _Open v1_, _Open v2_ and
_Show file_ open the definition panel or the file: the preview starts nothing. A migration there
moves only the instances you select, at most 1,000 at a time, and asks the engine for its mapping.

Pulse refuses a file it can't read, one over 1,048,576 characters and one with problems, the first
named with its path; an engine's own plan (`pulse migration generate-plan`, by definition ids) is
one, as are instance ids, engines, tenants, definition ids and engine options anywhere in it. It
refuses a version the engine doesn't have or has more than once, one per tenant. A pair that
doesn't fit (an element that isn't there or no migration maps, a target of another kind, a scope
the element doesn't have) is left out, named on its row and never sent; the engine checks the rest.
