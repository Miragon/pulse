# CLAUDE.md (apps/vscode)

Guidance for agents working on Pulse for VS Code: the extension `pulse` (Marketplace
id `miragon-gmbh.pulse-cockpit`), an engine-neutral runtime view for process engines inside
VS Code. It is an interface app of the Pulse monorepo. The repository's package rules hold
here (the root `CLAUDE.md`: layout and naming, the dependency edges of invariant 8, the
ratchets, Verification); the MCP invariants are written for the MCP server, its modules and
its widgets, and this file replaces them for the extension.

## Commands

Run them from the repository root.

```sh
pnpm --filter pulse-cockpit run typecheck        # tsc over the app, then once per layer with that layer's globals
pnpm --filter pulse-cockpit run lint             # ESLint with the house rules below
pnpm lint:architecture:vscode                   # the closed-world dependency rules
pnpm lint:deadcode                              # knip over every workspace: dead files, dependencies, enum members
pnpm lint:deadcode:exports                      # knip over every workspace but docs: unused exports and types
pnpm --filter pulse-cockpit test                 # unit and webview (Chromium) tests, coverage floors
pnpm --filter pulse-cockpit run test:engines     # adapter conformance on a real engine; needs podman/docker
pnpm --filter pulse-cockpit run test:smoke       # the extension activates in a real VS Code
pnpm --filter pulse-cockpit run test:e2e         # VS Code e2e; needs `engine:up`
pnpm --filter pulse-cockpit run test:smoke:docker # both in Docker under Xvfb: no VS Code window
pnpm --filter pulse-cockpit run test:e2e:docker   # on your desktop (e2e: needs `engine:up`)
pnpm --filter pulse-cockpit run sandbox:up       # shop sandbox for manual testing: two seeded engines
pnpm --filter pulse-cockpit run sandbox:open     # build, start the sandbox if needed, open it in VS Code
pnpm --filter pulse-cockpit run docs:screenshots # one screenshot per use case (after sandbox:up)
pnpm --filter pulse-cockpit run package          # the .vsix
```

The C7 adapter bundles engine-core from its build: after `pnpm install`, build it once
(`pnpm exec turbo run build --filter='pulse-cockpit^...'`, or `pnpm build`) before these
commands, and again after a change to engine-core.

While you iterate, `pnpm test:one apps/vscode/test/<path>.test.ts` runs the files you touch
(coverage off, engine-core built first; run alone, a file fails the floors, since
`coverage.include` counts every file it does not load), then
`pnpm exec turbo run typecheck test lint --filter=pulse-cockpit` the package. The bar for every
change is the repository's: `pnpm check` at the root. The webview tests run in Chromium: install it
once with `pnpm --filter pulse-cockpit exec playwright install chromium`. Run `test:engines`, `test:e2e`
and `docs:screenshots` only when the change touches the adapter or the contract, the VS Code
flows or the screens.

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

The app is one package with six layers under `apps/vscode/src`. Each layer has its own
`tsconfig.<layer>.json` (its runtime's globals only) and its own dependency rules.

| You want to…                                                    | Put it in                                                                                                                                                                                                      | Never                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Add an engine question                                          | `apps/vscode/src/contract` (port + read model + a conformance law + a saboteur)                                                                                                                                | engine words in the contract               |
| Add a write                                                     | `ProcessCommands` + a command law + a saboteur; policy and confirmation per `apps/vscode/docs/adr/writes.md`                                                                                                   | authority in a webview intent              |
| Interpret runtime data (grouping, view models, panel behaviour) | `apps/vscode/src/core`                                                                                                                                                                                         | `vscode`, DOM, Node, engine words          |
| Change what the webview shows                                   | `apps/vscode/src/core/protocol` (types) and `apps/vscode/src/webview`                                                                                                                                          | logic in the webview, `--vscode-*` colours |
| Talk to Operaton / CIB seven / Camunda 7                        | `apps/vscode/src/adapters/c7` (mapping) and `apps/vscode/src/adapters/c7/engine-rest` (REST client; its `inspect` runs engine-core over it); inspect, wait states, root causes in `@miragon/pulse-engine-core` | imports from core, webview or host; a copy |
| Add an engine                                                   | `apps/vscode/src/adapters/<engine>` with a class implementing `EngineAdapter` + an `*.engine.test.ts` running the `ConformanceKit` + one entry in `apps/vscode/src/host/composition-root.ts`                   | branching on engines anywhere else         |
| Read the local `.bpmn` model or find the implementing code      | `apps/vscode/src/model` (behind `ModelSource` / `CodeLocator`), per `apps/vscode/docs/adr/local-sources.md`                                                                                                    | moddle or bpmn-modeler libs anywhere else  |
| Wire VS Code                                                    | `apps/vscode/src/host`                                                                                                                                                                                         | business rules                             |

The dependency rules are closed-world (`apps/vscode/.dependency-cruiser.cjs`): an import that
is not explicitly allowed fails `pnpm lint:architecture:vscode` with a message that says where
it belongs (dependency-cruiser reports it as `not-in-allowed` and takes the wording from the
forbidden rule of that name, which never fires itself). Nothing outside them is allowed, so no
widget-shell, no React, no zod and two workspace packages only, each bundled by esbuild. The C7
adapter (`apps/vscode/src/adapters/c7` and its tests in `apps/vscode/test/adapters/c7`) imports
`@miragon/pulse-engine-core`, the Camunda 7 family's workflow domain that the CLI and the MCP
server run too, through its main entry (`engine-core-only-in-the-c7-adapter`; the repository's
`family-core-consumers`). The core and the webview import Pulse's UI foundation as
`@miragon/pulse-ui/tones` and `@miragon/pulse-ui/format` only: the tone vocabulary and
`SITUATION_TONES`, the one tone per situation the MCP widgets show too, and the formatters,
framework-free (`pulse-ui-only-its-foundation`; the repository's
`ui-foundation-entries-import-nothing`). The React kit stays out; the webview draws a tone with
its own CSS classes, and `apps/vscode/test/webview/situation-tones.test.tsx` holds its state
labels and diagram badges to the table. A time, a duration, a count or a short id goes through
`TimeLabels`, `CountLabels` (webview) or `Labels` (core), which delegate to the formatters in
English with a 24-hour clock and alone may import them (the closed world allows
`@miragon/pulse-ui/format` only from `core/views/labels.ts` and the webview's `format/`); a count
in a text goes in through them too (`Labels.count`, `CountLabels.exact`), and the repository's
date and number gates keep `Intl`, `toFixed` and a locale-less `toLocaleString()` out of core
and webview. A change to
how an instance is inspected, where it waits, what its root cause is or when a 404 names a
missing resource (`isMissing`) goes into engine-core, never into a copy here; the adapter's
`InspectView` is engine-core's instance view, not a mirror of it. Contract, core, webview and
host stay engine-neutral.

## Rules

- No comments in code. Names, types and small functions carry the intent. The lint rule
  (`pulse-vscode/no-comments`) cannot be disabled inline.
- Classes, not module functions: one class per file, public methods before private ones,
  ports implemented with `implements`, static utility classes per topic, ports and I/O seams
  through the constructor. See `apps/vscode/docs/adr/code-structure.md`.
- Budgets: complexity 10, 300 lines per file, 60 per function, 4 parameters, 20 statements.
  Split instead of raising.
- Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Thresholds only move one way: the coverage floors (`apps/vscode/vitest.config.ts`) and the
  webview bundle budget (`apps/vscode/test/__golden__/bundle-budget.json`).
  `pnpm lint:ratchets` holds them to the merge base like every other ratchet of the repo. Do
  not delete tests. An exception to a guardrail is a human's decision in review, never your
  own edit.
- The C7 adapter's error-path goldens (`apps/vscode/test/adapters/c7/goldens/`, the files and
  the case table in `apps/vscode/test/__golden__/error-paths/`) pin what it reports for the
  engine failures that table lists. An intended change runs
  `pnpm --fail-if-no-match --filter pulse-cockpit golden:update` (refused in CI) and commits the
  diff; never edit a golden by hand.
- A new gate is a rule in a standard tool (ESLint, dependency-cruiser, knip, tsc, Vitest) or
  a test. A rule you write proves it bites with a case in `apps/vscode/test/architecture`;
  see `apps/vscode/docs/adr/guardrails.md`.
- `.pulse-cli.json` follows the CLI's rules: the CLI owns its JSON Schema and the fixtures in
  `apps/cli/test/fixtures/project-file/` (the file and the CLI's verdict), the extension its
  expectations of them (`apps/vscode/test/host/project-file-fixtures.expected.json`, one entry
  per fixture). `apps/vscode/test/host/project-file-fixtures.test.ts` reads the fixtures as files
  (never an import) and holds `TargetsParser` to both. A profile the CLI accepts is a target with
  the CLI's URL, auth type and read-only flag, or a named problem; a value the CLI refuses never
  becomes a default. Change the parser with the fixtures, not apart.
- When you change a boundary, the contract, the protocol or a dependency, update the matching
  record in `apps/vscode/docs/adr/` in the same commit.
- The webview's colours are the Miragon tokens in `apps/vscode/src/webview/theme/`, vendored
  unchanged from Miragon/corporate-identity and pinned by its `manifest.json`: re-vendor,
  never edit (the repository's token drift test reads that manifest and holds every token the
  copy shares with pulse-ui's and the docs kit's to one value per scope, so a release that
  changes a value is vendored into every copy at once). pulse-ui's brand gates scan the webview
  (`apps/vscode/test/architecture/brand-gates.test.ts`): Lucide icons, never a glyph, at
  16 px or at 12 px beside dense text and on the diagram's overlays (the named deviation, each
  file listed there with its reason), and no raw colour outside the renderer's paint constants
  in `diagram/canvas-roles.ts`.
- UI text is English and follows the English rules of the brand tone: sentence case, active
  voice, no dash as a connector.
- Commit messages are Conventional Commits with the scope `vscode`.
- Model BPMN only with the bpmn CLI (`npx -y @miragon/bpmn-cli@0.7.0`), never by hand; the
  conformance world's element ids are fixed.
