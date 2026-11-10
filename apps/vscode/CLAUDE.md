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
pnpm --filter @miragon/pulse-runtime-view test   # core, model, host kit and webview (Chromium) tests, coverage floors but for the host kit
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

The README demo GIF `apps/vscode/docs/demo.gif` comes from the `product-shots` skill of the
`miragon-brand` plugin ([Miragon/corporate-identity](https://github.com/Miragon/corporate-identity)),
journey `pulse-vscode-demo.mjs`, with `sandbox:up` and `sandbox:traffic` running. This repo
keeps no script of its own for it.

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
| Add a port only the editor hosts need                           | `packages/core/runtime-view/src/ports` (`EngineAdapter`, `EngineWebUi`, `ModelSource`, `CodeLocator`, `WorkspaceFiles`)                                                                                                                                                                                             | an IDE port in engine-core                 |
| Share a host rule (targets, policies, the write audit, titles)  | `packages/core/runtime-view/src/host-kit`                                                                                                                                                                                                                                                                           | `vscode`, an editor's API                  |
| Wire VS Code                                                    | `apps/vscode/src/host`                                                                                                                                                                                                                                                                                              | business rules                             |

The dependency rules are closed-world, one config per package (`apps/vscode/.dependency-cruiser.cjs`,
`packages/core/runtime-view/.dependency-cruiser.cjs`,
`packages/connectors/c7/c7-adapter/.dependency-cruiser.cjs`): an import that is not
explicitly allowed fails its `pnpm lint:architecture:<package>` with a message that says where it
belongs (dependency-cruiser reports it as `not-in-allowed` and takes the wording from the
forbidden rule of that name, which never fires itself). Nothing outside them is allowed, so no
widget-shell, no React, no zod. The engine contract has one home, the engine family's core
`@miragon/pulse-engine-core` (`packages/connectors/engine/engine-core`, owner decision
2026-11-09 on #585): the ports, read models and errors every dialect answers in. The runtime
view's ports, core, model reader and host kit and the host import its main entry, its tests,
dev harnesses and the dev host its `./testing` entry (the kit, the world, `FakeEngine`), and
nothing imports a file of the package by path (`engine-core-only-by-its-entries`). The ports
only the editor hosts need (`EngineAdapter` with `EngineConnection`, `EngineCredentials` and
`EngineWebUi`, `ModelSource`, `CodeLocator`, `WorkspaceFiles`) live in the runtime view's
`src/ports` (`@miragon/pulse-runtime-view/ports`), never in engine-core. The package keeps these
house rules (the repository's ESLint config names its paths next to the editor trees'), and it
follows the views: a question the views need lands there first, below 1.0 without a stability
promise. The host reaches the runtime view only through the entries of its ports, core,
protocol and host kit, and only its composition root the adapter and the model reader. The C7
adapter (`packages/connectors/c7/c7-adapter`, its tests beside it) imports
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
webview import Pulse's UI foundation as `@miragon/pulse-ui/tones` and `@miragon/pulse-ui/format`
only: the tone vocabulary and `SITUATION_TONES`, the one tone per situation the MCP widgets show
too, and the formatters, framework-free (`pulse-ui-only-its-foundation`; the repository's
`ui-foundation-entries-import-nothing`). That foundation is all the webview shares with the MCP
widgets, never a component, by the product owner's decision
(`apps/vscode/docs/adr/ui-foundation.md`; #586 holds when they share building blocks again). The
React kit stays out; the webview draws a tone with its own CSS classes, and
`packages/core/runtime-view/test/webview/situation-tones.test.tsx` holds its state labels and
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

## Rules

- No comments in code. Names, types and small functions carry the intent. The lint rule
  (`pulse-vscode/no-comments`) cannot be disabled inline.
- Classes, not module functions: one class per file, public methods before private ones,
  ports implemented with `implements`, static utility classes per topic, ports and I/O seams
  through the constructor. See `apps/vscode/docs/adr/code-structure.md`.
- Budgets: complexity 10, 300 lines per file, 60 per function, 4 parameters, 20 statements.
  Split instead of raising.
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
  view's floors leave its host kit out (`packages/core/runtime-view/src/host-kit`).
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
  engine, a missing `url`), worded by the format's `describeProblem`. The package owns its JSON
  Schema and the shared fixtures (its `./testing` entry), the runtime view its expectations of
  them (`packages/core/runtime-view/test/host-kit/project-file-fixtures.expected.json`, one entry
  per fixture); `packages/core/runtime-view/test/host-kit/project-file-fixtures.test.ts` holds
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
- The webview's colours are the Miragon tokens in `packages/core/runtime-view/src/webview/theme/`, vendored
  unchanged from Miragon/corporate-identity by `brand-assets.mjs` (`.miragon/brand-assets.yaml`) and
  pinned by `.miragon/brand-assets.sha256`: re-copy, never edit (the repository's token drift
  test reads those checksums and holds every token the copy shares with pulse-ui's and the docs
  kit's to one value per scope, so a release that changes a value is copied into every copy at
  once). pulse-ui's brand gates scan the webview and the texts of the runtime view and the host
  (`apps/vscode/test/architecture/brand-gates.test.ts`, `product-words.test.ts`): Lucide icons, never a glyph, at
  16 px or at 12 px beside dense text and on the diagram's overlays (the named deviation, each
  file listed there with its reason), and no raw colour outside the renderer's paint constants
  in `diagram/canvas-roles.ts`.
- UI text is English and follows the English rules of the brand tone: sentence case, active
  voice, no dash as a connector.
- A field, a count or an action added to or changed in a view the MCP cockpit has too (the
  engine overview, a process, its instances, an instance, an incident, the history) is a pair
  feature: its pull request says whether the MCP widgets get it and updates the parity list
  `docs/vscode/parity.md` by its review rule.
- Commit messages are Conventional Commits with the scope `vscode`.
- Model BPMN only with the bpmn CLI (`npx -y @miragon/bpmn-cli@0.7.0`), never by hand; the
  conformance world's element ids are fixed.
