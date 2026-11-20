# @miragon/pulse-screens

[![npm](https://img.shields.io/npm/v/@miragon/pulse-screens?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-screens)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The screens of Pulse as data. Pulse shows the same engine in more than one place: the web app of
the [Pulse MCP server](https://miragon.github.io/pulse/mcp/) and the editors,
[Pulse for VS Code](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit)
and [Pulse for Orca](https://miragon.github.io/pulse/orca/). Where two of them show a screen, this
package builds its numbers once, over the engine contract, so each surface shows the same numbers
and words them in its own language. Today it holds the engine screen, every process of an engine
with its latest version, its running instances and its instances with incident; the process
screen, a process's versions with their counts, the badges of a version's diagram, its call
targets and the notice that older versions still run; the instance list, a version's instances by
scope, page by page, with the count of each scope; and the instance screen, an instance with its
root incidents, where it waits, its path, its call links, its head strip and the markers of its
diagram.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No runtime dependency, no file system, no engine of its own and no text: the main entry imports
only its own modules and holds the screens' JSON forms and the rules a surface applies to them. The
builder (`@miragon/pulse-screens/builder`) reads through the engine contract of
[`@miragon/pulse-engine-core`](https://www.npmjs.com/package/@miragon/pulse-engine-core), rolls
a version's badges and an instance's markers up onto collapsed sub-processes with `DiagramBadges`
and `CollapsedShapes` and tells whether a diagram has a call activity with `CallActivities` of
[`@miragon/pulse-board/builder`](https://www.npmjs.com/package/@miragon/pulse-board) (both
optional peers: install them next to this package to use the builder), and returns data: ids,
codes, counts, the time of its reads and what the engine names itself, never a sentence, a format
or a navigation.

## Install

```sh
npm install @miragon/pulse-screens
# with the builder, the engine contract it reads over and the board builder it rolls markers up with:
npm install @miragon/pulse-screens @miragon/pulse-engine-core @miragon/pulse-board
```

## The engine screen

```ts
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"

const screen = ScreenJson.engine(await EngineScreen.read("prod-a", runtime, () => new Date()))
```

`EngineScreen.read(engine, reads, now)` takes the engine's name as the surface names it, two
reads of `ProcessRuntime` (`EngineScreenReads`: `listDefinitions` and `describeEngine`) and a clock,
which it asks once, before it reads. A surface that holds the reads already (a cache it shares with
a tree, the engine's description kept from an earlier read) hands them to `EngineScreen.of` instead.
Both return an `EngineScreenModel`:

- every process with its latest version and its counts over every version, the most instances with
  incident first, then the busiest, then by name in English collation (a process without a name by
  its id) and, between two of the same name, by id, so every surface lists them alike;
- the totals over every process: how many there are, how many instances run and how many have an
  incident;
- the engine's product and version, or none when the engine does not say what it is.

Honest numbers: the list of processes is the screen, so its failure is the screen's, as thrown; the
engine's description only adds to it, so its failure leaves the product out and never the rows.

`ScreenJson.engine(model)` turns the model into `EngineScreenData`, the one JSON form of the
screen: a surface that hands it on, to a webview or to a page, sends this data and maps nothing by
hand. The time of the reads is ISO text, a missing description is `null`, and of the read models it
keeps each field the form names, so `JSON.parse(JSON.stringify(data))` equals `data`.

## The process screen

```ts
import { ProcessScreen, ScreenJson } from "@miragon/pulse-screens/builder"

const model = await ProcessScreen.read("prod-a", { bpmnProcessId }, runtime, () => new Date())
const screen = model === undefined ? undefined : ScreenJson.process(model)
```

`ProcessScreen.read(engine, { bpmnProcessId, definitionId, version }, reads, now)` asks the clock
once, then reads the process's versions (`listVersions`), selects the one asked for (by its
definition id, else by its number, as an address names it, else the latest; the model's `selected`
says which) and reads that version's diagram (`getDiagramXml`), its element statistics
(`getElementStatistics`) and, unless `CallActivities.found` finds no call activity in a diagram it
could read, the processes it calls (`getCalledProcesses`): a diagram that could not be read, or one
too long to read, reads them. A process the engine holds no version of gives no screen (`undefined`). A
surface that holds the reads already hands them to `ProcessScreen.of` instead. Honest numbers: the
versions are the screen, so their failure is the screen's, as thrown; the diagram, the statistics
and the called processes only add to it, so a read that failed or found nothing leaves its part
out and names it in `unread` (`diagram`, `statistics`, `calledProcesses`), never a 0. The model,
and its JSON form `ProcessScreenData` (`ScreenJson.process`), hold:

- every version as the engine lists them, the latest first, with its running instances and its
  instances with incident, and the version selected;
- a badge per element of the selected version (`badges`): the tokens running there without those
  an incident at the element holds, the root incidents raised there and, apart, the incidents in
  the instances it called, which are never part of the incident count; the root incidents and the
  incidents in called instances rolled up onto every collapsed sub-process around the element, as
  a board and the instance screen roll theirs up, while a sub-process's running count stays the
  one the engine counts there;
- the call targets (`calls`), per call activity the version it starts or the process the engine
  lacks;
- the notice that instances still run on older versions (`olderVersionsRun`, on the latest version
  only): how many run there, how many of them have an incident, and the newest older version that
  runs, which a surface offers to show.

## The instance list

```ts
import { InstanceList, ScreenJson } from "@miragon/pulse-screens/builder"

const list = ScreenJson.instanceList(
  await InstanceList.read("prod-a", { definitionId, filter: { scope: "running" } }, runtime, now),
)
```

`InstanceList.read(engine, { definitionId, filter, after }, reads, now)` asks the clock once and
reads a page of 50 instances of the version (`searchInstances`), after the cursor `after` where it
continues a list, and, on the first page only, the counts of the scopes running, with incident and
ended (`countInstances`, three reads, which a refresh reads anew), so a later page reads no
history. The filter (`InstanceListFilterData`) takes the scope (`running`, `withIncident`,
`ended`, `all`), the element an instance is active at, the exact business key and variable
conditions, each compared as the type it names or its value implies (`VariableConditionTypes`);
`InstanceQuery.of(definitionId, filter)` is the engine's question it asks. A date condition's
value is an instant with its offset (`Z` or `±hh:mm`): the surface reads its user's wall clock
into it where it knows the user's time zone (the editors' core in the host, a web page in the
browser), and the builder refuses a date without an offset with a `RangeError`, since the zone of
whatever process runs it would decide the instant. The rows and the counts
are the list, so a failure of either is the list's, as thrown. The model, and its JSON form
`InstanceListData` (`ScreenJson.instanceList`), hold each row's id, state as a code, whether it has
an incident, its business key and when it started; the cursor of the next page, `null` on the
last; the counts (`null` on a later page), `all` as running and ended together, and each scope
whose count the engine stopped at as a lower bound in `atLeast` (all with running or ended); and
the kinds of variable condition the engine's dialect refuses (`refusedVariableConditions`:
`ordering`, `date` on Camunda 8), which a surface offers disabled with its reason.
`InstanceCounts.read` counts the scopes on their own, an ended count handed in kept, for a refresh
that reads no history. A surface that shows a later page after the rows it shows takes
`InstanceRows.appended(shown, more)` of the main entry, which leaves out a row shown already: an
engine that pages by offset repeats the last row of a page where an instance started between two
reads, and the list shows it once.

## The instance screen

```ts
import { InstanceScreen, ScreenJson } from "@miragon/pulse-screens/builder"

const model = await InstanceScreen.read("prod-a", instanceId, runtime, () => new Date())
const screen = model === undefined ? undefined : ScreenJson.instance(model)
```

`InstanceScreen.read(engine, instanceId, reads, now)` asks the clock once, then reads the
instance's detail (`getInstanceDetail`), and with it the version's diagram (`getDiagramXml`), the
processes it calls (`getCalledProcesses`, only where the diagram has a call activity or could not
be read) and, for an instance another one called, that caller
(`searchInstances` by its id, one at most). An instance the engine does not hold gives no screen
(`undefined`). A surface that holds the reads already hands them to `InstanceScreen.of` instead,
the caller `undefined` where it did not read it and `null` where its read failed or found nothing.
Honest numbers: the detail is the screen, so its failure is the screen's, as thrown; the diagram,
the called processes and the caller only add to it, so a read that failed or found nothing leaves
its part out and names it in `unread` (`diagram`, `calledProcesses`, `caller`), never a guess and
never a 0, and a caller the surface did not read is named nowhere. The model, and its JSON form
`InstanceScreenData` (`ScreenJson.instance`), hold:

- the instance as the engine gives it, and its caller, by its id, with its version, state and
  business key (`found`, `null` where the surface did not read it or its read failed or found
  nothing, which `unread` tells apart), never the call activity it was called from, which no read
  of the contract gives short of the caller's whole detail;
- the head strip as a code (`headline`): `incident` (it waits at an incident of its own: which,
  where and since when), `incidentInCalledInstance` (at the call activity that leads to the
  instance holding it, with where it lies), `incidents` (several, counted), `suspended` or `ended`
  (completed or cancelled), with whether a suspended instance waits at an incident; none for a
  running instance without one;
- an incident card per root incident of its tree, its own and those of the instances it called
  (`IncidentCards`): `rootIncident`, the open root incident the card shows (its id, the instance
  that holds it and that instance's version), and where it lies (`liesIn`, `null` for one of the
  instance itself), kept apart from `rootCauseLine`, the one line of its stack trace or error
  message that engine-core's `RootCauses` names as the root cause (the details' `rootCause`; the
  number of that line, where a viewer opens the text, stays the details' own), read from complete
  details only, with its source (`causeSource`: a stack trace, a worker's error where the incident
  stops a worker task, or an error message) and which text the detail read for it (`text`, `null`
  where it read none: on Camunda 7 every root incident after the first ten, whose stack trace the
  engine still holds, so a surface that shows the text reads it itself wherever the incident has a
  job, not only where `text` is set); a copy Camunda 7 raises at a call activity is never a card,
  since the contract's detail holds root incidents only;
- a row per wait state (`WaitRows`), its kind as a code and what the engine says of it (the
  assignee, the task type, the retries left, the message, signal or element type), and where it
  lies;
- the path (`PathRows`): each run of an element, active, completed or cancelled, and how long an
  ended one took in milliseconds;
- the call links (`CallLinks`), per call activity: the instances it called, those with an incident
  in their tree first, else the version it starts, else the process the engine lacks; `CallLinks.of`
  answers a process's call activities too, without an instance;
- the markers of the diagram (`completed`, `waiting`, `incident`, `incidentInCalledInstance`, an
  incident or a wait in a called instance at the call activity that leads to it), the strongest per
  element where it first appears, rolled up onto every collapsed sub-process around it; the
  sequence flows an instance took are no marker of it: the editors draw them on their own, the one
  surface that does (`docs/vscode/parity.md`), and a further surface that draws them moves them
  into this builder first, read with the board builder's XML tag reader, never into a copy of its
  own;
- its variables, and whether the engine cut what it read (`truncated`).

## Rules for the browser

The main entry holds what a surface does with a screen's JSON form without reading the engine again:

- `ProcessFilter.apply(processes, { scope, search })` keeps the rows of a scope (`all`, or
  `withIncident`: a row with an instance with incident) whose name or id holds the search in any
  case, and counts both scopes over what the search leaves.
- `FleetSums.of(screens)` sums the engine screens of several engines: each engine's totals as its
  screen says them, each process over the engines it runs on with a cell per engine, and the totals
  over all of them. Counts only, never a rate: engines run different processes, so a rate summed
  across them measures their mix. An engine whose read failed is not among the screens it sums, and
  the surface says so in its place.
- `DiagramDecorations.of(screen)` gives each element of a process screen's diagram what a surface
  draws there: its counts above 0 in the order root incidents, incidents in called instances,
  running, each with the scope of the instance list it filters to, whether its outline marks a
  root incident (never for incidents in called instances alone) and its call target.
- `VariableConditionTypes.of(condition)` is the type a variable condition compares as: the type it
  names, else text for a pattern and a number for an ordering, else a number or a boolean where
  its value reads as one, else text.
- `InstanceRows.appended(shown, more)` puts a later page of an instance list after the rows shown,
  without a row shown already, in the engine's order.
- `HistoryGaps.of(version, filter, counts)` finds a history that misses instances the runtime runs
  (history level NONE, a cleanup by removal time at start): the version's running instances, which
  the runtime counts, against the instance list's count over every lifecycle, which the history
  answers, both read in that order (`runtime-contract.md`), where the list counts the version whole
  (no element, business key or variable condition) and the history did not stop counting. The
  web app's process screen shows its hint; nothing falls back to the runtime's instances.
- `ScreenTarget` names what a screen opens: an engine, a process of an engine, one version of a
  process (by its number and its definition id) or an instance, with one of its root incidents in
  focus where a link leads to it (an incident card's "Located in").

## Fixtures

`@miragon/pulse-screens/testing` exports `WORLD_SCREENS`, the screens the builder gives over the
fixed world of the conformance kit (`FakeWorld.seed()` in a `FakeEngine` of
`@miragon/pulse-engine-core/testing`): the engine, the instance DSP-3001 that waits at its call
activity for the incident of the instance it called, and that called instance; the process
pulse-order at its latest version (`process`) and at its version 1 (`olderVersion`), the process
pulse-dispatch (`callingProcess`) and every instance of pulse-order's version 1 (`instanceList`).
`ScreenFigures`
reads a screen as its figures, without what an engine makes on its own (its name, ids, times, its
product, its names and words): `ScreenFigures.engine(data)` each row's id, latest version and
counts in their order and the totals; `ScreenFigures.instance(data)` the instance's state, its
caller's process, the head strip's code, the markers, the call links with the state of each called
instance, where each root incident and each wait lies and the ended runs of the path, each in an
order of its own, since a dialect reads in its own order, enters an element it waits before (an
asynchronous continuation on Camunda 7) only once the wait is over and names a wait's kind in its
own terms; `ScreenFigures.process(data)` the selected version, the versions with their counts in
their order, the badges, the call targets, the notices and what was not read; and
`ScreenFigures.instanceList(data)` the rows by business key, state and incident, whether more
follow and the counts, without the condition kinds a dialect refuses. The numbers tests of every surface compare the screens a dialect's recorded answers
give (`C7_SCREEN_ENGINE` of `@miragon/pulse-c7-core/testing`, `C8_SCREEN_ENGINE` of
`@miragon/pulse-c8-core/testing`) with these figures, so one rule decides what counts as the same
numbers.

## Entries

| Entry                            | Holds                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@miragon/pulse-screens`         | `ProcessFilter`, `FleetSums`, `DiagramDecorations`, `VariableConditionTypes`, `InstanceRows`, `HistoryGaps` and the types of the screens' JSON forms, their codes and `ScreenTarget` |
| `@miragon/pulse-screens/builder` | `EngineScreen`, `ProcessScreen`, `InstanceList`, `InstanceCounts`, `InstanceQuery`, `InstanceScreen`, `CallLinks`, `ScreenJson` and the types of their models and reads              |
| `@miragon/pulse-screens/testing` | `WORLD_SCREENS`, the screens of the conformance kit's fixed world, and `ScreenFigures`                                                                                               |

## Stability

Below 1.0 the screens have no stability promise beyond the release train: a change of a JSON form
or of a rule is a breaking change and says so in its changelog entry (the version rule above). The
builder takes the `@miragon/pulse-engine-core` and `@miragon/pulse-board` of the same release.

## Who uses it

Pulse for VS Code and Pulse for Orca: the runtime view they share builds its engine panel with
`EngineScreen` and `ProcessFilter`, its definition panel with `ProcessScreen` and its instance list
with `InstanceList`, `InstanceCounts` and `InstanceQuery`, and its instance panel with
`InstanceScreen`, whose JSON forms it words in English, and opens a call activity's target with
`CallLinks`; its webview renders the
engine's process list with the building blocks of [`@miragon/pulse-blocks`](https://www.npmjs.com/package/@miragon/pulse-blocks)
(`ProcessTable`, `ListFilterBar`), which read the main entry: the screen's JSON form and
`ProcessFilter`, which they apply in the browser where a surface holds the whole list; and its
instance view with the instance's blocks (`InstanceFacts`, `HeadlineStrip`, `IncidentCard`,
`WaitingTable`, `HistoryTable`, `VariablesTable`, `MarkerLegend`) over the instance screen's
JSON form, which name the targets they open by `ScreenTarget`. The Pulse
MCP server: its engine module
([`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector))
builds the engine screen with `EngineScreen` and `ScreenJson` behind its app-only feed
`engine_screen_processes_data`, the process screen with `ProcessScreen` behind
`engine_screen_process_data`, the instance list with `InstanceList` behind
`engine_screen_instances_data` and the instance screen with `InstanceScreen` behind
`engine_screen_instance_data`, which the server's web app renders with the same blocks, naming
the screen's JSON form by type alone and applying its rules through the blocks
(`useDiagramDecorations`, `useInstanceRows`, `MissingHistoryNotice` over `HistoryGaps`).

## Help and feedback

- **Documentation:** the Pulse servers, editors and modules are explained at
  [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something?
  [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build, test and change Pulse is in
[CONTRIBUTING.md](https://github.com/Miragon/pulse/blob/main/CONTRIBUTING.md). Two rules hold this
package on top of the repository's.

### Mutation testing

The format and the builder are mutation-tested every night in the repository (StrykerJS over
`src/format` and `src/builder` without the tests and the builder's barrel, against the package's
own tests; owner decision 2026-11-19). The builder decides the numbers of the screens two surfaces
share, so a surviving mutant is a wrong number on both. Locally:
`pnpm --fail-if-no-match --filter @miragon/pulse-screens exec stryker run`.

### Style

The house rules of Pulse for VS Code, as in `@miragon/pulse-board`: classes, not module functions,
no comments, complexity 10, 300 lines per file (400 for a test file), 60 per function, no engine
word such as a vendor's name anywhere in it. The repository's ESLint config holds the package to
them.

## Licence

[MIT](LICENSE)
