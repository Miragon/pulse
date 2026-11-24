# Migration plans

A migration plan file says how the instances of one process would move from one version to
another: the BPMN process id, two version numbers and one to one pairs of element ids. It names no
engine, no definition id and no instance, so it fits every engine that has both versions, and
opening it migrates nothing. The [Pulse CLI](../cli/workflow-commands.md) writes it, and Pulse for
VS Code edits it in diagrams of both versions, checked on an engine you pick. Pulse for Orca opens
the file as text.

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

## Edit it

On a `.migration.json` file, run **Pulse: Edit Migration Plan…** from the command palette, the
explorer's context menu or the text editor's title bar, or reopen the file with _Pulse Migration
Plan_. Pulse offers the engines that check plans, not a Camunda 8 cluster or one whose connection
it refuses: one opens at once, several give a pick. Run the command again to check on another.

The editor draws both versions and lists each element with its target, its tokens and the check,
then says whether the plan fits. Pick a target in the list, or map in the diagrams as in the
Camunda 7 Cockpit: drag the arrow handle at an element's corner onto a marked element of the other
version, or click the handle and then the element; Esc cancels, and the second handle removes the
mapping. Hovering an element marks its counterpart; _Show all mappings_ draws every pair as an
arrow, red where it doesn't fit; both diagrams pan and zoom together unless you uncheck _Pan and
zoom together_.

Every change is an edit of the open file, so undo, save and the Git diff work as for text, and
_Open file_ shows the text beside it, which follows. The engine checks each changed plan; an edit in
the text shows in the diagrams too. An edit writes the plan through the format's writer, without a
root key Pulse ignores. The editor writes only the file and starts nothing on the engine: a
migration in the definition panel doesn't use the file and moves only the instances you select, at
most 1,000 at a time.

Tokens count what waits at an element across the whole version, active or with incident; one
instance can hold several, so Pulse never sums them. An element where tokens wait without a mapping
is flagged. The bar counts the source version's running instances and those with incident from the
runtime, so every history level reads the same.

Pulse refuses a version the engine lacks or has more than once (tenants), a file it can't read, one
over 1,048,576 characters and one with problems, among them an engine's plan and a key reserved for
ids, engines, tenants or engine options (`instanceIds`, `tenantId` …) at the root, in a side or in
a mapping; it notes another root key and never reads it. Each names the file and offers Refresh and
_Open file_. A pair that doesn't fit (a missing element, a target of another kind, a scope its
element lacks or one mapped to another) is named on its row, never sent; the engine checks the rest.
