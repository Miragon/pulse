# CLAUDE.md (apps/vscode)

Guidance for agents working on Pulse for VS Code: the extension `pulse` (Marketplace
id `miragon-gmbh.pulse-cockpit`), an engine-neutral runtime view for process engines inside
VS Code, and on the runtime view and the C7 adapter it shares with Pulse for Orca. It is an interface app of the Pulse monorepo. The repository's package rules hold
here (the root `CLAUDE.md`: layout and naming, the dependency edges of invariant 8, the
ratchets, Verification); the MCP invariants are written for the MCP server, its modules and
its widgets, and this file replaces them for the extension.

## Commands

Run them from the repository root.

```sh
pnpm --filter pulse-cockpit run typecheck        # tsc over the app, then the host and the tooling with their globals
pnpm --filter pulse-cockpit run lint             # ESLint with the house rules below
pnpm lint:architecture:vscode                   # the closed-world dependency rules of the host
pnpm lint:architecture:runtime-view             # the closed-world rules of the runtime view's layers
pnpm lint:architecture:c7-adapter               # the closed-world rules of the C7 adapter
pnpm lint:deadcode                              # knip over every workspace: dead files, dependencies, enum members
pnpm lint:deadcode:exports                      # knip over every workspace but docs: unused exports and types
pnpm --filter pulse-cockpit test                 # the host's unit and architecture tests, coverage floors, the brand and word scans
pnpm --filter @miragon/pulse-runtime-view test   # core, model, host kit and webview (Chromium) tests, coverage floors per layer
pnpm --filter @miragon/pulse-c7-adapter test     # the C7 adapter against a recorded REST API and its error-path goldens
pnpm --filter @miragon/pulse-engine-core test   # the kit's self-tests: the fake passes every law, 71 saboteurs fail theirs
pnpm --filter @miragon/pulse-c7-adapter run test:engines # adapter conformance on a real engine; needs podman/docker
pnpm --filter pulse-cockpit run test:smoke       # the extension activates in a real VS Code
pnpm --filter pulse-cockpit run test:e2e         # VS Code e2e; needs `engine:up`
pnpm --filter pulse-cockpit run test:smoke:docker # both in Docker under Xvfb: no VS Code window
pnpm --filter pulse-cockpit run test:e2e:docker   # on your desktop (e2e: needs `engine:up`)
pnpm --filter pulse-cockpit run sandbox:up       # shop sandbox for manual testing: two seeded engines
pnpm --filter pulse-cockpit run sandbox:open     # build, start the sandbox if needed, open it in VS Code
pnpm --filter pulse-cockpit run docs:screenshots # one screenshot per use case (after sandbox:up)
pnpm --filter pulse-cockpit run package          # the .vsix
```

The extension bundles the runtime view and the C7 adapter from their sources and reads their
types from their builds, and both bundle engine-core (the contract), the adapter c7-core too,
from their builds: after `pnpm install`, build them once
(`pnpm exec turbo run build --filter='pulse-cockpit^...'`, or `pnpm build`) before these
commands, and again after a change to one of them.

While you iterate, `pnpm test:one <path>.test.ts` runs the files you touch (coverage off, the
dependencies built first; run alone, a file fails the floors, since `coverage.include` counts
every file it does not load), then `pnpm exec turbo run typecheck test lint --filter=pulse-cockpit...`
the extension and what it bundles. The bar for every change is the repository's: `pnpm check` at
the root. The webview tests run in Chromium: install it once with
`pnpm --filter @miragon/pulse-runtime-view exec playwright install chromium`. Run `test:engines`,
`test:e2e` and `docs:screenshots` only when the change touches the adapter or the contract, the
VS Code flows or the screens.

The README demo GIF `apps/vscode/docs/demo.gif` (copied to `docs/assets/vscode/demo.gif`) is the
journey `.miragon/shots/vscode-demo.mjs` (shop-dev, Order fulfillment, ORD-10130, `cardExpiry`
fixed, the incident retried) over the driver of `docs:screenshots`, recorded by `render.mjs` of
the `product-shots` skill of the `miragon-brand` plugin
([Miragon/corporate-identity](https://github.com/Miragon/corporate-identity)) from the repository
root, with `sandbox:up` and `sandbox:traffic` running (`PLAYWRIGHT_CORE` as in the root
`CONTRIBUTING.md`):

```sh
node "<product-shots skill>/scripts/render.mjs" --journey .miragon/shots/vscode-demo.mjs \
  --chrome overlay --theme dark --width 1320 --out apps/vscode/docs/demo.gif
```

The driver (`apps/vscode/scripts/screenshots/vscode-driver.mjs`) pins the colour theme to Default
Dark Modern, so the shots keep their look when VS Code changes its default theme, and on Linux it
starts VS Code with `--password-store=basic`: without a keyring, Set Credentials (use cases 19, 41
and 44 of `docs:screenshots`) would stop at VS Code's keyring dialog.

`engine:up` seeds the fixed conformance world that the e2e test asserts on; do not change it
for manual testing. Manual and exploratory scenarios belong in
`apps/vscode/scripts/sandbox/scenarios.mjs`; keep the business keys in
`apps/vscode/sandbox/README.md` in step with it.

With podman: `DOCKER_HOST=unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')`
and `TESTCONTAINERS_RYUK_DISABLED=true` for `test:engines`.

## Where code goes

Pulse for VS Code is the VS Code host of the runtime view that Pulse for Orca (`apps/orca`) hosts
too. The engine-neutral part lives in two packages the editor hosts share: the runtime view
(`packages/core/runtime-view`, layers under its `src`, each with its own
`tsconfig.<layer>.json` and dependency rules) over the engine contract of
`@miragon/pulse-engine-core`, and the C7 adapter of that contract
(`packages/connectors/c7/c7-adapter`, the c7 dialect family's). This app holds only the VS Code
wiring.

| You want to…                                                    | Put it in                                                                                                                                                                                                                                                                                                           | Never                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Add an engine question                                          | `packages/connectors/engine/engine-core` (port + read model + a conformance law + a saboteur), which the runtime view and the adapter import                                                                                                                                                                        | engine words in the contract               |
| Add a write                                                     | `ProcessCommands` + a command law + a saboteur; policy and confirmation per `apps/vscode/docs/adr/writes.md`                                                                                                                                                                                                        | authority in a webview intent              |
| Interpret runtime data (grouping, view models, panel behaviour) | `packages/core/runtime-view/src/core`                                                                                                                                                                                                                                                                               | `vscode`, DOM, Node, engine words          |
| Change what the webview shows                                   | `packages/core/runtime-view/src/core/protocol` (types) and `packages/core/runtime-view/src/webview`                                                                                                                                                                                                                 | logic in the webview, `--vscode-*` colours |
| Talk to Operaton / CIB seven / Camunda 7                        | `packages/connectors/c7/c7-adapter/src` (mapping) and `packages/connectors/c7/c7-adapter/src/engine-rest` (REST client; its `inspect` runs c7-core over it); inspect, wait states, an incident's retry target and cause request, variable typing in `@miragon/pulse-c7-core`, the root cause in `RootCauses`        | imports from core, webview or host; a copy |
| Add an engine family                                            | `packages/connectors/<family>/<family>-adapter` with a class implementing `EngineAdapter` + an `*.engine.test.ts` running the `ConformanceKit` (`@miragon/pulse-engine-core/testing`) + one entry in each composition root (`apps/vscode/src/host/composition-root.ts`, `apps/orca/src/worker/composition-root.ts`) | branching on engines anywhere else         |
| Read the local `.bpmn` model or find the implementing code      | `packages/core/runtime-view/src/model` (behind `ModelSource` / `CodeLocator`), per `apps/vscode/docs/adr/local-sources.md`                                                                                                                                                                                          | moddle or bpmn-modeler libs anywhere else  |
| Add a port only the editor hosts need                           | `packages/core/runtime-view/src/ports` (`EngineAdapter`, `EngineWebUi`, `EngineCli`, `ModelSource`, `CodeLocator`, `WorkspaceFiles`)                                                                                                                                                                                | an IDE port in engine-core                 |
| Share a host rule (targets, policies, the write audit, titles)  | `packages/core/runtime-view/src/host-kit`                                                                                                                                                                                                                                                                           | `vscode`, an editor's API                  |
| Wire VS Code                                                    | `apps/vscode/src/host`                                                                                                                                                                                                                                                                                              | business rules                             |

The dependency rules are closed-world, one config per package (`apps/vscode/.dependency-cruiser.cjs`,
`packages/core/runtime-view/.dependency-cruiser.cjs`,
`packages/connectors/c7/c7-adapter/.dependency-cruiser.cjs`): an import that is not
explicitly allowed fails its `pnpm lint:architecture:<package>` with a message that says where it
belongs (dependency-cruiser reports it as `not-in-allowed` and takes the wording from the forbidden
rule of that name, which never fires itself). Nothing outside them is allowed, so no widget-shell,
no React outside the webview, no zod;
the repository's licence list (`scripts/third-party-licenses.mjs`), which the licence test
reads, may use Node built-ins and nothing else. The engine contract has one home, the
engine family's core `@miragon/pulse-engine-core` (`packages/connectors/engine/engine-core`, owner
decision 2026-11-09 on #585): the ports, read models and errors every dialect answers in. The
runtime view's ports, core, model reader and host kit and the host import its main entry, its tests,
dev harnesses and the dev host its `./testing` entry (the kit, the world, `FakeEngine`), and
nothing imports a file of the package by path (`engine-core-only-by-its-entries`). The ports
only the editor hosts need (`EngineAdapter` with `EngineConnection`, `EngineCredentials`,
`EngineWebUi` and `EngineCli`, `ModelSource`, `CodeLocator`, `WorkspaceFiles`) live in the
runtime view's `src/ports` (`@miragon/pulse-runtime-view/ports`), never in engine-core. The
package keeps these house rules (the repository's ESLint config names its paths next to the
editor trees'), and it follows the views: a question the views need lands there first, below 1.0
without a stability promise. The host reaches the runtime view only through the entries of its
ports, core, protocol and host kit, and only its composition root the adapter and the model
reader. The C7 adapter (`packages/connectors/c7/c7-adapter`, its tests beside it) imports
`@miragon/pulse-c7-core`, the core of the Camunda 7 REST dialect family c7, the workflow domain
the CLI and the MCP server run too, through its main entry; no other part of the editor hosts
imports it (`runtime-view-is-dialect-neutral`, `extension-is-dialect-neutral`; the repository's
`adapters-own-their-family`). The adapter's wire (`packages/connectors/c7/c7-adapter/src/engine-rest/http`,
`EngineHttp`) sends through `@miragon/pulse-http`, the transport the CLI and the MCP server send
through, by its main entry and nowhere else in the adapter (`http-only-in-the-wire`,
`http-by-its-main-entry`); the runtime view and the hosts never import it (the repository's
`http-consumers`); the adapter sends over the global `fetch` of the host's runtime. The host
kit's connections (`packages/core/runtime-view/src/host-kit/connections`) read the project files with Pulse's
profile format, `@miragon/pulse-profile`, through its main entry (the runtime view's closed
world; the repository's `profile-consumers`), as the CLI does. The runtime view's core and
webview import Pulse's UI foundation as `@miragon/pulse-ui/tones` and `@miragon/pulse-ui/format`:
the tone vocabulary and `SITUATION_TONES`, the one tone per situation the MCP widgets show
too, and the formatters, framework-free (the repository's
`ui-foundation-entries-import-nothing`). The core, the ports, the model reader and the host kit
import nothing else of pulse-ui (`pulse-ui-only-its-foundation`); the webview takes pulse-ui's
React kit and its stylesheet only for shared building blocks, by the package's root and
`@miragon/pulse-ui/theme.css` (`webview-pulse-ui-by-its-entries`, below). The webview draws a
tone through the kit's pieces (`StateLabel`, `CountFigure`, `StatusStrip`) and its diagram badges,
and `packages/core/runtime-view/test/webview/situation-tones.test.tsx` holds its state labels and
diagram badges to the table. A time, a duration, a count or a short id goes through
`TimeLabels`, `CountLabels` (webview) or `Labels` (core), which delegate to the formatters in
English with a 24-hour clock and alone may import them (the closed world allows
`@miragon/pulse-ui/format` only from `core/views/labels.ts` and the webview's `format/`); a count
in a text goes in through them too (`Labels.count`, `CountLabels.exact`), and the repository's
date and number gates keep `Intl`, `toFixed` and a locale-less `toLocaleString()` out of core
and webview. A change to how an instance is inspected, where it waits, which incident types the
engine raises itself (`BUILT_IN_INCIDENT_TYPES`), what an incident's retry retries
(`incidentRecovery`), which request holds its cause (`CAUSE_OPERATIONS`), how a written variable
is typed (`autoTypedValue`, `toEngineVariable`) or when a 404 names a missing resource
(`isMissing`) goes into c7-core, one to what its root cause is into
engine-core's `RootCauses` (`RootCauses.of`, `RootCauses.lineOf`, which c7-core applies too),
never into a copy; the adapter's `InspectView` is c7-core's instance view, not a mirror of it.
Ports, core, webview, host kit and host stay engine-neutral.

The surfaces share a core up to building blocks, not everything, by the product owner's decision
of 2026-11-12 (`apps/vscode/docs/adr/ui-foundation.md`). Later that day the owner decided D9 in
the same record: the webview moved from Preact to React 19 on `@miragon/pulse-ui` in one switch,
a commit of the pull request that recorded D9, with no `preact/compat` bridge, and every surface
takes one compact look from pulse-ui (the design section of the root `CLAUDE.md`). The webview
composes pulse-ui's kit, its primitives and the building blocks D9 lifted into its root from the
webview (`ViewBar`, `StatusStrip`, `Facts`, `StateLabel`, `CountBadge`, `CountFigure`, the
`SegmentedControl` with counts, `SearchField`, `ConditionChip`, the id with its copy button,
`DataTable` with its column sizing and row selection, the form primitives), and stays a renderer
of the view models the core pushes, without widget-shell. It keeps its host wiring (the push
protocol and live updates, the native confirmation, sign-in), its diagram runtime and overlays
(portals that carry only the classes of `packages/core/runtime-view/src/webview/styles/diagram.css`),
the condition dialog as a native `<dialog>` on the kit's roles, and the split pane with the widths
it stores, which stay the editor's; where it shows the same thing as the MCP widgets or the web
apps of #573, a shared building block is the default, and no screen of it is replaced by force. A
shared building block is a component on React that takes props and callbacks only, with no host
context inside (no `useToolQuery`, `ConfirmDialog`, `HandOffButton` or `HostBridge`); it lives in
pulse-ui or in a shared package created with the first engine block two surfaces render. The
webview's esbuild options (`packages/core/runtime-view/scripts/webview-build-options.mjs`, which
every host, dev and test build takes) run its one Tailwind entry,
`packages/core/runtime-view/src/webview/styles/webview.css`, through a Tailwind step
(`packages/core/runtime-view/scripts/tailwind-entries.mjs`: Tailwind's `compile` over the entry,
its `@source` globs scanned, the webview and pulse-ui's dist, `optimize` in a build that ships),
with preflight on, pulse-ui's `theme.css`, the diagram's vendor CSS (diagram-js, bpmn-js,
`cd-canvas.css`) and `diagram.css` unlayered, so the diagram's high-contrast and forced-colours
rules keep winning, modeler-shell's `shell.css` in a layer of its own, `shell`, below the kit's
components and utilities (unlayered, its `inherit` rules beat every kit class), and the root's font
size pinned to 100 %, so pulse-ui's density roles in `rem` keep their 16 px base under the 13 px
`html` of modeler-shell's stylesheets. `<html>` carries
`data-density="compact"`, the pin that keeps the editors compact on a touch laptop, and
`process.env.NODE_ENV` is production in every build that ships, Orca's readable one included, so
React's development build never ships; it stays for its warnings in the builds without
`--production` (watch, smoke, e2e) and on the runtime view's dev page while it serves. The
accessibility and geometry baseline of the webview's tests holds the switch: queries by role, label
and the `data-part` hooks the runtime view's README lists, a kit piece's part resolved through the
harness's map of its `data-slot` (`packages/core/runtime-view/test/architecture/webview-test-hooks.test.ts`
refuses a class, in the tests and in the VS Code scripts under `apps/vscode/scripts`, which resolve
a part through the same map in `apps/vscode/scripts/support/webview-parts.mjs`), an axe run, focus
kept through a live update, and icon and target sizes measured in Chromium
(`packages/core/runtime-view/test/webview/geometry.test.tsx`). pulse-ui's stylesheet follows
`data-cd-theme`, `data-cd-kontrast="hoch"`, `forced-colors` and reduced motion, and its density
roles are compact by default. `apps/vscode/test/architecture/bundle-budget.test.ts` holds the
bundle to one copy each of `react`, `react-dom`, `lucide-react` and `@miragon/pulse-ui`, read from
its metafile. The closed world admits the kit in the webview alone
(`webview-pulse-ui-by-its-entries`: never `./testing`, `globals.css`, the stylesheet of an app
without a Tailwind entry of its own, or `fonts.css`); its rendering libraries are `react`,
`react-dom` and `lucide-react` (the repository's one pin). The webview's script and stylesheet
each have a shrink-only gzip ceiling (`apps/vscode/test/__golden__/bundle-budget.json`), set at the
measured size plus about 5 %; a file that shrinks more than 10 % below its ceiling fails until the
ceiling comes down. Numbers stay neutral here too: an alarming count is neutral and carries a tone
icon of its own shape and words. A feature more than one surface shows, boards first, shows the
same numbers on every surface, from one framework-free builder over one read of engine-core's
read models; elsewhere each tool keeps its own numbers behind the same words (`COUNT_TERMS`) until
its view moves onto shared numbers. The board format and the board builder go into a new published
package (the planned @miragon/pulse-board). The board's "with incident" reads two ways today, the
counter as the history count with open incidents
(`packages/connectors/c7/c7-adapter/src/reading/instance-search.ts`), the incident summary and the
engine strip from a runtime incident scan
(`packages/connectors/c7/c7-adapter/src/reading/definition-reader.ts`); settle that before boards
move.

## Rules

- No comments in code. Names, types and small functions carry the intent. The lint rule
  (`pulse-vscode/no-comments`) cannot be disabled inline.
- Classes, not module functions: one class per file, public methods before private ones,
  ports implemented with `implements`, static utility classes per topic, ports and I/O seams
  through the constructor. See `apps/vscode/docs/adr/code-structure.md`.
- Budgets: complexity 10, 300 lines per file, 60 per function, 4 parameters, 20 statements.
  Split instead of raising.
- The webview and its tests (`packages/core/runtime-view/src/webview`,
  `packages/core/runtime-view/test/webview`) follow `eslint-plugin-react-hooks`'
  `recommended-latest`, the React Compiler rules included, as the version the workspace pins
  defines them (D9's follow-up to the switch, `apps/vscode/docs/adr/ui-foundation.md`): no ref
  read or written during render (an effect reads the latest props through `useEffectEvent`), no
  setState in an effect's body (derive the value while rendering; an effect writes only to what
  React does not render, such as the text of a live region), a pure render, no mutation of props,
  state or a hook's result (the hook that owns a ref writes it), dependencies as written. Every
  rule of the set is an error there, its warnings (`exhaustive-deps`, `incompatible-library`,
  `unsupported-syntax`) included, since `pnpm lint` fails on errors only. The rest of the editor
  trees renders nothing with React and keeps the set off. A finding is fixed, never suppressed
  (`noInlineConfig`); `apps/vscode/test/architecture/lint-rules.test.ts` holds every rule of the
  set to an error on the webview and its tests and off elsewhere, read from the resolved config,
  and lints probes for the rules of hooks and six more of the set.
- Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Thresholds only move one way: the coverage floors (the `vitest.config.ts` of the runtime view,
  of the adapter and of this app) and the webview bundle budget (`apps/vscode/test/__golden__/bundle-budget.json`).
  `pnpm lint:ratchets` holds them to the merge base like every other ratchet of the repo. Do
  not delete tests. An exception to a guardrail is a human's decision in review, never your
  own edit.
- This app's floors measure the host. Two files stay out, and since the config holds no comment
  (`pulse-vscode/no-comments`), their reason stands here: `apps/vscode/src/host/extension.ts`, the
  entry VS Code calls, and `apps/vscode/src/host/pulse-extension.ts`, the activation wiring that
  builds the whole host from the `ExtensionContext`. No unit test runs them; the smoke test
  activates them in a real VS Code and finds every contributed command registered. The runtime
  view's floors measure its host kit too (`packages/core/runtime-view/src/host-kit`, a floor of
  its own): no file of it stays out, since none needs an editor process. A host's test of one of
  its rules counts for no floor (a host measures its own `src` only), so the rule stays uncovered
  until a test of the runtime view runs it: a new rule of the host kit brings its test under
  `packages/core/runtime-view/test/host-kit/`.
- The C7 adapter's error-path goldens (`packages/connectors/c7/c7-adapter/test/goldens/`,
  the files and the case table in `packages/connectors/c7/c7-adapter/test/__golden__/error-paths/`)
  pin what it reports for the engine failures that table lists. An intended change runs
  `pnpm --fail-if-no-match --filter @miragon/pulse-c7-adapter golden:update` (refused in CI)
  and commits the diff; never edit a golden by hand.
- A new gate is a rule in a standard tool (ESLint, dependency-cruiser, knip, tsc, Vitest) or
  a test. A rule you write proves it bites with a case in the `test/architecture` of the package
  whose rule it is;
  see `apps/vscode/docs/adr/guardrails.md`.
- `.pulse.json` is read with Pulse's profile format, `@miragon/pulse-profile`, under the
  credential policy `none`, which refuses a credential (a secret or the variable that holds one):
  `TargetsParser` in the runtime view's host kit, which Pulse for Orca reads its project file
  with too, maps each verdict onto a target or a problem and refuses with `refusalsOn` what the
  editor hosts cannot serve (`headers`, the auth types bearer and passthrough, a named process
  engine, a missing `url`), worded by the format's `describeProblem`, and adds its own way out
  behind an auth type it refuses or the format does not take and behind `headers`: the auth
  types a target then connects with (`EditorAuth.connectsWith`, so not `oauth`, whose profile
  lists its engine and is refused on connect by `TargetPolicy.refusal`, which names `none`, or
  `basic` without the OAuth keys, since `basic` does not take them), and to remove `headers`,
  naming no editor, since both hosts show it. `EditorAuth`
  (`packages/core/runtime-view/src/host-kit/connections/editor-auth.ts`) words every way out, on
  reading and on connecting, once, next to the auth kinds and `EditorAuth.connectsWith`. The move
  refusal's way out through the CLI is the core's `CliWayOut`, its command the adapter's `EngineCli`
  (the C7 adapter's `PulseCli`) on the engine its `CliTarget` names: the profile of the target's
  project file with the target's URL, which beats a `PULSE_CLI_URL` of the user's shell, or the URL
  of the default engine with `--auth none`, on which the CLI takes no profile, only the user's
  `PULSE_CLI_*` environment, whose login `--auth none` switches off
  (`apps/vscode/docs/adr/writes.md`); the wait row carries the command apart from the sentence
  (`WaitRow.cliCommand`) for the copy button beside the can't-move sign. The package owns its JSON
  Schema and the shared fixtures (its `./testing` entry), the runtime view its expectations of them
  (`packages/core/runtime-view/test/host-kit/project-file-fixtures.expected.json`, one entry per
  fixture); `packages/core/runtime-view/test/host-kit/project-file-fixtures.test.ts` holds
  `TargetsParser` to both. A profile the format takes is a target with its URL, auth type and
  read-only flag, or a named problem; a value the format refuses never becomes an engine. The
  extension still reads no user config. A folder that holds the project file only under its
  former name (`ProjectFile.FORMER_NAME` of the host kit, which `TargetsFile` and Pulse for Orca
  read) shows one problem asking to rename it and lists none of its engines, nor the local
  default engine in its place (_Configure Engines_ opens that file and writes no second one); a
  stored sign-in is keyed by the file's path, so the rename asks for it once more.
- When you change a boundary, the contract, the protocol or a dependency, update the matching
  record in `apps/vscode/docs/adr/` in the same commit; the records cover the runtime view and
  the adapter, which both editor hosts run.
- The webview's colours are the Miragon tokens of pulse-ui's `theme.css`, the roles pulse-ui maps
  onto them; the diagram's canvas keeps its vendored copies in
  `packages/core/runtime-view/src/webview/theme/` (`cd-canvas.css`, and
  `cd-tokens.generated.json`, which the renderer's paint constants are pinned to by
  `packages/core/runtime-view/test/webview/canvas-tokens.test.ts`), copied unchanged from
  Miragon/corporate-identity by `brand-assets.mjs` (`.miragon/brand-assets.yaml`) and pinned by
  `.miragon/brand-assets.sha256`: re-copy, never edit (the repository's token drift test reads
  those checksums and holds every token a copy shares with pulse-ui's and the docs kit's to one
  value per scope). pulse-ui's brand gates scan the webview and the texts of
  the runtime view and the host (`apps/vscode/test/architecture/brand-gates.test.ts`,
  `product-words.test.ts`): Lucide icons, never a glyph, at 16 px or at 12 px beside dense text
  and on the diagram's overlays (the named deviation of the root `CLAUDE.md`'s density section,
  each file listed there with its reason), text on pulse-ui's type scale (13 px at least, weights
  400, 600 and 700 only, `scanTypeScale`), and no raw colour outside the renderer's paint
  constants in `diagram/canvas-roles.ts`.
- UI text is English and follows the English rules of the brand tone: sentence case, active
  voice, no dash as a connector. It says what Pulse does today and promises no later feature:
  the promise scan of `product-words.test.ts` refuses "not … yet" in one sentence (a dot in a
  name ends none), "follows" as a promise, "later", "soon", "future", "planned" or "coming", a
  next or named release, "for now", "currently" and "will support" in the texts of the runtime
  view, the host, the packages whose texts both editors show (engine-core, the C7 adapter,
  c7-core, `@miragon/pulse-http`, `@miragon/pulse-profile`) and the manifest and board schema;
  it reads a sentence that a value, an inline tag or a `+` splits as one (its rules in
  `apps/vscode/test/architecture/support/promise-words.ts`, which Pulse for Orca's gate holds
  word for word); a state text such as "Not called yet" keeps its word only as an allowance
  with its reason, and an allowance that spares nothing fails.
- A field, a count or an action added to or changed in a view the MCP cockpit has too (the
  engine overview, a process, its instances, an instance, an incident, the history) is a pair
  feature: where both show it, a shared building block is the default (above). Its pull request updates the parity list
  `docs/vscode/parity.md` by its review rule. Decisions about shared building blocks are the
  product owner's and go through normal review.
- The .vsix ships `THIRD_PARTY_LICENSES.txt` beside `LICENSE` (`.vscodeignore`; the package job of
  `ci.yml` and the release's check in `publish-vscode-extension.yml` name it, one list): the works
  of others esbuild bundles into the extension host and the webview (packages, fonts, esbuild's
  runtime helpers, the components pulse-ui's primitives build on, shadcn/ui) with their licence files, read from
  the metafiles of both builds, and from what the webview's Tailwind step inlines, which no
  metafile names (`inlinedStylesheets`), by the repository's licence list
  (`scripts/third-party-licenses.mjs`). `apps/vscode/test/architecture/third-party-licenses.test.ts`
  fails while it misses a work or lists one the bundles hold no more, so a bump of a bundled package
  writes it again in its pull request:
  `pnpm --fail-if-no-match --filter pulse-cockpit third-party-licenses`.
- Commit messages are Conventional Commits with the scope `vscode`.
- Model BPMN only with the bpmn CLI (`npx -y @miragon/bpmn-cli@0.7.0`), never by hand; the
  conformance world's element ids are fixed.
