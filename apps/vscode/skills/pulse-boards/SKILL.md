---
name: pulse-boards
description: Write or change a Pulse board file (`*.board.json`), the read-only view of counters, instance lists, incident summaries, incident lists and process diagrams over one or more process engines that Pulse for VS Code, Pulse for Orca and the Pulse MCP server show. Use whenever a board is asked for ("build a board for the order process", "add a counter for the instances waiting at X", "a board across dev and test") or a board file shows problems.
---

# Pulse boards: a board file that reads without a problem

A board keeps the questions a team asks again and again in one view: how many orders wait for
payment, which processes have incidents, which instances run at a step. It is one JSON file in
the repository, versioned and shared like the code, and it only reads. The docs are at
https://miragon.github.io/pulse/vscode/boards, the format's reference is the npm package
`@miragon/pulse-board` with its JSON Schema.

## 1. Where the file goes

| Reader                            | Place                                   | Its engines come from                  |
| --------------------------------- | --------------------------------------- | -------------------------------------- |
| Pulse for VS Code, Pulse for Orca | `.pulse/boards/<id>.board.json`         | `.pulse.json` or the CLI's user config |
| The Pulse MCP server, its web app | the directory `ENGINE_BOARDS_DIR` names | the server's profiles                  |

The file name is the board's id plus `.board.json`. The id starts with a letter or digit, then
letters, digits, `.`, `_` and `-`, 64 at most. The server skips a file named otherwise. One file
works for the editors and the server when both name the same engines.

## 2. Collect the facts before you write

A board names things by id, and a wrong id shows no error, only 0 or an empty list. Never guess one.

- Engines: the profile names of the reader, in the editors the keys under `profiles` of
  `.pulse.json`. A name no profile has shows as not configured, and its cells stay empty.
- Process: the BPMN process id (the `id` of the `process` element), not its name. Every version
  counts.
- Element: the id of the element where an instance waits (`activeElement`), from the same model.

Read both ids from the BPMN files of the repository:

```sh
grep -rho --include='*.bpmn' '<\(bpmn:\)\?process [^>]*id="[^"]*"' .
grep -o '<[a-zA-Z:]*\(Task\|CatchEvent\)[^>]*id="[^"]*"[^>]*name="[^"]*"' path/to/model.bpmn
```

Where the repository holds no model, ask for the ids, or read the deployed process definitions
from the engine if you have a tool for it.

## 3. The file

```json
{
  "schemaVersion": 1,
  "title": "Shop operations",
  "engines": ["shop-dev", "shop-test"],
  "rows": [
    {
      "row": [
        {
          "widget": "counter",
          "props": {
            "title": "Waiting for payment",
            "filter": { "process": "order-fulfillment", "activeElement": "Activity_AwaitPayment" },
            "warnAbove": 5
          }
        },
        { "widget": "incidentSummary", "props": { "groupBy": "process" } }
      ]
    },
    {
      "row": [
        {
          "widget": "processDiagram",
          "props": { "engines": ["shop-dev"], "process": "order-fulfillment" }
        }
      ]
    }
  ]
}
```

Root keys: `title`, `engines` (at least one, each once) and `rows` are required; `schemaVersion`
is 1. Each entry of `rows` is an object with one key, `row`, the widgets shown side by side. Any
other root key is a note, and `tenants` refuses every widget, since Pulse has no tenant filter.

### Widgets

| Widget            | Shows                                                               | Props beside `title` and `engines`             |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| `counter`         | How many instances match, per engine and in total                   | `filter`, `warnAbove` (an integer from 0)      |
| `instanceList`    | The first 50 matching instances of each engine with each total      | `filter`, `columns`                            |
| `incidentSummary` | Instances with an open incident                                     | `groupBy`: `engine` or `process` (the default) |
| `incidentList`    | The first 50 open incidents of each engine with element and message | `process` (optional)                           |
| `processDiagram`  | The latest deployed diagram of one engine with counts per element   | `process` (required)                           |

- `title` is the tile's heading. Give every tile one that says what its number means.
- `engines` on a widget narrows the board's engines and takes only names the board has. A
  `processDiagram` draws from exactly one engine, so it must name it when the board has several;
  compare two engines with two diagrams side by side.
- `columns` of an `instanceList`: `engine`, `process`, `version`, `businessKey`, `state`,
  `startedAt`, `endedAt`, `incident`. Without it: `businessKey`, `process`, `state`, `startedAt`.
  Add `engine` when the board reads several.

### Filter

| Key             | Means                                                                     |
| --------------- | ------------------------------------------------------------------------- |
| `process`       | BPMN process id, every version                                            |
| `activeElement` | Element id where a running instance waits; needs `process`, never `ended` |
| `state`         | `running` (the default) or `ended`                                        |
| `withIncident`  | `true`: an open incident now, never with `ended`; `false`: without one    |
| `businessKey`   | The business key, exactly                                                 |

### Limits

- 12 widgets at most on a board; a widget after the 12th is refused in its place.
- No unknown key anywhere inside a widget: it refuses that widget, and the others still read.
- No time window, no variable filter, no tenant: the format has none. Say so instead of inventing
  a key.

## 4. Lay it out

- First row: the numbers a reader checks first (counters, an `incidentSummary`), three or four in
  a row at most.
- Then the lists that explain them, a list and a summary side by side or a list alone.
- A `processDiagram` is wide: one per row, or two to compare two engines.
- One question per tile. A counter and a list with the same filter belong together: the count
  first, its rows below.
- Titles in sentence case, in the language of the team that reads the board, with Pulse's words:
  incident, "with incident", business key.

## 5. Check it

The parser of `@miragon/pulse-board` is the judge; it is what every reader runs. Install it into
a temporary folder, never into the project, and hand it the file's absolute path:

```sh
board="$PWD/.pulse/boards/shop-operations.board.json"
check="$(mktemp -d)" && npm install --prefix "$check" --silent --no-audit --no-fund @miragon/pulse-board
(cd "$check" && node --input-type=module -e '
import { readFileSync } from "node:fs"
import { BoardParser, BoardProblems, BoardTiles } from "@miragon/pulse-board"
const parsed = BoardParser.parse(readFileSync(process.argv[1], "utf8"))
const say = (problem) => console.log(`${problem.path} ${BoardProblems.describe(problem)}`)
if ("board" in parsed) {
  parsed.notes.forEach(say)
  for (const tile of BoardTiles.of(parsed.board).flat()) {
    if ("refused" in tile) tile.refused.forEach(say)
  }
  console.log(`reads: ${parsed.board.title}`)
} else {
  parsed.problems.forEach(say)
  process.exitCode = 1
}
' "$board")
```

A good file prints only its `reads:` line. Every other line is a problem or a note with its JSON
path (`rows[0].row[1].props.filter.state`); fix each and run it again. The check reads no engine:
it proves the file, not that an id exists there.

Then tell the user how to see it with numbers:

- Pulse for VS Code and Pulse for Orca list the file in the **Boards** view with its count of
  problems and reload an open board on save. **Pulse: New Board…** writes a starter board with the
  project's engines, a good file to start from.
- The Pulse MCP server reads its boards at startup, so a changed file needs a restart. Then ask
  for the board in the chat, or open `/app/boards/<id>` in the web app.
