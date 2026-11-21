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
process table and the filter bar above it, an instance's facts, head strip, incident cards
and their text, its tables of waits, path and variables, the menu of the instances a call
activity called and the legend of its diagram's markers, and a process's version picker, the
notice that older versions still run, the filter bar of its instance list with the variable
condition dialog, the instance table and its next page, the counts and call buttons on its
diagram and their legend.
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

`ListFilterBar` offers the scopes (every process, or those with an instance with incident or an
open incident of their own) with their counts, a search over a process's name or BPMN process ID,
beside it the legend of the list's counts behind a button (each count covers every version; a caller
waiting for an incident in an instance it called is an instance with incident, while the incident
counts at the process it was raised in; an incident outside any instance counts though no instance
holds it) and the engine's totals over every version; it asks for a filter (`onFilter`) and reads
nothing. `useProcessList` derives the rows and
the counts of both scopes in the browser from the screen a surface loaded, through `ProcessFilter`
of `@miragon/pulse-screens`, so a scope or a search costs no call; a surface whose own code filters
(the editors' core, with the same rule) hands its rows and counts to the blocks instead.
`ProcessTable` lists a process per row: its name and BPMN process ID through the surface's `Id`, its
latest version, its running instances (a neutral figure), its instances with incident and its open
root incidents (the column Incidents, the engine contract's `incidents`), both neutral figures with
the danger icon and words above 0, a count the engine stopped at as a lower bound (`≥ 10,000`). A row opens its process and copies its BPMN process ID; the latest
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

## An instance

```tsx
import {
  HistoryTable,
  IncidentCard,
  InstanceFacts,
  type InstanceSlots,
} from "@miragon/pulse-blocks"
import type { InstanceScreenData } from "@miragon/pulse-screens"

export function Instance({
  screen,
  nameOf,
  slots,
}: {
  screen: InstanceScreenData
  nameOf: (elementId: string) => string
  slots: InstanceSlots
}) {
  return (
    <>
      <InstanceFacts
        engine={screen.engine}
        instance={screen.instance}
        caller={screen.caller}
        slots={slots}
      />
      {screen.incidents.map((card) => (
        <IncidentCard
          key={card.rootIncident.id}
          engine={screen.engine}
          card={card}
          elementName={nameOf(card.elementId)}
          slots={slots}
        />
      ))}
      <HistoryTable path={screen.path} nameOf={nameOf} slots={slots} />
    </>
  )
}
```

The blocks of an instance read the instance screen's JSON form of `@miragon/pulse-screens`
(`InstanceScreenData`), or a surface's rows that carry its fields:

- `InstanceFacts`: the facts of the instance's bar, its id to copy where its title is its business
  key, the process and version it runs (a link to that version), the instance that called it (by
  its business key where the read found it, else its short id; `callerLabel` for a surface's own
  words) and when it started or ended, to the millisecond.
- `HeadlineStrip`: the strip that says where the instance stands, from the screen's head strip
  code: it waits at an incident here or in an instance it called, several incidents with the
  first's cause, suspended, ended.
- `IncidentCard`: a root incident of the instance's tree, its type at its element and since when,
  the line its root cause stands on (`rootCauseLine`, by its source: a stack trace, a worker's
  error, the engine's message), the message where the cause does not hold it, the called instance
  it lies in, its job and retries (none left with the danger icon and its words, `CountFigure`),
  the surface's own `facts` and its id; under them the surface's `detail` (its way to the text)
  and `actions` (its writes).
- `IncidentText`: an incident's text in place, read only when it shows open (`onRead`, the
  surface's `read` handed back; opened from the start with `defaultOpen`, it asks at once), the line
  the read names marked as the root cause's (`rootCauseLine`, the contract's index by
  `RootCauses.lineOf`, never a search for the cause's words), copied whole and wrapped on request,
  a cut text and a failed read said so, a refused read (no retry changes it) in the surface's words.
- `WaitingTable`, `HistoryTable`, `VariablesTable`: where the instance waits (its kind and what the
  engine says of it, in a called instance with that instance's link; `ElementLink` a surface's
  way to the element, where a token moves from it), the elements it ran through (state, times,
  duration) and its variables (type, value to open and copy, scope; `editor` a surface's editor).
  Their rows open nothing.
- `CalledInstanceMenu`: the instances a call activity called, each with its state, an incident
  and a link, in a popover at its own button (an anchor of its own per menu), named by the words it
  shows and the call activity. `MarkerLegend`: what each marker of the diagram says, after the surface's `Swatch`
  of it (`takenFlows` where its diagram draws the flows taken).
- `JsonText`: a variable's value as JSON laid out (`pretty`) or on one line (`compact`), every
  digit of a large integer kept.

`InstanceSlots`, what a surface brings to an instance's blocks: `PlainTable`, its table whose rows
open nothing (`ScreenPlainTableProps`); `Link`, its link to a `ScreenTarget` (a version, the
calling or a called instance, an incident card's "Located in" with its root incident in focus),
which it draws in its own look by `rel`; and `onCopy`, which puts a
text on the clipboard its own way. A write control is a slot of the block that shows it (an
incident's `actions`, a wait's `ElementLink`, a variable's `editor`), which only a surface that
writes fills.

## A process

```tsx
import {
  BadgeLegend,
  InstanceFilterBar,
  InstanceTable,
  VersionPicker,
  type CountBadgeProps,
  type ScreenSlots,
} from "@miragon/pulse-blocks"
import type {
  InstanceListData,
  InstanceListFilterData,
  InstanceRowData,
  ProcessScreenData,
  ScopeCountsData,
} from "@miragon/pulse-screens"

export function Process({
  screen,
  list,
  rows,
  counts,
  filter,
  onFilter,
  onPick,
  onMore,
  Badge,
  slots,
}: {
  screen: ProcessScreenData
  /** The page of the instance list read last. */
  list: InstanceListData
  /** The pages read so far, each appended with `InstanceRows.appended(rows, page.rows)`. */
  rows: readonly InstanceRowData[]
  /** The first page's counts: a later page reads none (`counts: null`). */
  counts: ScopeCountsData
  filter: InstanceListFilterData
  onFilter: (filter: InstanceListFilterData) => void
  onPick: (definitionId: string) => void
  onMore: () => void
  Badge: (props: CountBadgeProps) => React.ReactNode
  slots: ScreenSlots
}) {
  return (
    <>
      <VersionPicker versions={screen.versions} selected={screen.selected?.id} onPick={onPick} />
      <InstanceFilterBar
        filter={filter}
        counts={counts}
        busy={false}
        elementName={(elementId) => elementId}
        variables={{ refused: list.refusedVariableConditions }}
        legend={<BadgeLegend version={screen.selected?.version ?? 0} Badge={Badge} />}
        onFilter={onFilter}
      />
      <InstanceTable
        engine={list.engine}
        rows={rows}
        filter={filter}
        onFilter={onFilter}
        more={list.next === null ? undefined : { busy: false, onMore }}
        slots={slots}
      />
    </>
  )
}
```

The blocks of a process read the process screen's and the instance list's JSON forms of
`@miragon/pulse-screens` (`ProcessScreenData`, `InstanceListData`), or a surface's rows that carry
their fields. Only the instance list's first page counts its scopes: a surface keeps those counts
and the rows of every page it read (`InstanceRows.appended`), and never shows a count it has not
read as 0.

- `VersionPicker`: a process's versions, each with its running instances and, where there are,
  its instances with incident; a pick shows at once and asks for the version (`onPick`), under the
  blocks' name or a surface's own (`label`, `placeholder`).
- `OlderVersionsNotice`: the strip over the latest version that says how many instances still
  run on older versions, how many of them with incident, and offers the newest of those versions.
- `MissingHistoryNotice`: the strip over a version's instance list whose history misses instances
  its runtime runs (the screens' `HistoryGaps`: history level NONE, a history cleaned up while
  instances ran), how many of them the history holds and that the list shows only those; nothing
  falls back to the runtime's instances. The web app's process screen renders it.
- `InstanceFilterBar`: the scopes running, with incident, ended and all with their counts (a count
  the engine stopped at as a lower bound), the chip of the element the list is filtered to, a
  search for the exact business key, the variable conditions (a chip per condition and the
  dialog that adds or edits one; `variables` brings a surface's own words for each, the
  engine's variable names and the kinds it refuses; a chip without the surface's words is worded
  as the editors' core words it, `amount > 100`, `route = "review"`, _matches_ in the reader's
  language) and the surface's `legend`. The dialog offers
  every way of comparing and every operator, those an engine refuses (Camunda 8: a date, greater
  or less than) disabled with their reason, and says inline what is wrong instead of applying.
  `InstanceFilters` composes the filters it asks for, `VariableDraft` holds its rules without
  words (the operators per type, what a number and a date look like, at most five conditions,
  the refused kinds), which a surface that validates conditions holds its own rules to.
- `InstanceTable`: an instance per row over the surface's table, its id, business key, state with
  an open incident beside it and start (the business key and the start drop where a table that fits
  its region is narrower than 40rem, so a phone keeps the id and the state); a row opens its
  instance and copies its id. An empty table
  says why, and offers to clear the variable conditions that left no row. `more` is the next page
  while one follows: `LoadMore` under the rows, which waits while the surface reads and keeps the
  focus, the focus moved on to the page's first row once it shows (never where the reader went
  meanwhile), and beside it what the surface says (`beside`, a further page that failed, given the
  way to ask again, which puts the focus back on Load more). `select` is the surface's selection, a
  write slot (the column of its boxes, what Space on a row toggles) only a surface that writes
  fills.
- `BadgeCluster`: the counts on an element of the diagram, apart and in the format's order
  (`DiagramDecorations`): its root incidents, the incidents in the instances it called (never part
  of the incident count) and its running instances, each a button that filters the list to the
  element and the count's scope. `BadgeLegend` says which version the badges count and what each
  says. Both draw a badge through the surface's `Badge` (`CountBadgeProps`), as its canvas draws
  one: the editors' filled 20 px pills, the web app's badges on its BPMN canvas.
- `CallButton`: a call activity's way to what it calls, bpmn-js's drill-down button named by what
  it opens; `useCallLabel` words a call link (the process it opens, the one instance or how many
  it called, a process the engine lacks).

A surface's canvas styles the overlays by their classes: `badge-cluster` and
`badge-cluster__count` place the counts on the shape's corner, bpmn-js's `bjs-drilldown` and
`call-button` (`call-button--missing`) draw the call button.

## What the search finds

Over the find screen's JSON form (`FindScreenData`, one per engine that answered):

- `FindResults`: an instance per row over the surface's table, across engines in the surface's
  order of its engines: its id, business key, process in its version, engine, state with an open
  incident beside it and start (the business key, the process and the start drop where a table
  that fits its region is narrower than 40rem); a row opens its instance on its engine and copies
  its id, named by its business key (else its short id) and its engine. Under the rows the engines
  that hold more instances with the business key than they list (`most`); an empty table says what
  was searched (`text`) and that the search is exact.
- `FindHistoryNotice`: the strip of an engine whose history misses running instances (the find
  screen's `historyGap`), how many of them the history holds and that the search finds only those;
  nothing falls back to the runtime's instances. Without a gap it renders nothing.

The web app's search across engines renders both with its table and id; the editors have no search,
so their bundles leave the blocks and their words out.

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
  text, its list row opens nothing. The cockpit in a chat opens no view of an engine it shows on
  boards only (Camunda 8), on the web app's page it opens the page's screens of one; Pulse for VS
  Code and Pulse for Orca open every target.
- `onOpenFile`, optional: opens the board file; without it a refused tile offers no way to it.
- `opensToSide`, optional: the titles say that Ctrl or Cmd with a click opens beside the view.

## Words

The tiles and the screens' blocks word themselves in English and German, in the language of the nearest pulse-ui
`LocaleProvider` (German for a `de` tag, English for any other): titles from a widget's filter,
process or kind, counts and their engines, thresholds, columns, notes and every problem of a board
file with its values. Numbers and times render through pulse-ui's formatters in the locale set
with `setFormatLocale`, states through pulse-ui's `StateLabel`. The English words of a problem
equal `BoardProblems.describe` of the board package; the English words of the screens' blocks are
those of the engine tab, the instance view and the definition view of Pulse for VS Code and Pulse
for Orca, letter for letter (but for two words of the definition view: the notice of older
versions counts those with incident, and the variable filter counts its conditions). The tiles, an engine's process list, an instance's and a process's blocks, the history notice and the search keep a catalog each, so a
surface bundles only the words of the blocks it renders. `useProblemWords()` words a problem of the
file for a surface's own strips, `useNoteLines()` a board's note in one line (a note of the file
after its JSON path, the builder's note on a diagram too long to roll up after the tile's title and
engine), and `ProblemList` lists problems with their paths.

The parts carry `data-part` hooks a surface's tests may query: `board-card` (`data-kind`: the
tile's kind), `counter-value`, `counter-partial`, `counter-threshold` (`data-state`: above,
undecided), `counter-entry`, `counter-count`, `group-note`, `incident-flag`, `refused-reason` and
`empty-hint`, and of the screens' blocks `filter-bar`, `segment-count` (`data-tone`: danger on
instances with incident above 0), `incident-count` and `root-incident-count` (a process's instances
with incident and its open root incidents, `data-tone`: danger above 0), `counts-legend`,
`incident-card`,
`variable-name`, `incident-text-region`, `incident-text`, `root-cause-line`,
`called-instance-menu`, `filter-chip` (`data-kind`: element), `incident-flag`, `badge-count`
(`data-scope`: the scope it filters to; its cluster `data-badge-for` the element) and
`call-button` (`data-call-for` the element, `data-state`: missing).

## Entries

| Entry                   | Holds                                                                                                                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@miragon/pulse-blocks` | `BoardGrid`, `BoardTile`, `ProblemList`, `useProblemWords`, `useNoteLines`, `ListFilterBar`, `ProcessTable`, `useProcessList`, `ScopeSegments`, an instance's and a process's blocks, `FindResults`, `FindHistoryNotice`, `JsonText` and the slots' types |

## Stability

Below 1.0 the blocks have no stability promise beyond the release train: a changed slot or target
is a breaking change and says so in its changelog entry. They read the `BoardData` of the
`@miragon/pulse-board` and the screens' JSON forms of the `@miragon/pulse-screens` of the same
release.

## Who uses it

- Pulse for VS Code and Pulse for Orca: the runtime view's webview renders a board's tiles with
  its table (row activation, the copy keys, its hooks), its short id and its diagram canvas, its
  engine tab's process list with the same table and its named id, and its instance view's blocks
  with that table, its links and its copy, its retry, variable editor, move and stacktrace
  document in their slots, and its definition view's blocks with that table, its id, its count
  badge and its canvas, its selection and bulk actions in the instance table's write slot.
- The Pulse MCP server: the cockpit's board route (`@miragon/pulse-engine-connector`) renders them
  with widget-shell's table (row activation, the copy keys, the inline fit), its copyable id and its
  BPMN canvas, and the server's web app its engine screen's process list with widget-shell's table,
  its rows links to the process they open (`linkOf`), and its named id, its instance screen's
  blocks with its plain table, links and copy, and its process screen's blocks with that table,
  its badge on its BPMN canvas and Load more under its rows, every write slot empty.

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
that renders them imports them (`blocks-consumers`); `src/no-host-context.test.ts` holds their
sources to that and to no host context (no host query, confirmation, hand-off, bridge or React
context of their own). Each block renders in its tests with the slots of both kinds of surface, an
editor's table and a page's.

```sh
pnpm --fail-if-no-match --filter @miragon/pulse-blocks test
```

## License

[MIT](./LICENSE)
