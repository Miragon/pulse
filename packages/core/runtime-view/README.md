# Runtime view

The engine-neutral runtime view of Pulse's editor hosts, Pulse for VS Code (`apps/vscode`) and
Pulse for Orca (`apps/orca`): what an engine runs, next to the BPMN models. Private: only the
editor hosts and a family's adapter import it, and esbuild bundles it into each host. Its engine
contract is the engine family's core, [`@miragon/pulse-engine-core`](../../connectors/engine/engine-core/README.md):
the ports, read models and failure kinds every dialect answers in, the conformance kit and the
fake (`./testing`), which its layers and the hosts import directly (owner decision 2026-11-09 on
#585: one home of the contract, no second copy here).

| Layer    | Path                | Entry                                               | Holds                                                                                                                                                                                                                                                             |
| -------- | ------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ports    | `src/ports`         | `@miragon/pulse-runtime-view/ports`                 | the ports only the editor hosts need: `EngineAdapter` with the `BpmnDialect` an adapter brings, the local model and its code                                                                                                                                      |
| core     | `src/core`          | `@miragon/pulse-runtime-view/core`                  | panels, boards (the board format and builder of `@miragon/pulse-board`, serialized by `BoardViews` with `BoardJson.of`), the migration plan preview (`MigrationPlanPanel` over a plan file read with `@miragon/pulse-migration-plan`), refresh loops, view models |
| protocol | `src/core/protocol` | `@miragon/pulse-runtime-view/protocol`              | the JSON messages and view models between a host and the webview, a board's tiles in the board's JSON form                                                                                                                                                        |
| model    | `src/model`         | `@miragon/pulse-runtime-view/model`                 | the local `.bpmn` reader and the code locator, behind the local ports                                                                                                                                                                                             |
| webview  | `src/webview`       | `@miragon/pulse-runtime-view/webview-build-options` | the webview, React on pulse-ui, each host bundles into its frames                                                                                                                                                                                                 |
| host kit | `src/host-kit`      | `@miragon/pulse-runtime-view/host-kit`              | the rules every editor host shares: `EngineRoot` (the adapters per dialect, the local target, the dialects), targets from `.pulse.json` and the CLI's user config, write and live policies, the audit                                                             |

Each layer has its own `tsconfig.<layer>.json` with its runtime's globals only, and its own
closed-world dependency rules (`.dependency-cruiser.cjs`, `pnpm lint:architecture:runtime-view`):
the ports, the core, the model reader and the host kit import engine-core's main entry, the core
and the webview Pulse's UI foundation (`@miragon/pulse-ui/tones`, `@miragon/pulse-ui/format`), the
webview also pulse-ui's React kit and its `theme.css` and Pulse's building blocks
(`@miragon/pulse-blocks`, its main entry: a board's tiles, the engine's process list, an instance's and a process's blocks), the host kit's
connections the profile format (`@miragon/pulse-profile`), the core the board format
(`@miragon/pulse-board`, its main entry; the protocol keeps a copy of the tiles of a board's JSON
form, `BoardData`, which `test/core/board-format.test.ts` holds equal to the format's) and its
builder (`@miragon/pulse-board/builder`: a board's numbers, which `BoardViews` serializes with
`BoardJson.of` and hands the webview with what only the editors add, the targets the core checks
a click against and the diagram's XML, a problem staying a code, and the roll-up onto collapsed
sub-processes the definition and instance views draw too), the core also the screens
(`@miragon/pulse-screens` and its `./builder`: the engine screen's numbers and the process list's
filter, a process's versions, badges, call targets and the older versions' notice and an
instance list's page, counts and query, and an instance's incident cards, wait rows, path, call
links, head strip and markers, whose JSON forms the core words in English into the definition and
instance views, their protocol unchanged; the protocol keeps a copy of the engine screen's JSON
form of a process row, its filter, its scope counts and its totals, which
`test/core/engine-screen-format.test.ts` holds equal to the format's, and of a badge, an instance
list's filter, its counts and a variable condition's type rule, which
`test/core/process-screen-format.test.ts` holds equal), the core's `src/core/plans` alone the
migration plan format (`@miragon/pulse-migration-plan`, its main entry: the parser, the words of
its problems and the rule that resolves a version number; the repository's
`migration-plan-consumers`), which `plans-start-nothing` keeps from importing a write or a panel
that brings one in, and whose behaviour the test 'starts nothing' in
`test/core/migration-plan-panel.test.ts` holds, and no layer a
dialect's core. The webview renders a board's tiles, the engine's
process list and the instance view's facts, head strip, incident cards, tables of waits, path and
variables and marker legend with the building blocks under an English `LocaleProvider`, which
word them, and brings their slots: its table, its short id or named id, its diagram canvas, its
links and copy (`src/webview/screens/instance-slots.tsx`), and the instance's writes (the retry,
the variable editor, a move from a wait) and its stacktrace document in the slots of the block
that shows them; the protocol's instance rows carry what the blocks word beside the core's
words, which `test/core/instance-screen-format.test.ts` holds to the instance screen's form.
That edge of `packages/core` into the engine family is the one the owner accepted
(`runtime-view-builds-on-the-engine-contract` in the repository's `.dependency-cruiser.cjs`).
The hosts read the types from the build (`dist`, declarations only) and bundle the sources.

Every build of the webview takes its esbuild options from
`packages/core/runtime-view/scripts/webview-build-options.mjs`: the hosts' (Pulse for Orca's
readable one turns off minifying and source maps), the dev harness and the tests of the bundle
budget and the licence lists. A build that ships (`production: true`) defines
`process.env.NODE_ENV` as production, so React's development build never ships, and so does the
dev page's `--build`, which the product shots load. A build without `production` keeps React's
development build for its warnings: VS Code's builds without `--production` (its watch, smoke
and e2e builds) and the dev page while it serves. The Tailwind step, `TailwindEntries`
(`packages/core/runtime-view/scripts/tailwind-entries.mjs`), compiles the stylesheets the options
name as Tailwind entries and nothing else, today the webview's one,
`packages/core/runtime-view/src/webview/styles/webview.css` (preflight on, `@source` the webview
and the dist of pulse-ui and of the building blocks, pulse-ui's `theme.css`, the diagram's vendor CSS and `diagram.css` unlayered):
Tailwind's `compile`, the `@source` globs of the entry scanned (without `source(…)` the entry's
folder), `optimize` in a build that ships, esbuild watching what it read and scanned. It records
what each entry read, its `@import`s, which the build's metafile never names, so the licence lists
read the works the CSS inlines (`inlinedStylesheets` of the repository's
`scripts/third-party-licenses.mjs`); `test/scripts/tailwind-entries.test.ts` builds a fixture
entry through it.

The webview tests (`test/webview`, Chromium) mount, update and unmount through one harness,
`packages/core/runtime-view/test/webview/harness.tsx`, which alone holds the renderer, and enter
values through the native value setter with bubbling `input` and `change` events. It renders
with React's `createRoot` under pulse-ui's `LocaleProvider` and `<html data-density="compact">`,
as `main.tsx` does, and runs a mount, an update or an unmount inside `act()`. Their accessibility baseline runs axe-core over every fixture of
the dev page in light, dark and both high-contrast themes and over the opened tabs, the variable
editor, the condition dialog and the move panel, with no WCAG 2.2 A or AA violation and no
violation of axe's landmark rules (one main around each screen, as the app root renders it; run with the
harness root out of fixed position, which axe would take for a modal that passes them), at the
harness root's 1,200 pixels in a viewport as wide, so axe sees the whole screen; the target size
of the diagram's overlays, which scale with its zoom down to 0.7 of the named 20 px deviation, is
the geometry gate's exception there too (`test/webview/accessibility.test.tsx`); `test/webview/semantics.test.tsx` holds the roles and
states each screen keeps, `test/webview/focus-on-update.test.tsx` focus across a live update.
`test/webview/canvas-labels.test.tsx` measures a label in bpmn-js's Arial, so it needs a font with
Arial's metrics (Arial, Liberation Sans or Arimo; Playwright's `install-deps` brings
fonts-liberation, as in CI) and skips that case with its reason on a machine without one. On CI
it fails instead (the browser project hands the tests `CI` as `runsOnCi`), so a runner that lost
the font goes red rather than skipping the case unseen.

They reach the webview by role and accessible name, which a query asserts, and where no role
fits by a `data-part` hook, never by a CSS class of the webview. Where the webview renders the
element, it carries the hook; where a pulse-ui piece plays the part, the harness's `part()` finds it
by the kit's `data-slot` too (the map below; pulse-ui carries no hook of the webview's), and the
VS Code e2e test and screenshot scripts (`apps/vscode/scripts`) resolve a part through the same map
(`apps/vscode/scripts/support/webview-parts.mjs`). `test/architecture/webview-test-hooks.test.ts`
refuses a test under `test/webview` or a script under `apps/vscode/scripts` that names a class of
the webview in a selector or as a class it expects (diagram-js's and bpmn-js's own classes and the
diagram's `pulse-*` markers, which bpmn-js sets, stay), and holds the scripts' map equal to the
harness's. The hooks:

| Hook              | Parts                                                                                                                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bar and states    | `context-bar` (`data-kind`: engine, definition, instance, migration, board, pending), `context-subject`, `context-key`, `access`, `freshness`, `strips`                                                                       |
| notices           | `status-strip`, `strip-title`, `status-box`, `bulk-strip`, `empty-hint`, `loading-layout`, `skeleton`                                                                                                                         |
| lists             | `data-table` (`data-state`: auto, fixed), `column-label`, `table-empty`, `table-footer`, `filter-bar`, `filter-chip`, `filter-summary`, `segment-count`, `selection-count`, `tab-bar`                                         |
| states and counts | `state-label`, `incident-flag`, `count-badge`, `incident-count`, `root-incident-count`                                                                                                                                        |
| instance          | `incident-card`, `variable-name`, `shadow-warning`, `editor-hint`, `editor-warning`, `caller-link`, `called-instance-link`                                                                                                    |
| diagram           | `diagram`, `diagram-canvas`, `diagram-failure`, `badge-count`, `call-button`, `element-actions`, `move-entry`, `move-badge`, `code-button`, `move-panel`, `move-warning`                                                      |
| migration         | `migration-diagram`, `migration-summary`, `migration-refusal`, `mapping-note`, `plan-verdict`, `plan-facts`                                                                                                                   |
| boards            | `board-card` (`data-kind`: the tile's kind, `refused` for a widget the file breaks), `refused-reason`, `board-notes`, `counter-value`, `counter-partial`, `counter-threshold`, `counter-entry`, `counter-count`, `group-note` |

The board's parts are the building blocks' own (`@miragon/pulse-blocks` carries the boards row's
hooks but `board-notes`, and `incident-flag` and `empty-hint` in its tiles), and so are the engine
tab's `filter-bar`, `segment-count`, `incident-count` and `root-incident-count` (its process table and
filter bar), and the
instance view's `incident-card` and `variable-name` (its incident cards and variables table), and
the definition view's `filter-bar`, `segment-count`, `filter-chip`, `incident-flag`, `badge-count`
and `call-button` (its filter bar, instance table, badge clusters and call buttons). The kit's slots a part
resolves to as well: `context-bar` `view-bar`, `context-subject`
`view-bar-subject`, `access` `view-bar-access`, `freshness` `view-bar-freshness`, `status-strip`
`status-strip`, `strip-title` the strip's first text, `state-label` `state-label`,
`segment-count` the last text of a `segmented-option`, `tab-bar` `tabs-list`, `filter-chip`
`condition-chip`, `filter-summary` `toolbar-summary`, `skeleton` `skeleton` and
`data-table-skeleton`, `data-table` `data-table`. A part a test narrows by `data-kind` or
`data-state` keeps a wrapper of the webview's with the hook and the attribute.

A variant is `data-kind`, a tone `data-tone` (danger, warning, info, neutral, success) and a state
`data-state` (stale, offline, refreshing, above, undecided, refused, missing, writable …), each
on the element with the part. The geometry gate (`test/webview/geometry.test.tsx`) renders every
fixture of the dev page, the open legend, the variable editor, the condition dialog and the move
panel at 1,300 pixels, at 650 pixels and in the dark high-contrast theme: every Lucide icon measures 12 or 16 px, 12 px only inside the parts
`test/webview/dense-icon-regions.ts` maps to the files of the 12 px allowance in
`apps/vscode/test/architecture/brand-gates.test.ts` (which holds the two lists equal and each file
to its hook), and every interactive target at least 24 by 24 px (WCAG 2.5.8), the overlays on the
diagram (`.djs-overlays`, the named 20 px deviation) aside. The split's handle is such a target
over its 1 px line, and every target it reaches over keeps 24 px of its height outside it.

The architecture decisions are the extension's (`apps/vscode/docs/adr/`), where the runtime view
grew up; the house rules are in `apps/vscode/CLAUDE.md`.

The coverage floors (`vitest.config.ts`, ratchets that only rise) hold all of `src` but its
declaration files, as a whole and per layer: the core, the model reader, the webview and the host
kit. Outside `src`, `dev/` and `scripts/` are not measured. On 2026-11-26, when a floor came to
trail its measurement by at most 3 points (`scripts/coverage-floors.mjs`), each floor rose to the
value then measured, rounded down less a point, where that lay above it: the global branches
floor and floors of every layer; the global lines, statements and functions are still the values
measured on 2026-11-12, rounded down. A new branch of `src` brings its test. The host kit's floor is what
this package's tests reach, about seven eighths of it,
since a host's coverage counts no file of the runtime view: the hosts' tests run the confirmation
policy, the rest of the write policy, the write audit, the audited commands, the timer scheduler,
`NotificationText.printable` and part of the panel titles. Two of its safety rules have their tests
here: the credential store's refusal of a login saved for another origin (`savedForAnotherEndpoint`,
`test/host-kit/credential-store.test.ts`) and `NotificationText.withoutLinks`, which defuses links
in engine text (`test/host-kit/notification-text.test.ts`); so does the connection builder, which
names a refused target's way out as its read-only note, that of an engine whose adapter brings no
commands too, and else says that Pulse only reads such an engine
(`test/host-kit/connection-builder.test.ts`). The client
credentials of a Camunda 8 profile have theirs too: a client secret bound to the origins of the
cluster and the token endpoint, never sent over plain HTTP beyond this machine, and the login a
target asks for, or why it asks for none (`test/host-kit/client-credentials.test.ts`). This
machine is the literal loopback hosts for writes and the LOCAL badge, while the clear-text check
reads the profile format's loopback, all of 127.0.0.0/8 (`test/host-kit/this-machine.test.ts`).
The routing tests both hosts had live here too: `EngineRoot`, the one body both composition roots
build from their adapters, hands a target to its dialect's adapter with its credentials, refuses,
and names the web UI, the CLI and the local target (`test/host-kit/engine-root.test.ts`).
A new rule of the host kit brings its test under `test/host-kit/`.

```sh
pnpm --filter @miragon/pulse-runtime-view test       # unit and webview (Chromium) tests, coverage floors
pnpm --filter @miragon/pulse-runtime-view run typecheck
pnpm lint:architecture:runtime-view
```
