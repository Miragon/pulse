# CLAUDE.md (apps/vscode)

Guidance for agents working on Pulse for VS Code: the extension `pulse` (Marketplace
id `miragon-gmbh.pulse`), an engine-neutral runtime view for process engines inside
VS Code. It is an interface app of the Pulse monorepo. The repository's package rules hold
here (the root `CLAUDE.md`: layout and naming, the dependency edges of invariant 8, the
ratchets, Verification); the MCP invariants are written for the MCP server, its modules and
its widgets, and this file replaces them for the extension.

## Commands

Run them from the repository root.

```sh
pnpm --filter pulse run typecheck        # tsc over the app, then once per layer with that layer's globals
pnpm --filter pulse run lint             # ESLint with the house rules below
pnpm lint:architecture:vscode                   # the closed-world dependency rules
pnpm lint:deadcode:vscode                       # knip over the extension, unused exports and types included
pnpm --filter pulse test                 # unit and webview (Chromium) tests, coverage floors
pnpm --filter pulse run test:mutation    # Stryker over contract, core, the C7 adapter and the model adapter
pnpm --filter pulse run test:engines     # adapter conformance on a real engine; needs podman/docker
pnpm --filter pulse run test:smoke       # the extension activates in a real VS Code
pnpm --filter pulse run test:e2e         # VS Code e2e; needs `engine:up`
pnpm --filter pulse run sandbox:up       # shop sandbox for manual testing: two seeded engines
pnpm --filter pulse run sandbox:open     # build, start the sandbox if needed, open it in VS Code
pnpm --filter pulse run docs:screenshots # one screenshot per use case (after sandbox:up)
pnpm --filter pulse run package          # the .vsix
```

The bar for every change is the repository's: `pnpm build && pnpm typecheck && pnpm test &&
pnpm lint` at the root. The webview tests run in Chromium: install it once with
`pnpm --filter pulse exec playwright install chromium`. Run `test:engines`, `test:e2e`
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

| You want to…                                                                | Put it in                                                                                                                                                                                    | Never                                      |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Add an engine question                                                      | `apps/vscode/src/contract` (port + read model + a conformance law + a saboteur)                                                                                                              | engine words in the contract               |
| Add a write                                                                 | `ProcessCommands` + a command law + a saboteur; policy and confirmation per `apps/vscode/docs/adr/writes.md`                                                                                 | authority in a webview intent              |
| Interpret runtime data (grouping, root cause, view models, panel behaviour) | `apps/vscode/src/core`                                                                                                                                                                       | `vscode`, DOM, Node, engine words          |
| Change what the webview shows                                               | `apps/vscode/src/core/protocol` (types) and `apps/vscode/src/webview`                                                                                                                        | logic in the webview, `--vscode-*` colours |
| Talk to Operaton / CIB seven / Camunda 7                                    | `apps/vscode/src/adapters/c7` (mapping) and `apps/vscode/src/adapters/c7/engine-cli` (CLI wrapper)                                                                                           | imports from core, webview or host         |
| Add an engine                                                               | `apps/vscode/src/adapters/<engine>` with a class implementing `EngineAdapter` + an `*.engine.test.ts` running the `ConformanceKit` + one entry in `apps/vscode/src/host/composition-root.ts` | branching on engines anywhere else         |
| Read the local `.bpmn` model or find the implementing code                  | `apps/vscode/src/model` (behind `ModelSource` / `CodeLocator`), per `apps/vscode/docs/adr/local-sources.md`                                                                                  | moddle or bpmn-modeler libs anywhere else  |
| Wire VS Code                                                                | `apps/vscode/src/host`                                                                                                                                                                       | business rules                             |

The dependency rules are closed-world (`apps/vscode/.dependency-cruiser.cjs`): an import that
is not explicitly allowed fails `pnpm lint:architecture:vscode` with a message that says where
it belongs. The repository's rules apply on top (`extension-is-not-an-mcp-host`: no
widget-shell, no toolkit, no React, no zod, no other workspace package but a `-domain` one).

## Rules

- No comments in code. Names, types and small functions carry the intent. The lint rule
  (`pulse-vscode/no-comments`) cannot be disabled inline.
- Classes, not module functions: one class per file, public methods before private ones,
  ports implemented with `implements`, static utility classes per topic, ports and I/O seams
  through the constructor. See `apps/vscode/docs/adr/code-structure.md`.
- Budgets: complexity 10, 300 lines per file, 60 per function, 4 parameters, 20 statements.
  Split instead of raising.
- Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Thresholds only move one way: the coverage floors (`apps/vscode/vitest.config.ts`), the
  mutation floor (`apps/vscode/stryker.config.json`) and the webview bundle budget
  (`apps/vscode/test/__golden__/bundle-budget.json`). `pnpm lint:ratchets` holds them to the
  merge base like every other ratchet of the repo. Do not delete tests. An exception to a
  guardrail is a human's decision in review, never your own edit.
- A new gate is a rule in a standard tool (ESLint, dependency-cruiser, knip, tsc, Vitest,
  Stryker) or a test. A rule you write proves it bites with a case in
  `apps/vscode/test/architecture`; see `apps/vscode/docs/adr/guardrails.md`.
- When you change a boundary, the contract, the protocol or a dependency, update the matching
  record in `apps/vscode/docs/adr/` in the same commit.
- The webview's colours are the Miragon tokens in `apps/vscode/src/webview/theme/`, vendored
  unchanged from Miragon/corporate-identity and pinned by its `manifest.json`: re-vendor,
  never edit (the repository's token drift test reads that manifest).
- UI text is English and follows the English rules of the brand tone: sentence case, active
  voice, no dash as a connector.
- Commit messages are Conventional Commits with the scope `vscode`.
- Model BPMN only with the bpmn CLI (`npx -y @miragon/bpmn-cli@0.7.0`), never by hand; the
  conformance world's element ids are fixed.
