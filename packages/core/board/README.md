# @miragon/pulse-board

[![npm](https://img.shields.io/npm/v/@miragon/pulse-board?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-board)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/vscode/boards)

The board file format of Pulse. A board keeps the operational questions a team asks again and
again in one view: how many orders wait at a step, which incidents are open across "our"
processes, which instances of a process run. It is a JSON file in the repository
(`.pulse/boards/<name>.board.json`), versioned and shared like the code. Pulse for VS Code and
Pulse for Orca read it today; this package holds the format and the builder of a board's numbers,
so every surface that shows a board reads the same file the same way and shows the same numbers.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No runtime dependency, no file system, no engine of its own: the format imports only its own
modules and parses the text it is handed. Finding and reading the file and saying what follows from
a problem stay with the reader. The builder (`@miragon/pulse-board/builder`) reads a board's
numbers through the engines the reader hands it, over the engine contract of
`@miragon/pulse-engine-core` (an optional peer: install it next to this package to use the
builder), and returns them as data: no text, no formatting, no diagram, no navigation.

## Install

```sh
npm install @miragon/pulse-board
# with the builder, the engine contract it reads over:
npm install @miragon/pulse-board @miragon/pulse-engine-core
```

## Minimal example

```ts
import { BoardParser } from "@miragon/pulse-board"

const parsed = BoardParser.parse(text)
if ("board" in parsed) {
  for (const row of parsed.board.rows) console.log(row.map((widget) => widget.widget))
} else {
  for (const problem of parsed.problems) console.log(`${problem.path} ${problem.reason}`)
}
```

`BoardParser.parse` returns `{ board }` or `{ problems }`, never both: a board with defaults
filled in (running instances, the board's engines, the default columns), or every problem it
found, each with the JSON path it is about (`rows[0].row[1].props.filter.state`, or `(file)` for
the document) and the reason in English.

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
  `state` (`running` by default, or `ended`), `withIncident`, `businessKey`.
- `schemaVersion` 1, or none, which reads as 1.

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

`BoardBuilder.build(board, engines)` takes a parsed board and, per engine of the board, its name
and its reads (`BoardReads`, seven reads of `ProcessRuntime`: `describeEngine`, `listDefinitions`,
`countInstances`, `searchInstances`, `getDiagramXml`, `getElementStatistics`, `searchIncidents`); an
engine without reads is one the reader has not configured. It returns a `BoardModel`:

- per engine `ready` with its `EngineInfo` and its totals (running, with incident) from the
  definitions, `failed` with the error as thrown by `describeEngine`, or `notConfigured`. A failed
  engine is asked nothing else.
- per tile the parsed widget and its numbers: a counter's count per engine with a lower bound
  (`atLeast`) carried into the sum and a threshold's `above` or, for a lower bound at or below it,
  `undecided`; an instance list's first page per engine with its total; the instances with
  incident per engine or per process, most first; an incident list's first incidents per engine and
  whether more are open; a diagram's latest version (`DefinitionRef`) with its badges, the counts
  per element rolled up onto collapsed sub-processes, or `notDeployed`.

Honest numbers: a read that fails leaves its number out (a surface shows "not read", never 0), a
total says how many engines it counts (`known`), totals come from counts and the definitions, never
from the length of a page, and each distinct question is read once per engine and build.
`DiagramBadges.of(xml, statistics)` is the roll-up (the incidents inside a collapsed sub-process
counted on its shape too) and `CollapsedShapes.of(xml)` the reader of the collapsed sub-processes
around an element, so a surface draws its process views by the same rule as a board.

## A new board

`StarterBoard.of(title, engines)` returns the text of the board Pulse for VS Code's **Pulse: New
Board…** and Pulse for Orca's new board write: the instances running and those with an incident,
the incidents per process and a list of the running instances, over the engines it is given. It
adds no engine of its own: a starter board written without engines is refused when it is read, with
the problem at `engines`.

## The JSON Schema

`schema/board.schema.json` (`@miragon/pulse-board/schema/board.schema.json`) lets an editor
complete and check a board file. It knows exactly the keys, widgets, props and values the parser
reads, and takes every board of the fixtures below that the parser takes; what only the parser
sees (more than 12 widgets, a widget naming an engine outside the board, an element without its
process) it leaves to the parser. Pulse for VS Code ships a copy of it, held equal by a test.

## Fixtures

`@miragon/pulse-board/testing` exports `BOARD_FIXTURES`: each case a board file's text, whether
the JSON Schema takes it and the parser's verdict as data, a board with its defaults filled in or
every problem with its path. The package's tests run them through the parser and the schema; a
reader of its own runs them through its path.

## Entries

| Entry                                           | Holds                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-board`                          | `BoardParser`, `BoardVocabulary`, `StarterBoard` and the types of a board, its widgets and problems |
| `@miragon/pulse-board/builder`                  | `BoardBuilder`, `DiagramBadges`, `CollapsedShapes` and the types of `BoardModel` and `BoardReads`   |
| `@miragon/pulse-board/schema/board.schema.json` | The JSON Schema of a board file                                                                     |
| `@miragon/pulse-board/testing`                  | `BOARD_FIXTURES`, the shared fixtures                                                               |

## Stability

Below 1.0 the format has no stability promise beyond the release train: a change that makes a
file valid today refused tomorrow says so in its changelog entry. The same holds for the builder's
`BoardModel`, the input of every surface that renders a board, and for its peer: the builder takes
the `@miragon/pulse-engine-core` of the same release.

## Licence

[MIT](LICENSE)
