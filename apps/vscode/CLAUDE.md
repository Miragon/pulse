# Agent instructions

Pulse is an engine-neutral, read-only runtime view for process engines in VS Code.
`CLAUDE.md` links to this file.

## Commands

```sh
npm run verify          # inner loop and before every commit: typecheck, lint, format, arch, knip, unit tests
npm run check           # before you say "done": the same with browser tests, coverage and bundle budget
npm run test:mutation:delta # Stryker on the lines changed against origin/main, after logic changes in contract, core or an adapter
npm run test:mutation   # Stryker on everything, incremental (`-- --force` after test changes); runs nightly on main
npm run test:browser    # webview (Chromium)
npm run test:engine     # adapter conformance on a real engine; needs podman/docker
npm run test:e2e        # VS Code e2e; needs `npm run engine:up`
npm run sandbox:up      # shop sandbox for manual testing: two seeded engines, see sandbox/README.md
npm run sandbox:open    # build, start the sandbox if needed and open it in VS Code with this build
npm run docs:screenshots # one screenshot per use case into docs/screenshots (after sandbox:up)
```

The README demo GIF `apps/vscode/docs/demo.gif` comes from the `product-shots` skill of the
`miragon-brand` plugin ([Miragon/corporate-identity](https://github.com/Miragon/corporate-identity)),
journey `pulse-vscode-demo.mjs`, with `sandbox:up` and `sandbox:traffic` running. This repo keeps
no script of its own for it.

Keep iterations short: run `verify` while you work and `check` once at the end. Run
`test:engine`, `test:e2e` and `docs:screenshots` only when the change touches the adapter
or contract, the VS Code flows, or the screens.

`engine:up` seeds the fixed conformance world that the e2e test asserts on; do not change
it for manual testing. Manual and exploratory scenarios belong in `apps/vscode/scripts/sandbox/scenarios.mjs`;
keep the business keys in `apps/vscode/sandbox/README.md` in step with it.

With podman: `DOCKER_HOST=unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')`
and `TESTCONTAINERS_RYUK_DISABLED=true` for `test:engine`.

## Where code goes

| You want to…                                                                | Put it in                                                                                                                                                                            | Never                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Add an engine question                                                      | `apps/vscode/src/contract` (port + read model + a conformance law + a saboteur)                                                                                                      | engine words in the contract               |
| Add a write                                                                 | `ProcessCommands` + a command law + a saboteur; policy and confirmation per `apps/vscode/docs/adr/writes.md`                                                                         | authority in a webview intent              |
| Interpret runtime data (grouping, root cause, view models, panel behaviour) | `apps/vscode/src/core`                                                                                                                                                               | `vscode`, DOM, Node, engine words          |
| Change what the webview shows                                               | `apps/vscode/src/core/protocol` (types) and `apps/vscode/src/webview`                                                                                                                | logic in the webview, `--vscode-*` colours |
| Talk to Operaton / CIB seven / Camunda 7                                    | `apps/vscode/src/adapters/c7` (mapping) and `src/engine-cli` (CLI wrapper)                                                                                                           | imports from core, webview or extension    |
| Add an engine                                                               | `packages/adapter-<engine>` with a class implementing `EngineAdapter` + an `*.engine.test.ts` running the `ConformanceKit` + one entry in `apps/vscode/src/host/composition-root.ts` | branching on engines anywhere else         |
| Read the local `.bpmn` model or find the implementing code                  | `apps/vscode/src/model` (behind `ModelSource` / `CodeLocator`), per `apps/vscode/docs/adr/local-sources.md`                                                                          | moddle or bpmn-modeler libs anywhere else  |
| Wire VS Code                                                                | `apps/vscode/src/host`                                                                                                                                                               | business rules                             |

The dependency rules are closed-world (`.dependency-cruiser.cjs`): an import that is not
explicitly allowed fails `npm run arch` with a message that says where it belongs.

## Rules

- No comments in code. Names, types and small functions carry the intent. The lint rule
  cannot be disabled inline.
- Classes, not module functions: one class per file, public methods before private
  ones, ports implemented with `implements`, static utility classes per topic, ports and
  I/O seams through the constructor. See `apps/vscode/docs/adr/code-structure.md`.
- Budgets: complexity 10, 300 lines per file, 60 per function, 4 parameters,
  20 statements. Split instead of raising.
- Strict TypeScript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- Thresholds only move one way: coverage (`vitest.config.ts`) and mutation score
  (`stryker.config.json`) up, bundle budget (`.size-limit.json`) down. Do not lower them,
  do not delete tests. An exception to a guardrail config is a human's decision in
  review, never your own edit.
- A new gate is a standard tool or a rule in one (ESLint, dependency-cruiser, knip, tsc,
  Vitest, Stryker, size-limit), not a custom script. A rule you write proves it bites
  with a case in `apps/vscode/test/architecture`; see `apps/vscode/docs/adr/guardrails.md`.
- When you change a boundary, the contract, the protocol or a dependency, update the
  matching record in `apps/vscode/docs/adr/` in the same commit.
- Commit messages are Conventional Commits.
- Model BPMN only with the bpmn CLI (`npx -y @miragon/bpmn-cli@0.7.0`), never by hand;
  the conformance world's element ids are fixed.
