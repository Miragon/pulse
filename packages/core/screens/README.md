# @miragon/pulse-screens

[![npm](https://img.shields.io/npm/v/@miragon/pulse-screens?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-screens)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The screens of Pulse as data. Pulse shows the same engine in more than one place: the web app of
the [Pulse MCP server](https://miragon.github.io/pulse/mcp/) and the editors,
[Pulse for VS Code](https://marketplace.visualstudio.com/items?itemName=miragon-gmbh.pulse-cockpit)
and [Pulse for Orca](https://miragon.github.io/pulse/orca/). Where two of them show a screen, this
package builds its numbers once, over the engine contract, so each surface shows the same numbers
and words them in its own language. Today it holds the engine screen: every process of an engine
with its latest version, its running instances and its instances with incident.
Below 1.0: pin the exact version and update all `@miragon/pulse-*` packages together.

## What it is not

No runtime dependency, no file system, no engine of its own and no text: the main entry imports
only its own modules and holds the screens' JSON forms and the rules a surface applies to them. The
builder (`@miragon/pulse-screens/builder`) reads through the engine contract of
[`@miragon/pulse-engine-core`](https://www.npmjs.com/package/@miragon/pulse-engine-core) (an
optional peer: install it next to this package to use the builder) and returns data: ids, counts,
the time of its reads and what the engine names itself, never a sentence, a format or a
navigation.

## Install

```sh
npm install @miragon/pulse-screens
# with the builder, the engine contract it reads over:
npm install @miragon/pulse-screens @miragon/pulse-engine-core
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
- `ScreenTarget` names what a screen opens: an engine, or a process of an engine.

## Fixtures

`@miragon/pulse-screens/testing` exports `WORLD_SCREENS`, the screens the builder gives over the
fixed world of the conformance kit (`FakeWorld.seed()` in a `FakeEngine` of
`@miragon/pulse-engine-core/testing`), and `ScreenFigures`: `ScreenFigures.engine(data)` reads an
engine screen as its figures, each row's id, latest version and counts in their order and the
totals, without what an engine makes on its own (its name, the time, its product, the names of its
processes). The numbers tests of every surface compare the screens a dialect's recorded answers
give (`C7_SCREEN_ENGINE` of `@miragon/pulse-c7-core/testing`, `C8_SCREEN_ENGINE` of
`@miragon/pulse-c8-core/testing`) with these figures, so one rule decides what counts as the same
numbers.

## Entries

| Entry                            | Holds                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `@miragon/pulse-screens`         | `ProcessFilter`, `FleetSums` and the types of the screens' JSON forms and of `ScreenTarget` |
| `@miragon/pulse-screens/builder` | `EngineScreen`, `ScreenJson` and the types of `EngineScreenModel` and `EngineScreenReads`   |
| `@miragon/pulse-screens/testing` | `WORLD_SCREENS`, the screens of the conformance kit's fixed world, and `ScreenFigures`      |

## Stability

Below 1.0 the screens have no stability promise beyond the release train: a change of a JSON form
or of a rule is a breaking change and says so in its changelog entry (the version rule above). The
builder takes the `@miragon/pulse-engine-core` of the same release.

## Who uses it

Pulse for VS Code and Pulse for Orca: the runtime view they share builds its engine panel with
`EngineScreen` and `ProcessFilter`, and its webview renders the engine's process list with the
building blocks of [`@miragon/pulse-blocks`](https://www.npmjs.com/package/@miragon/pulse-blocks)
(`ProcessTable`, `ListFilterBar`), which read the main entry: the screen's JSON form and
`ProcessFilter`, which they apply in the browser where a surface holds the whole list. In the
repository, the dependency rules admit one more importer, the data builders of the MCP server's
engine module
([`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector)).

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
