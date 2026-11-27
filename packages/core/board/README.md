# @miragon/pulse-board

[![npm](https://img.shields.io/npm/v/@miragon/pulse-board?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-board)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/vscode/boards)

The board file format of Pulse. A board keeps the operational questions a team asks again and
again in one view: how many orders wait at a step, which incidents are open across "our"
processes, which instances of a process run. It is a JSON file in the repository
(`.pulse/boards/<name>.board.json`), versioned and shared like the code
([Boards](https://miragon.github.io/pulse/vscode/boards) in the docs).
[Pulse for VS Code](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit),
[Pulse for Orca](https://miragon.github.io/pulse/orca/) and the
[Pulse MCP server](https://miragon.github.io/pulse/mcp/boards) read it; this package holds the
format and the builder of a board's numbers, so every surface that shows a board reads the same
file the same way and shows the same numbers.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No runtime dependency, no file system, no engine of its own: the format imports only its own
modules and parses the text it is handed. Finding and reading the file and saying what follows from
a problem stay with the reader. The builder (`@miragon/pulse-board/builder`) reads a board's
numbers through the engines the reader hands it, over the engine contract of
[`@miragon/pulse-engine-core`](https://www.npmjs.com/package/@miragon/pulse-engine-core) (an
optional peer: install it next to this package to use the builder), and returns them as data: no
text, no formatting, no diagram, no navigation.

## Install

```sh
npm install @miragon/pulse-board
# with the builder, the engine contract it reads over:
npm install @miragon/pulse-board @miragon/pulse-engine-core
```

## Minimal example

```ts
import { BoardParser, BoardProblems, BoardTiles, type BoardProblem } from "@miragon/pulse-board"

const parsed = BoardParser.parse(text)
const say = (problem: BoardProblem) =>
  console.log(`${problem.path} ${BoardProblems.describe(problem)}`)
if ("board" in parsed) {
  for (const tile of BoardTiles.of(parsed.board).flat()) {
    if ("refused" in tile) tile.refused.forEach(say)
    else console.log(tile.widget)
  }
  parsed.notes.forEach(say)
} else {
  parsed.problems.forEach(say)
}
```

`BoardParser.parse` returns `{ board, notes }` or `{ problems }`, never both. The file fails only
when it gives no board: it is not JSON or no object, its `schemaVersion` is other than 1,
`title`, `engines` or `rows` is missing, or one of them, a row or `tenants` is of the wrong shape.
Everything inside a widget (a bad or unknown prop, an unknown widget, a widget after the 12th that
reads) refuses that widget in its place, as `{ widget, title, refused }`, and the others read. A
root key the format does not know is a note, and so is a `$schema` that is no text; the board
shows without them. A board has its defaults filled in (running instances, the board's engines,
the default columns). A problem and a note are data, `{ path, code, values }`: the JSON path it
is about (`rows[0].row[1].props.filter.state`, or `(file)` for the document), a code from
`BoardProblemCode` and the values its words need; `BoardProblems.describe` words it in English,
the sentence after the path, so a reader may word the codes in its own language.

## The format

```json
{
  "schemaVersion": 1,
  "title": "Order operations",
  "engines": ["shop-dev", "shop-test"],
  "rows": [
    {
      "row": [
        {
          "widget": "counter",
          "props": {
            "title": "Waiting for payment",
            "filter": { "process": "order", "activeElement": "Task_Pay" },
            "warnAbove": 10
          }
        },
        { "widget": "incidentSummary", "props": { "groupBy": "process" } }
      ]
    }
  ]
}
```

- `engines` names the board's engines by their profile names; a widget may narrow them, and a
  `processDiagram` names exactly one.
- The widgets: `counter`, `instanceList`, `incidentSummary`, `processDiagram` and
  `incidentList`, at most 12 on a board.
- One filter vocabulary: `process`, `activeElement` (needs `process`, never with `ended`),
  `state` (`running` by default, or `ended`), `withIncident` (`true` never with `ended`, since
  an ended instance holds no open incident and such a widget could only show 0), `businessKey`.
- `tenants`, optional: a list of different tenant ids. `BoardTiles.of(board)` gives a board's rows
  as a reader reads them, each widget of such a board refused in its place (`tenantsNotRead`),
  because no read of the engine contract filters by tenant on both dialects, and a widget would
  read every tenant. The builder reads a board through it, and so does a reader that counts a
  board's problems.
- `schemaVersion` 1, or none, which reads as 1.

The version rule: `schemaVersion` protects an older reader from a newer file. A root key that
changes what any widget reads (a tenant, a time window, a scope) or a changed meaning takes a new
version, and an older reader refuses that file. Under version 1 only root keys that change how
the board looks may be added, which an older reader notes and skips; new widgets and new props
stay in version 1, because an older reader refuses such a widget in its place. A newer reader
refusing what an older one accepted is a breaking change of this package, not a new version.

`BoardVocabulary` lists every key, widget, prop, state, grouping and column, so a reader of its
own can be held to the parser, as the package holds its JSON Schema.

## The builder

```ts
import { BoardBuilder } from "@miragon/pulse-board/builder"

const model = await BoardBuilder.build(board, [
  { name: "shop-dev", reads: runtimeOf("shop-dev") },
  { name: "shop-test" },
])
```

`BoardBuilder.build(board, engines, options?)` takes a parsed board and, per engine of the board,
its name and its reads (`BoardReads`, seven reads of `ProcessRuntime`: `describeEngine`,
`listDefinitions`, `countInstances`, `searchInstances`, `getDiagramXml`, `getElementStatistics`,
`searchIncidents`); an engine without reads is one the reader has not configured. It returns a
`BoardModel`:

- per engine `ready` with its `EngineInfo` and its totals (running, with incident) from the
  definitions, `failed` with the error as thrown by `describeEngine`, or by `listDefinitions` when
  it is a `RuntimeError` of the failure `misconfigured` (an engine that says what it is but answers
  no read, a Camunda 8 cluster without secondary storage say), or `notConfigured`. A failed engine
  is asked nothing else.
- per tile the parsed widget and its numbers, or `refused` with its problems, which reads
  nothing: a widget the parser refused, and each widget `BoardTiles` refuses on a board with
  `tenants` (`tenantsNotRead`). A counter's count per engine with a lower bound
  (`atLeast`) carried into the sum and a threshold's `above` or, for a lower bound at or below it,
  `undecided`; an instance list's first page per engine with its total; the instances with
  incident per engine or per process (a key in one tenant: a key deployed in two tenants is a
  row each), most first; an incident list's first incidents per engine and whether more are open;
  a diagram's latest version (`DefinitionRef`) with its badges, the counts per element rolled up
  onto collapsed sub-processes, or `notDeployed`. A diagram names its process by its key alone: of
  a key deployed in several tenants it draws the one engine-core's `ProcessTenants` names, the
  process without a tenant, else the first tenant's by id. In the JSON form a version names its
  tenant (`tenantId`) only where it has one.
- its notes (`notes`, none when it has none): a diagram longer than the builder reads (over 4 Mi
  characters) keeps the badges of its elements, rolls nothing up, and gets the note
  `diagramTooLong` at its tile's path (`rows[1].row[0]`), whose values name the tile as its card
  does (the widget's title, else the process's name or id) and its engine, so no badge
  goes missing without a word and a surface names the tile, not a path, to whoever reads the board.

Each engine has a deadline that starts with the build: `BoardBuilder.ENGINE_DEADLINE_MS`, 15
seconds, unless the reader passes its own (`BoardBuildOptions`, `{ engineDeadlineMs }`): from 1 to
2147483647 ms, the range of a timer, or `Infinity` for none; any other value rejects the build with
a `RangeError` that names the option, before any read. An engine's tiles read as soon as it said
what it is, never after a slower engine. Once its deadline passed, its reads still out reject as a
`RuntimeError` of the failure `unreachable` that names the engine and the deadline, and it is asked
nothing more, so it shows as any failed read does: failed when it has not said what it is, else its
numbers not read, while the other engines' tiles read on time. The builder cancels no read of the
reader's (`BoardReads` takes no signal): a read the deadline cut runs on until the reader's own
deadline ends it or the reader cancels it.

Honest numbers: a read that fails leaves its number out (a surface shows "not read", never 0), a
total says how many engines it counts (`known`), totals come from counts and the definitions, never
from the length of a page, and each distinct question is read once per engine and build. Its lists
rest on read laws of the engine contract, which the contract's conformance kit holds every dialect
to: instances and incidents newest first, incidents in pages without gaps, every page but the last
full.

`DiagramBadges.of(xml, statistics)` is the roll-up (the incidents inside a collapsed sub-process
counted on its shape too), `CollapsedShapes.of(xml)` the reader of the collapsed sub-processes
around an element and `CallActivities.found(xml)` whether a diagram has a call activity, by the
element alone, its id quoted either way or missing, `undefined` for a text too long to read (the
screens' builder and the editors' core read the processes a version calls unless it is `false`),
so a surface draws its process views by the same rule as a board. It reads the
tags in one pass, in time that grows with the text: a comment, a CDATA section and a processing
instruction to their own ends, a quoted `>` as part of its tag, and no tag of markup that never
ends or of a text over 4 Mi characters (`XmlTags.readable`), which rolls up nothing. c8-core's BPMN text reads over a
copy of this tag reader, which `scripts/xml-tag-readers.test.mjs` holds equal to it.

## The JSON form

```ts
import { BoardJson } from "@miragon/pulse-board/builder"

const data = BoardJson.of(model, {
  failureOf: (error) => ({ code: codeOf(error), message: messageOf(error) }),
  notes: parsed.notes,
})
```

A `BoardModel` holds the engine contract's read models and each failed engine's error as thrown,
so it does not travel. `BoardJson.of` turns it into `BoardData`, the one JSON form of a built
board: a surface that hands a board on, to a webview or to an MCP view, sends this data and maps
nothing by hand. It holds:

- the board's title and its notes: the file's, as the parser gave them, then the builder's;
- per engine `ready` with its product, version and totals, `notConfigured`, or `failed` with the
  `failure` the surface's `failureOf` makes of the error, a code and a message of its own (the
  contract's failure kinds, an engine error code);
- per tile its widget as the parser gave it, of the format's own type, and its numbers as in the
  model: a number that was not read stays out.

Ids and dates are texts. Of the model it keeps each field it names, so a field the model gains
stays out until the form names it too, and of the read models it keeps what a tile shows (an
incident's job and details stay out), so `JSON.parse(JSON.stringify(data))` equals `data`. Its types (`BoardData`,
`EngineData`, `TileData` and one per kind of tile) come from the main entry, without the engine
contract, so a renderer reads them without the builder. What only a surface knows (the read time,
its navigation, the diagram's XML) goes beside it, and the surface words every title, number and
problem in its own language.

`BoardVocabulary.JSON_VERSION` (1 today) is the version of this form, apart from the file's
`schemaVersion`. A surface that hands a built board to a reader it does not ship with sends the
version beside it, as the Pulse MCP server's model tool `engine_get_board` does (`formatVersion`),
so the reader refuses a version it does not know. A key removed or renamed, or a key or code whose
meaning changes, takes the next version; a key or code added keeps it, and a reader passes over
what it does not know.

## A new board

`StarterBoard.of(title, engines)` returns the text of the board Pulse for VS Code's **Pulse: New
Board…** and Pulse for Orca's new board write: the instances running and those with an incident,
the incidents per process and a list of the running instances, over the engines it is given. It
adds no engine of its own: a starter board written without engines is refused when it is read, with
the problem at `engines`.

## The JSON Schema

`schema/board.schema.json` (`@miragon/pulse-board/schema/board.schema.json`) lets an editor
complete and check a board file. It knows exactly the keys, widgets, props and values the parser
reads, marks a root key the parser only notes and a filter of ended instances with incident, and
takes every board of the fixtures below that the parser reads without a note or a refused widget;
what only the parser sees (more than 12 widgets, a widget naming an engine outside the board, an
element without its process) it leaves to the parser. Pulse for VS Code ships a copy of it, held
equal by a test.

## Fixtures

`@miragon/pulse-board/testing` exports `BOARD_FIXTURES`: each case a board file's text, whether
the JSON Schema takes it and the parser's verdict as data, a board with its defaults filled in,
its refused widgets and its notes, or every problem of a file that gives no board. The package's
tests run them through the parser and the schema; a reader of its own runs them through its path.

It also exports `BoardFigures`: `BoardFigures.of(data)` reads a built board's JSON form as its
figures, each engine's totals or state and each tile's numbers by engine, without what an engine
makes on its own (ids, dates, the order of rows). The engine suites of every surface compare a
board built over a live engine with the board of the conformance kit's fake world and with a
dialect's recorded board by it, so one rule decides what counts as the same numbers.

## Entries

| Entry                                           | Holds                                                                                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-board`                          | `BoardParser`, `BoardProblems`, `BoardTiles`, `BoardVocabulary`, `StarterBoard` and the types of a board, its widgets and problems and of a built board's JSON form (`BoardData`) |
| `@miragon/pulse-board/builder`                  | `BoardBuilder`, `BoardJson`, `DiagramBadges`, `CollapsedShapes`, `CallActivities` and the types of `BoardModel`, `BoardReads` and `BoardBuildOptions`                             |
| `@miragon/pulse-board/schema/board.schema.json` | The JSON Schema of a board file                                                                                                                                                   |
| `@miragon/pulse-board/testing`                  | `BOARD_FIXTURES`, the shared fixtures, and `BoardFigures`, a built board's figures                                                                                                |

## Stability

Below 1.0 the format has no stability promise beyond the release train: a change that makes a
file or a widget valid today refused tomorrow is a breaking change and says so in its changelog
entry (the version rule above). The same holds for the builder's `BoardModel` and its JSON form
`BoardData`, the input of every surface that renders a board, and for its peer: the builder takes
the `@miragon/pulse-engine-core` of the same release.

## Who uses it

- Pulse for VS Code and Pulse for Orca: the runtime view they share reads an open board with the
  format, builds its numbers with the builder over the engines of their profiles, hands the webview
  their JSON form (`BoardJson.of`) and draws its process views by the builder's roll-up; a new
  board is `StarterBoard`'s text, and the Boards view of VS Code counts each file's problems and
  notes with `BoardTiles`.
- The Pulse MCP server: its engine module,
  [`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector),
  reads the board files of `ENGINE_BOARDS_DIR` with the format at boot, builds a board's numbers
  with the builder over each engine's runtime and serves them in their JSON form (`BoardJson.of`)
  to its cockpit through the app-only feed `engine_board_data`, and with its version to any page
  through the model tool `engine_get_board`.
- [`@miragon/pulse-blocks`](https://www.npmjs.com/package/@miragon/pulse-blocks), Pulse's building
  blocks: a board's tiles over the types of `BoardData`, which the webview of both editors and the
  MCP server's cockpit render.

## Help and feedback

- **Documentation:** boards in Pulse for VS Code and Pulse for Orca are explained at
  [miragon.github.io/pulse](https://miragon.github.io/pulse/vscode/boards), in the MCP server at
  [Boards](https://miragon.github.io/pulse/mcp/boards).
- **Bugs and ideas:** found a bug or missing something?
  [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in
[CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md). Two rules hold this
package on top of the repository's.

### Mutation testing

The format and the builder are mutation-tested every night in the repository (StrykerJS over
`src/format` and `src/builder` without the tests and the builder's barrel, against the package's
own tests; owner decision 2026-11-15). They decide which board files and widgets every surface
reads or refuses and the numbers each widget shows, so a surviving mutant is a wrong refusal or a
wrong number on every board. Locally:
`pnpm --fail-if-no-match --filter @miragon/pulse-board exec stryker run`.

### Style

The house rules of Pulse for VS Code, which the format came from, as in
`@miragon/pulse-engine-core`: classes, not module functions, no comments, complexity 10, 300 lines
per file (400 for a test file), 60 per function, no engine word such as a vendor's name anywhere in
it. The repository's ESLint config holds the package to them.

## Licence

[MIT](LICENSE)
