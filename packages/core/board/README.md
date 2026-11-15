# @miragon/pulse-board

[![npm](https://img.shields.io/npm/v/@miragon/pulse-board?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-board)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/vscode/boards)

The board file format of Pulse. A board keeps the operational questions a team asks again and
again in one view: how many orders wait at a step, which incidents are open across "our"
processes, which instances of a process run. It is a JSON file in the repository
(`.pulse/boards/<name>.board.json`), versioned and shared like the code. Pulse for VS Code and
Pulse for Orca read it today; this package holds the format, so every surface that shows a board
reads the same file the same way. Below 1.0: pin the exact version and update all
`@miragon/pulse-*` packages together.

## What it is not

No runtime dependency, no file system, no engine: it imports only its own modules and parses the
text it is handed. Finding and reading the file, the engines a board names, reading its numbers
and saying what follows from a problem stay with the reader.

## Install

```sh
npm install @miragon/pulse-board
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

`BoardVocabulary` lists every key, widget, prop, state, grouping and column, so a JSON Schema
or a reader of its own can be held to the parser.

## Entries

| Entry                  | Holds                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `@miragon/pulse-board` | `BoardParser`, `BoardVocabulary` and the types of a board, its widgets and problems |

## Stability

Below 1.0 the format has no stability promise beyond the release train: a change that makes a
file valid today refused tomorrow says so in its changelog entry.

## Licence

[MIT](LICENSE)
