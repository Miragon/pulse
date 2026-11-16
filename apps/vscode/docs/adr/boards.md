# Boards

- Status: accepted
- Last reviewed: 2026-11-16 (the webview's board cards moved into the published package `@miragon/pulse-blocks`, which words the tiles in English and German, every problem code included, and takes the webview's table, short id and canvas as slots; the protocol's problems stay codes; before that the same day, the webview gets a board in its JSON form, `BoardJson.of`, plus the targets and the diagram's XML); 2026-11-15 (a broken widget is refused in its place instead of the whole board, an unknown root key is a note, problems and notes are data with codes, the version rule, `tenants`, and a widget of ended instances with incident is refused; before that the same day, the format moved out of the runtime view into the published package `@miragon/pulse-board`, with its JSON Schema, shared fixtures and one starter board for both editors; the builder followed into its `./builder` entry, and the runtime view renders its model); 2026-11-14 (the counter and the incident summary read "with incident" one way, c7-core's runtime rule); 2026-11-12 (boards are the first feature of D2; the format and the builder move to a new published package); 2026-11-09 (the project file is read with `@miragon/pulse-profile`; before that 2026-11-04, the CLI's rules)

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
  [user-interface.md](user-interface.md) rejects the word. "Dashboards" names fixed views of
  the MCP server (the incident dashboard), "Views" is a VS Code term.
- The MCP server's saved dashboards of the time lived in the toolkit and widget-shell (zod,
  React, one engine per read); the server has dropped them since and keeps only fixed layouts.
  The extension may import none of it, and no second consumer would share a `-domain` package.
  Only the layout grammar (`rows[].row[]` with `widget` and `props`) is worth sharing as a
  convention.
- Every read the widgets need already exists as a port method (`countInstances`,
  `searchInstances`, `listDefinitions`, `describeEngine`). `InstanceSummary` carries no
  variables, so `var:` columns would cost one detail read per row.
- Each port call makes one or more REST calls; a board with N widgets over M engines
  multiplies them, and a stale password over M engines could lock users out.

## Decision

### Format

`.pulse/boards/<name>.board.json`, anywhere in the workspace, read by `BoardParser` of Pulse's
board format `@miragon/pulse-board` (`packages/core/board/src/format`, the format without a
runtime dependency, which the runtime view's core and the Boards view import through the package's
main entry) and validated by hand, unlike `.pulse.json`, which `@miragon/pulse-profile` parses. Every problem and every note is data, its JSON path, a code and the values its words need
(`{ path, code, values }`), which `BoardProblems.describe` words in English, so another surface
may word the codes in its language. `schemaVersion`
1, `title`, `engines` (profile names of `.pulse.json`, the only engine id the extension has),
`tenants` (optional, tenant ids) and
`rows`, each `{ "row": [...] }` of `{ "widget", "props" }`, the toolkit's layout grammar. The
widgets are `counter`, `instanceList`, `incidentSummary`, `processDiagram` and `incidentList`; a
widget may narrow the board's engines, and a `processDiagram` names exactly one. One filter
vocabulary without aliases: `process`, `activeElement` (needs `process`, never with `ended`),
`state` (`running` by default, `ended`), `withIncident` (`true` never with `ended`: an ended
instance holds no open incident, so such a counter or list could only read 0), `businessKey`. At
most 12 widgets. The file fails only when it gives no board (not JSON, no object, another
`schemaVersion`, `title`, `engines` or `rows` missing, or one of them, a row or `tenants` of the
wrong shape), and a broken save keeps the last valid board under its problems. A broken widget (a
bad or unknown prop, an unknown widget, a widget after the 12th that reads) is refused in its
place with its problems, which the board shows in a card where the widget would be, while the
others read; a root key the format does not know is a note, a quiet strip over the board. The Boards view counts
the problems of a file or of its refused widgets ("payments.board.json · 2 problems") and, without
them, its notes. `tenants` is kept, but each widget of such a board is refused in its place
(`tenantsNotRead`): no read of the contract filters by tenant on both dialects, and a widget
would read every tenant. The rule is the format's (`BoardTiles`), which the builder and the
Boards view both read, so the view counts these refusals as problems too.

The version rule: `schemaVersion` protects an older reader from a newer file. A root key that
changes what any widget reads (a tenant, a time window, a scope) or a changed meaning takes a new
version, and an older reader refuses that file. Under version 1 only root keys that change how
the board looks may be added, which an older reader notes; new widgets and new props stay in
version 1, because an older reader refuses such a widget in its place. A newer reader refusing
what an older one accepted is a breaking change of the package, not a new version.

The JSON Schema is the format's too (`packages/core/board/schema/board.schema.json`, published as
the package's `./schema/board.schema.json`): the package's
`packages/core/board/test/format/board-schema.test.ts` holds it equal to `BoardVocabulary` and
runs it over the shared fixtures (`BOARD_FIXTURES` of its `./testing` entry, a text and its
verdict each), of which it takes every board the parser reads without a note or a refused
widget, and marks an unknown root key and a filter of ended instances with incident. The editor
validates with a
checked-in copy, `apps/vscode/schemas/board.schema.json` (`jsonValidation`, shipped in the .vsix),
which `apps/vscode/test/architecture/board-schema.test.ts` holds byte-equal to the package's
schema, read through its export; a copy made at build time would be missing after a turbo cache
hit, under `pnpm test:one` and in a dev host started with F5, so a change to the schema copies it
over in the same commit.

Not interchangeable with the MCP server's layouts: same layout grammar, different widgets, data
binding and engine scope. No per-user boards, no interval in the file (a workspace file must
not add load), no writes.

### Reading

The numbers come from one builder over one read (D2): `BoardBuilder` of
`@miragon/pulse-board/builder` (`packages/core/board/src/builder`) reads seven reads of the
contract (`BoardReads`: `describeEngine`, `listDefinitions`, `countInstances`, `searchInstances`,
`getDiagramXml`, `getElementStatistics`, `searchIncidents`) and returns a `BoardModel` of no text,
formatting, diagram or navigation: per engine ready, failed with its error or not configured, per
tile the widget and its numbers from the contract's read models. The runtime view hands it to the
webview in the board's JSON form, `BoardData` of `@miragon/pulse-board`, which `BoardJson.of`
serializes for every surface (`BoardViews` in `packages/core/runtime-view/src/core/boards`; the
protocol keeps a copy of its tiles, held equal to the format's), with what only the editors add:
an engine's problem, the targets a click opens, against which the core checks an intent, and the
diagram's XML; a problem and a note stay codes with their values. The tiles are Pulse's building
blocks, `@miragon/pulse-blocks` (`packages/core/blocks`), created from the webview's cards: they
word a tile's title (the widget's, else one from its filter or kind), its counts, columns and
notes and every problem code in English and German, the English ones equal to
`BoardProblems.describe`, and take the surface's table, id and diagram as slots; the webview
renders them under an English `LocaleProvider` with its table (row activation, the copy keys),
its short id and its canvas, and words only what is its own (a file it could not read, the engine
strip). It reads over a `BoardRuntime` per engine and load that reads the definitions through the
panel's `SharedDefinitions` and the diagram once for the builder and the drawing.
`BoardPanel` publishes only `ready` states, so `PanelState` and `ViewSession` stay
single-engine. Per engine the builder probes `describeEngine` first and reads nothing else from an
engine that fails it; it reads each distinct question once per engine and load. Honest
numbers: totals come from counts and the shared definitions, never from page lengths; a failed
read shows "not read", never 0; a total says how many engines it counts ("from 2 of 3 engines"); a
threshold warns per engine, and a count that is only a lower bound at or below it reads
"stopped counting", never calm. `instanceList` shows each engine's first 50 rows with that
engine's total, in one table with an engine column and the rows of each engine together, because the contract promises no order across
engines. `incidentSummary` counts instances with incident from `listDefinitions`, one call per
engine. `processDiagram` draws the latest version of one engine's deployment with the
element statistics of that version, the same diagram and badges the definition panel draws: both
roll the counts inside a collapsed sub-process up onto it with the builder's `DiagramBadges`, and
the instance panel marks such a shape with its `CollapsedShapes`; a click on a count opens that
panel at the element. `incidentList` shows
each engine's first 50 open incidents from `searchIncidents` and says when more are open, since
the contract has no incident count. A broken save keeps the last valid board under its problems.

### Navigation and host

The intents `openBoardInstance`, `openBoardProcess`, `openBoardEngine`, `setBoardCredentials`
and `openBoardFile` carry engine names and ids; `BoardTargets` opens only what the shown view
lists, on the engine it came from, through the host's `BoardNavigation`
(`apps/vscode/src/host/boards/board-panels.ts`), which reuses the panel manager's existing
panels. The tiles take their data, callbacks and slots only, with no host context, and the board
screen turns a target they open into its intent. The **Boards** view lists the files (shown
only when there are any), a watcher reloads an open board on save, and **Pulse: New Board…**
writes the format's starter board (`StarterBoard.of(title, engines)`), the one Pulse for Orca
writes too.

## Consequences

- Boards refresh on open, on save and on Refresh; live updates for boards follow later, one
  live loop per engine under the existing `pulse.liveUpdates` rules.
- Deferred: `var:` columns (a variable projection in the contract with a law and a saboteur),
  oldest first and an age filter for stuck instances, a real incident count in the contract,
  and grouping incidents by message.
- Boards are the first feature of the owner decision D2 of 2026-11-12
  ([ui-foundation.md](ui-foundation.md)): once another surface shows them, every surface shows a
  board's numbers from one builder over one read, so the format and the builder leave the runtime
  view for a published package, `@miragon/pulse-board`: the format moved on 2026-11-15 (its
  problems read as before; a count in one reads in plain digits, which differs only from 1,000
  widgets on), the builder the same day into `./builder`, with the same numbers from the same
  reads; the MCP server and the web app render its model when they show boards. The counter's and the
  incident summary's readings of "with incident" are one since 2026-11-14 (owner decision): an
  open incident the runtime holds now, c7-core's rule, on every history level.
- `.pulse.json` is parsed in the CLI and in the extension by one package, Pulse's profile
  format `@miragon/pulse-profile`, which owns its JSON Schema and the fixtures that hold both
  readers to it ([architecture.md](architecture.md)).

## Decision log

| Question         | Decision                                                   | Why                                              |
| ---------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Name             | Boards                                                     | Cockpit, Dashboards and Views are taken          |
| Shape            | Toolkit layout grammar, own widgets                        | One layout vocabulary; data binding differs      |
| Engine reference | Profile name                                               | The only id; `.pulse.json` is shared in the repo |
| `health` widget  | Replaced by one status strip per engine                    | The engine overview exists; no green "healthy"   |
| Merge of lists   | One table, rows of each engine together, totals per engine | No order across engines in the contract          |
| Workspace trust  | No `capabilities`: off in untrusted folders                | `limited` would allow engine reads there         |
| Diagram scope    | One engine, latest version                                 | Deployments and versions differ between engines  |
| Schema home      | The format's package, a copy held equal in the extension   | A build copy is missing after a turbo cache hit  |
| Builder home     | `@miragon/pulse-board/builder`, a model of no text         | D2: every surface, one builder over one read     |
| Tile data        | The JSON form `BoardJson.of` gives, copied in the protocol | One form for every surface, words in the tiles   |
| Tiles            | `@miragon/pulse-blocks`, the surface's table, id, diagram  | One look on every surface, its own row rules     |
| A broken widget  | Refused in its place; an unknown root key is a note        | One typo no longer hides every number            |
| Version rule     | A root key that changes what a widget reads is a version   | An older reader never reads a newer file wrong   |
| Ended, incident  | Refused in its place                                       | It could only ever read 0                        |
| `tenants`        | Kept, each widget refused until the contract filters       | Reading every tenant would show others' numbers  |
