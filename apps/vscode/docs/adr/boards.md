# Boards

- Status: accepted
- Last reviewed: 2026-10-26

## Context

Pulse had fixed screens only. Teams ask the same operational questions again and again (orders
stuck at a step, incidents across "their" processes, running instances of a process) and could
neither keep a view nor share one (#455). The issue proposed user-defined "cockpits" as JSON in
the workspace, read only, from a fixed widget catalog, across several engines, and asked to
compare with the MCP server's dashboards first so the repository grows no second format.

Five independent reviews (an architect of the extension, an ops engineer on call, a process
developer who writes the files, the maintainer of the monorepo, a UX designer) agreed on the
decisions below in one round; a sixth review checked the result against the code.

What they found:

- "Cockpit" names Camunda 7's web app; the extension already says "Open in Cockpit" and
  [user-interface.md](user-interface.md) rejects the word. "Dashboards" is the MCP server's
  different format, "Views" is a VS Code term.
- The MCP dashboards (`render-view`, the builder, `shell:kpi-grid` / `shell:data-table`) live
  in the toolkit and widget-shell: zod, React, data bound through `keys` and pipeline `steps`,
  one engine per read. The extension may import none of it, and no second consumer would share
  a `-domain` package. Only the layout grammar (`rows[].row[]` with `widget` and `props`) is
  worth sharing as a convention.
- Every read the widgets need already exists as a port method (`countInstances`,
  `searchInstances`, `listDefinitions`, `describeEngine`). `InstanceSummary` carries no
  variables, so `var:` columns would cost one detail read per row.
- Each port call starts a CLI process; a board with N widgets over M engines multiplies that,
  and a stale password over M engines could lock users out.

## Decision

### Format

`.pulse/boards/<name>.board.json`, anywhere in the workspace, read by `BoardParser`
(`apps/vscode/src/core/boards`), validated by hand like `.pulse-cli.json`. Every problem names
its JSON path and reason. `schemaVersion` 1, `title`, `engines` (profile names of
`.pulse-cli.json`, the only engine id the extension has) and `rows`, each `{ "row": [...] }`
of `{ "widget", "props" }`, the toolkit's layout grammar. The widgets are `counter`,
`instanceList`, `incidentSummary`, `processDiagram` and `incidentList`; a widget may narrow
the board's engines, and a `processDiagram` names exactly one. One filter
vocabulary without aliases: `process`, `activeElement` (needs `process`, never with `ended`),
`state` (`running` by default, `ended`), `withIncident`, `businessKey`. At most 12 widgets.
The editor validates with `apps/vscode/schemas/board.schema.json` (`jsonValidation`, shipped in
the .vsix); `apps/vscode/test/architecture/board-schema.test.ts` holds it equal to
`BoardVocabulary`.

Not interchangeable with MCP dashboards: same layout grammar, different widgets, data binding
and engine scope. No per-user boards, no interval in the file (a workspace file must not add
load), no writes.

### Reading

`BoardPanel` publishes only `ready` states, so `PanelState` and `ViewSession` stay
single-engine. Per engine it probes `describeEngine` first and reads nothing else from an engine
that fails it; `EngineReads` reads each distinct question once per engine and load. Honest
numbers: totals come from counts and the shared definitions, never from page lengths; a failed
read shows "not read", never 0; a total says how many engines it counts ("from 2 of 3 engines"); a
threshold warns per engine. `instanceList` shows each engine's first 50 rows with that
engine's total, in one table with an engine column and the rows of each engine together, because the contract promises no order across
engines. `incidentSummary` counts instances with incident from `listDefinitions`, one call per
engine. `processDiagram` draws the latest version of one engine's deployment with the
element statistics of that version, the same diagram and badges the definition panel draws
(`ElementBadges`); a click on a count opens that panel at the element. `incidentList` shows
each engine's first 50 open incidents from `searchIncidents` and says when more are open, since
the contract has no incident count. A broken save keeps the last valid board under its problems.

### Navigation and host

The intents `openBoardInstance`, `openBoardProcess`, `openBoardEngine`, `setBoardCredentials`
and `openBoardFile` carry engine names and ids; `BoardTargets` opens only what the shown view
lists, on the engine it came from, through the host's `BoardNavigation`
(`apps/vscode/src/host/boards/board-panels.ts`), which reuses the panel manager's existing
panels. The **Boards** view lists the files (shown only when there are any), a watcher reloads
an open board on save, and **Pulse: New Board…** writes a starter board.

## Consequences

- Boards refresh on open, on save and on Refresh; live updates for boards follow later, one
  live loop per engine under the existing `pulse.liveUpdates` rules.
- Deferred: `var:` columns (a variable projection in the contract with a law and a saboteur),
  oldest first and an age filter for stuck instances, a real incident count in the contract,
  and grouping incidents by message.
- `.pulse-cli.json` is parsed in the CLI and in the extension with different rules; a shared
  profile schema in a `-domain` package is its own change.

## Decision log

| Question         | Decision                                                   | Why                                                  |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| Name             | Boards                                                     | Cockpit, Dashboards and Views are taken              |
| Shape            | Toolkit layout grammar, own widgets                        | One layout vocabulary; data binding differs          |
| Engine reference | Profile name                                               | The only id; `.pulse-cli.json` is shared in the repo |
| `health` widget  | Replaced by one status strip per engine                    | The engine overview exists; no green "healthy"       |
| Merge of lists   | One table, rows of each engine together, totals per engine | No order across engines in the contract              |
| Workspace trust  | No `capabilities`: off in untrusted folders                | `limited` would allow engine reads there             |
| Diagram scope    | One engine, latest version                                 | Deployments and versions differ between engines      |
