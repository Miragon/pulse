# @miragon/pulse-blocks

[![npm](https://img.shields.io/npm/v/@miragon/pulse-blocks?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-blocks)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/vscode/boards)

Pulse's building blocks: the React pieces more than one Pulse surface renders over the same data,
so a board looks and reads the same in Pulse for VS Code, Pulse for Orca and the cockpit of the
Pulse MCP server. They are the tiles of a board, over a built board's JSON form of
[`@miragon/pulse-board`](https://www.npmjs.com/package/@miragon/pulse-board): the counter, the
instance list, the incident summary, the incident list, the process diagram and the tile of a
widget the file breaks, in their grid. They came from the VS Code webview's board cards. And they
are the blocks of the screens the editors and the web app of the Pulse MCP server share, over the
screens' JSON forms of
[`@miragon/pulse-screens`](https://www.npmjs.com/package/@miragon/pulse-screens): an engine's
process table and the filter bar above it.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No host, no data, no navigation and no React context of its own: the blocks take their data,
callbacks and the slots a surface brings, and render with
[`@miragon/pulse-ui`](https://www.npmjs.com/package/@miragon/pulse-ui). Reading the engines,
building the numbers and serializing them are the board package's (`BoardBuilder`,
`BoardJson.of`) and the screens package's (`EngineScreen`, `ScreenJson`); where a click goes is the
surface's. Since the tiles keep no context, a view
bundle may carry a second copy of them without splitting anything, so they stay off widget-shell's
`VIEW_BUNDLE_DEDUPE`.

## Install

```sh
npm install @miragon/pulse-blocks @miragon/pulse-ui react react-dom lucide-react
```

`react` and `react-dom` (19.2 or later), `lucide-react` and `@miragon/pulse-ui` are peers;
`@miragon/pulse-board` comes along for its types and `@miragon/pulse-screens` for its types and the
filter of a process list. Your Tailwind entry scans the package's build
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

## The engine's process list

```tsx
import {
  ListFilterBar,
  ProcessTable,
  useProcessList,
  type ScreenSlots,
} from "@miragon/pulse-blocks"
import type { EngineScreenData, ProcessFilterData } from "@miragon/pulse-screens"

export function Processes({
  screen,
  filter,
  onFilter,
  slots,
}: {
  screen: EngineScreenData
  filter: ProcessFilterData
  onFilter: (filter: ProcessFilterData) => void
  slots: ScreenSlots
}) {
  const listed = useProcessList(screen.processes, filter)
  return (
    <>
      <ListFilterBar
        filter={filter}
        counts={listed.counts}
        totals={screen.totals}
        onFilter={onFilter}
      />
      <ProcessTable
        engine={screen.engine}
        listed={listed}
        filter={filter}
        totals={screen.totals}
        slots={slots}
      />
    </>
  )
}
```

`ListFilterBar` offers the scopes (every process, or those with an instance with incident) with
their counts, a search over a process's name or BPMN process ID and the engine's totals over every
version; it asks for a filter (`onFilter`) and reads nothing. `useProcessList` derives the rows and
the counts of both scopes in the browser from the screen a surface loaded, through `ProcessFilter`
of `@miragon/pulse-screens`, so a scope or a search costs no call; a surface whose own code filters
(the editors' core, with the same rule) hands its rows and counts to the blocks instead.
`ProcessTable` lists a process per row: its name and BPMN process ID through the surface's `Id`, its
latest version, its running instances and its instances with incident, a neutral figure with the
danger icon and words above 0. A row opens its process and copies its BPMN process ID; the latest
version and the running instances drop where a table that fits its region is narrower than 40rem.
An empty table says that the engine lists no process, whatever the search (the list's count
without a search, the screen's `totals` under one), or that nothing matches the filter.

`ScreenSlots`, what a surface brings to the screens' blocks:

- `Table`: a table over the block's rows (`ScreenTableProps`: its stable `name` on its screen,
  which a surface keys what it remembers by, a label, the columns with each cell and the width
  under which it drops (`hideBelow`), the rows and their keys, `onOpen`, `linkOf` for a row's
  address, `rowLabel`, `copyOf` and the words of its empty state), in the one row convention of
  every surface.
- `Id`: an id a cell shows with the name it goes by (`ScreenIdProps`).
- `onOpen(target, how)`: where a block sends a click, a `ScreenTarget` of `@miragon/pulse-screens`
  (an engine, or a process of an engine).
- `linkOf`, optional: a target's address on a surface that has addresses (the web app); its rows
  link there, so a new tab opens them. The editors bring none.

## The slots of a board's tiles

The tiles own their columns, cells, words, group notes, problems and the card; the surface brings
the parts that follow its own conventions:

- `Table`: a table over the tile's rows (`BoardTableProps`: a label, the columns with each cell,
  the rows and their keys, `onOpen` for a row, `opens` for whether it opens anything, `rowLabel`
  for a row's accessible name, `copyOf` for a row's copy and `copyHint` for what a screen reader
  hears it copies where that is no id, what it says without rows and the notes under them). Every surface opens a row on a click or Enter and copies it with Ctrl or Cmd+C, a
  row that opens nothing a plain row; the cockpit fits the rows its card has room for, the editors
  size their columns.
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
  text, its list row opens nothing. The cockpit opens no view of an engine it shows on boards only
  (Camunda 8); Pulse for VS Code and Pulse for Orca open every target.
- `onOpenFile`, optional: opens the board file; without it a refused tile offers no way to it.
- `opensToSide`, optional: the titles say that Ctrl or Cmd with a click opens beside the view.

## Words

The tiles and the screens' blocks word themselves in English and German, in the language of the nearest pulse-ui
`LocaleProvider` (German for a `de` tag, English for any other): titles from a widget's filter,
process or kind, counts and their engines, thresholds, columns, notes and every problem of a board
file with its values. Numbers and times render through pulse-ui's formatters in the locale set
with `setFormatLocale`, states through pulse-ui's `StateLabel`. The English words of a problem
equal `BoardProblems.describe` of the board package; the English words of the screens' blocks are
those of the engine tab of Pulse for VS Code and Pulse for Orca, letter for letter. The tiles and the
screens' blocks keep a catalog each, so a surface bundles only the words of the blocks it renders. `useProblemWords()` words a problem of the
file for a surface's own strips, `useNoteLines()` a board's note in one line (a note of the file
after its JSON path, the builder's note on a diagram too long to roll up after the tile's title and
engine), and `ProblemList` lists problems with their paths.

The parts carry `data-part` hooks a surface's tests may query: `board-card` (`data-kind`: the
tile's kind), `counter-value`, `counter-partial`, `counter-threshold` (`data-state`: above,
undecided), `counter-entry`, `counter-count`, `group-note`, `incident-flag`, `refused-reason` and
`empty-hint`, and of the screens' blocks `filter-bar`, `segment-count` (`data-tone`: danger on
instances with incident above 0) and `incident-count` (`data-tone`: danger above 0).

## Entries

| Entry                   | Holds                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-blocks` | `BoardGrid`, `BoardTile`, `ProblemList`, `useProblemWords`, `useNoteLines`, `ListFilterBar`, `ProcessTable`, `useProcessList` and the types of the slots and targets of both kinds |

## Stability

Below 1.0 the blocks have no stability promise beyond the release train: a changed slot or target
is a breaking change and says so in its changelog entry. They read the `BoardData` of the
`@miragon/pulse-board` and the screens' JSON forms of the `@miragon/pulse-screens` of the same
release.

## Who uses it

- Pulse for VS Code and Pulse for Orca: the runtime view's webview renders a board's tiles with
  its table (row activation, the copy keys, its hooks), its short id and its diagram canvas, and
  its engine tab's process list with the same table and its named id.
- The Pulse MCP server: the cockpit's board route (`@miragon/pulse-engine-connector`) renders them
  with widget-shell's table (row activation, the copy keys, the inline fit), its copyable id and its
  BPMN canvas.

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
root, `/format` and `/tones` and the main entries of the board format and the screens
(`blocks-are-building-blocks` in the repository's `.dependency-cruiser.cjs`), and only a surface
that renders them imports them (`blocks-consumers`). Each block renders in its tests with the
slots of both kinds of surface, an editor's table and a page's.

```sh
pnpm --fail-if-no-match --filter @miragon/pulse-blocks test
```

## License

[MIT](./LICENSE)
