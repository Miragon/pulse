# @miragon/pulse-blocks

[![npm](https://img.shields.io/npm/v/@miragon/pulse-blocks?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-blocks)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/vscode/boards)

Pulse's building blocks: the React pieces more than one Pulse surface renders over the same data,
so a board looks and reads the same in Pulse for VS Code, Pulse for Orca and the cockpit of the
Pulse MCP server. Today they are the tiles of a board, over a built board's JSON form of
[`@miragon/pulse-board`](https://www.npmjs.com/package/@miragon/pulse-board): the counter, the
instance list, the incident summary, the incident list, the process diagram and the tile of a
widget the file breaks, in their grid. They came from the VS Code webview's board cards.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No host, no data, no navigation and no React context of its own: the tiles take a tile's data,
callbacks and the slots a surface brings, and render with
[`@miragon/pulse-ui`](https://www.npmjs.com/package/@miragon/pulse-ui). Reading the engines,
building the numbers and serializing them are the board package's (`BoardBuilder`,
`BoardJson.of`); where a click goes is the surface's. Since the tiles keep no context, a view
bundle may carry a second copy of them without splitting anything, so they stay off widget-shell's
`VIEW_BUNDLE_DEDUPE`.

## Install

```sh
npm install @miragon/pulse-blocks @miragon/pulse-ui react react-dom lucide-react
```

`react` and `react-dom` (19.2 or later), `lucide-react` and `@miragon/pulse-ui` are peers;
`@miragon/pulse-board` comes along for its types. Your Tailwind entry scans the package's build
(`@source "../node_modules/@miragon/pulse-blocks/dist"`, its tests left out), as it scans
pulse-ui's, or the tiles render without their classes.

## Minimal example

```tsx
import { BoardGrid, type BoardSlots } from "@miragon/pulse-blocks"
import type { BoardData } from "@miragon/pulse-board"

const slots: BoardSlots = {
  Table: MyTable,
  Id: MyId,
  Diagram: MyDiagram,
  onOpen: (target, how) => navigate(target, how.toSide),
}

export function Board({ data }: { data: BoardData }) {
  return <BoardGrid rows={data.rows} slots={slots} />
}
```

## The slots

The tiles own their columns, cells, words, group notes, problems and the card; the surface brings
the parts that follow its own conventions:

- `Table`: a table over the tile's rows (`BoardTableProps`: a label, the columns with each cell,
  the rows and their keys, `onOpen` for a row, `opens` for whether it opens anything, `openLabel`
  for a row's drill, `copyOf` for a row's copy, what it says without rows and the notes under
  them). Pulse for VS Code and Pulse for Orca open a row on a click or Enter and copy it with Ctrl
  or Cmd+C; the cockpit gives a row a drill, none where it opens nothing, and fits the rows its
  card has room for.
- `Id`: an id a cell shows short (`BoardIdProps`: the id and what it names).
- `Diagram`: the latest deployed version of a process with the counts on its elements
  (`BoardDiagramProps`: the engine, the definition, the badges, the canvas's name and `onSelect`
  for an element or a count chosen on it). The surface reads the diagram's XML itself.
- `onOpen(target, how)`: where a tile sends a click. A `BoardTarget` is the instances of a process
  or of an engine, with the filter a count names (`kind: "instances"`), or one instance, through
  its incident from a list of incidents (`kind: "instance"`). A count of instances without an
  incident opens nothing, since no list shows only those.
- `opens(target)`, optional: whether a target opens anything on the surface; without it every
  target does. One that opens nothing is offered nowhere: its count, summary row and diagram stay
  text, its list row has no drill. The cockpit opens no view of an engine it shows on boards only
  (Camunda 8); Pulse for VS Code and Pulse for Orca open every target.
- `onOpenFile`, optional: opens the board file; without it a refused tile offers no way to it.
- `opensToSide`, optional: the titles say that Ctrl or Cmd with a click opens beside the view.

## Words

The tiles word themselves in English and German, in the language of the nearest pulse-ui
`LocaleProvider` (German for a `de` tag, English for any other): titles from a widget's filter,
process or kind, counts and their engines, thresholds, columns, notes and every problem of a board
file with its values. Numbers and times render through pulse-ui's formatters in the locale set
with `setFormatLocale`, states through pulse-ui's `StateLabel`. The English words of a problem
equal `BoardProblems.describe` of the board package. `useProblemWords()` words a problem of the
file for a surface's own strips, and `ProblemList` lists problems with their paths.

The parts carry `data-part` hooks a surface's tests may query: `board-card` (`data-kind`: the
tile's kind), `counter-value`, `counter-partial`, `counter-threshold` (`data-state`: above,
undecided), `counter-entry`, `counter-count`, `group-note`, `incident-flag`, `refused-reason` and
`empty-hint`.

## Entries

| Entry                   | Holds                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-blocks` | `BoardGrid`, `BoardTile`, `ProblemList`, `useProblemWords` and the types of the slots and targets |

## Stability

Below 1.0 the blocks have no stability promise beyond the release train: a changed slot or target
is a breaking change and says so in its changelog entry. They read the `BoardData` of the
`@miragon/pulse-board` of the same release.

## Who uses it

- Pulse for VS Code and Pulse for Orca: the runtime view's webview renders a board's tiles with
  its table (row activation, the copy keys, its hooks), its short id and its diagram canvas.
- The Pulse MCP server: the cockpit's board route (`@miragon/pulse-engine-connector`) renders them
  with widget-shell's table (a drill per row, the inline fit), its copyable id and its BPMN canvas.

## Help and feedback

- **Documentation:** boards are explained at
  [miragon.github.io/pulse](https://miragon.github.io/pulse/vscode/boards).
- **Bugs and ideas:** found a bug or missing something?
  [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in
[CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md). The blocks keep
pulse-ui's house rules (function components, JSDoc) with the budgets of the code they came from:
complexity 10 and 300 lines per file, react-hooks' recommended-latest as errors. Their words are
held by `src/messages/glossary.test.ts` (the same keys in both languages, the product's glossary,
the count terms, brand-tone) and `src/messages/GLOSSARY.md`, their look by the brand gates of
`@miragon/pulse-ui/testing` (`src/brand-gates.test.ts`). They import only React, Lucide, pulse-ui's
root, `/format` and `/tones` and the board format's main entry (`blocks-are-building-blocks` in
the repository's `.dependency-cruiser.cjs`), and only a surface that renders them imports them
(`blocks-consumers`).

```sh
pnpm --fail-if-no-match --filter @miragon/pulse-blocks test
```

## License

[MIT](./LICENSE)
