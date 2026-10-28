# Guardrails

- Status: accepted
- Last reviewed: 2026-10-24 (moved into the Pulse monorepo)

## Context

Most code in this repository is written by agents. Rules that live only in prose are
optional for an agent under pressure, and a gate that never fired may check nothing
(a sibling repo had an ESLint ban that matched no folder). Every rule therefore gets a
machine check, and every check has been seen to fail.

Until v0.2 several checks were scripts of our own: a typecheck loop, a diff of
`guardrails/ratchets.json` against the merge base with a label lookup in CI, a gzip
bundle check, regex scans for engine words and host colours, and a TypeScript
compiler probe per package. On 2026-10-22 the product owner asked for a tooling-first
setup instead (as in `Miragon/bpmn-cli`): standard tools, configured, no check logic
of our own, and faster runs. On 2026-10-24 the extension moved into the Pulse monorepo as
`apps/vscode`: the same rules, now run by the repository's tooling and its gates.

## Decision

Each rule lives in the tool that can express it, and the repository's bar runs them all:
`pnpm build && pnpm typecheck && pnpm test && pnpm lint` at the repository root.

| Tool                                                 | What it guards                                                                                                                                                                                                                                                                                                                                                                                                                        | Configured in                                                                                                                                             | Seen to fail                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`tsc --noEmit`, then `tsc -p` per layer) | strict types; each layer sees only its runtime's globals (no DOM in contract, core and host, no Node in contract, core and webview)                                                                                                                                                                                                                                                                                                   | `apps/vscode/tsconfig.json` (the union the editor and ESLint use) and one `tsconfig.<layer>.json` per layer, with a `runtime.boundary.ts` probe per layer | `DOM` added to the core's `lib` → `test/core/runtime.boundary.ts(1,1): error TS2578` (an unused `@ts-expect-error`)                                   |
| ESLint                                               | no comments (the one rule of our own), no inline disabling, budgets (complexity 10, 300 lines, 60 per function, 4 params, 20 statements); no engine words in contract, core and webview, nor in the host outside `composition-root.ts` and `connections/`; no `--vscode-*` colours in webview TS and TSX; classes, one per file; the rules of hooks in the webview; on the JS files the strict and stylistic rules that need no types | the `apps/vscode` blocks of the root `eslint.config.mjs` (`no-restricted-syntax`, the inline `pulse-vscode/no-comments`)                                  | `apps/vscode/test/architecture/lint-rules.test.ts` lints probes for each rule                                                                         |
| Vitest (a scan)                                      | no `--vscode-*` colours in the webview's stylesheets                                                                                                                                                                                                                                                                                                                                                                                  | `apps/vscode/test/architecture/host-colours.test.ts`                                                                                                      | its probes: `var(--cd-x, var(--vscode-x))` reads as `--vscode-x`                                                                                      |
| Vitest (a config scan)                               | the configs CI runs by name (`test:engines`, `test:smoke`) select every engine and smoke test and switch none off (`passWithNoTests`, an `exclude`, a name filter)                                                                                                                                                                                                                                                                    | `apps/vscode/test/architecture/ci-configs.test.ts`                                                                                                        | the engines `include` narrowed to `test/none/**` with `passWithNoTests` → 2 failed tests                                                              |
| dependency-cruiser                                   | closed-world layer dependencies, no cycles, engine CLI wrapper self-contained, protocol imports nothing, webview takes the protocol type-only, adapters only via the composition root, BPMN model libraries only in the model adapter, no dev or undeclared dependencies in shipped code, every adapter run by an engine test that uses the conformance kit                                                                           | `apps/vscode/.dependency-cruiser.cjs` (`allowed`, `forbidden`, `required`), run by `pnpm lint:architecture:vscode`; the repository's rules on top         | `apps/vscode/test/architecture/dependency-rules.test.ts` plants a tree with one violation per rule in a temporary directory and expects exactly those |
| knip                                                 | no dead files, dependencies, exports or exported types (with dependency-cruiser this also keeps the contract free of runtime dependencies)                                                                                                                                                                                                                                                                                            | the `apps/vscode` workspace of the root `knip.jsonc`, run by `pnpm lint:deadcode:vscode` with every issue type                                            | an unused `export const` in `apps/vscode/src/core/incidents/root-cause.ts` → `Unused exports (1)`, exit 1                                             |
| Prettier                                             | formatting                                                                                                                                                                                                                                                                                                                                                                                                                            | the root `.prettierrc.json` (its Tailwind plugin off for `apps/vscode`)                                                                                   | —                                                                                                                                                     |
| Vitest                                               | unit tests in Node, webview tests in Chromium (browser mode), engine tests; coverage floors, global and per layer                                                                                                                                                                                                                                                                                                                     | `apps/vscode/vitest.config.ts`, `apps/vscode/vitest.engines.config.ts`                                                                                    | `"src/model/**"` lines set to 99.9 → `ERROR: Coverage for lines (99.2%) does not meet "src/model/**" threshold (99.9%)`                               |
| Stryker                                              | mutation score of contract, core, the C7 adapter and the model adapter does not drop                                                                                                                                                                                                                                                                                                                                                  | `apps/vscode/stryker.config.json` (`thresholds.break`), `apps/vscode/vitest.stryker.config.ts`                                                            | `thresholds.break` set to 90 for `src/core/incidents/root-cause.ts` (87.04) → `Final mutation score 87.04 under breaking threshold 90`, exit 1        |
| Vitest (a production build)                          | webview bundle ≤ 200 000 B gzip                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/vscode/test/__golden__/bundle-budget.json`, checked by `apps/vscode/test/architecture/bundle-budget.test.ts`                                        | ceiling set to 100 000 B → `webview.js is 115846 bytes gzip, over its ceiling`                                                                        |
| `@vscode/test-cli`, Playwright                       | the extension activates and registers every command; the user-facing flows work against a real engine                                                                                                                                                                                                                                                                                                                                 | `test:smoke`, `test:e2e`                                                                                                                                  | —                                                                                                                                                     |

ESLint lints `src`, `test`, `dev`, `scripts` and `sandbox`. The configs at the package root
(`.vscode-test.mjs`, `.dependency-cruiser.cjs`, the vitest configs) stay outside it, as in
every Pulse package: the canonical lint command names source directories only. `pnpm typecheck`
covers the vitest configs, and `ci-configs.test.ts` the two that CI runs by name.

Error messages are written as instructions to the next agent (what to move where).
Bundling the webview for `platform: 'browser'` already refuses Node built-ins, and
dependency-cruiser refuses `vscode` there, so the bundle needs no content scan.

Behaviour that no tool can express stays in ordinary tests next to the code: overlapping
loads (`core/races.test.ts`), the target and write policy
(`host/connections.test.ts`, `writes.test.ts`, `manifest.test.ts`), intent
validation (`protocol-and-problems.test.ts`, `write-texts.test.ts`), the write runner
(`adapters/c7/c7-commands.test.ts`), write feedback (`instance-writes.test.ts`) and the
conformance kit with its saboteurs (`contract/conformance-kit.test.ts`,
`command-kit.test.ts`).

### Thresholds move one way

Coverage and mutation score only go up, the bundle budget only goes down, tests are not
deleted (deleting one lowers coverage and the mutation score, both gated). The repository
checks the direction against the merge base (`pnpm lint:ratchets`): the coverage floors of
`apps/vscode/vitest.config.ts`, the `mutate` list and `thresholds.break` of
`apps/vscode/stryker.config.json`, the bundle budget and the ESLint budgets. A step the
other way needs a `Ratchet-Exception:` trailer that says why, and a human reviews it. This
replaces the ratchet diff script and the `guardrail-exception` label of the original
repository.

### The ruleset of `main`

The repository's: changes reach `main` only through a pull request, squash-merged (linear
history, signed commits, no force push, no deletion), and the pull request title follows
Conventional Commits (`.github/workflows/pr-title.yml`). The extension's checks run in the
repository's CI (`.github/workflows/ci.yml`) next to the server's.

### Why these tools

- dependency-cruiser is this repository's ArchUnit. ArchUnitTS writes the same folder
  rules as tests; dependency-cruiser keeps them as configuration with a message per
  rule and also knows what this architecture needs beyond folders: type-only imports
  (webview → protocol), npm dependency kinds and reachability (an adapter without an
  engine test). One tool per rule is enough.
- Its config names `apps/vscode/tsconfig.json` by an absolute path: TypeScript 6 resolves
  the `include` list of a tsconfig named by a relative path with a directory against the
  wrong base, finds no input (`TS18003`) and the run aborts.
- The layers are folders of one package, not packages: the repository's gates know
  `apps/<app>` only. One `tsconfig.<layer>.json` per layer keeps the globals boundary that
  per-package tsconfigs gave. A layer config sets `"exclude": []`, or it inherits the
  union's exclusion of the probes and checks nothing, and the non-webview layers unset
  `jsx` and `jsxImportSource`: preact's JSX types reference the DOM library and would leak
  it into every layer.
- Stryker runs with its vitest runner (`@stryker-mutator/vitest-runner` 10.0.0 on Vitest
  4.1.11, `perTest` coverage): it reruns only the tests that cover a mutant.
  `apps/vscode/vitest.stryker.config.ts` runs the Node suites of the mutated layers with
  coverage off (a coverage floor failing would read as a killed mutant); the webview's
  browser tests cannot run under the runner.
- The engine conformance suite needs Docker or Podman, so it runs as `test:engines`
  (`apps/vscode/vitest.engines.config.ts`) and stays out of `vitest run`. The webview's
  browser tests stay in: the webview's floor and the global floors depend on them.
- `pulse-vscode/no-comments` stays an inline ESLint rule of a dozen lines: ESLint has no
  core rule that bans every comment, and a plugin dependency for it would cost more
  than those lines. The repository's ESLint config is not scoped to TypeScript files, so
  it cannot lint CSS with `@eslint/css`; the ban on `--vscode-*` in stylesheets is a test
  instead.
- Of the React hooks rules only `rules-of-hooks` is on in the webview: the React Compiler
  rules of `recommended-latest` read Preact's mutable refs and the diagram handles as React
  state.

## Consequences

- Measured on 2026-10-24 (18 cores):

  | Command                                        | Time                                                                         |
  | ---------------------------------------------- | ---------------------------------------------------------------------------- |
  | `pnpm --filter pulse-cockpit test`             | 16.5 s (84 files, 1 109 unit and browser tests, coverage, the bundle budget) |
  | `pnpm --filter pulse-cockpit run typecheck`    | 11.3 s (the union, then the seven layer configs)                             |
  | `pnpm --filter pulse-cockpit run lint`         | 14.7 s                                                                       |
  | `pnpm --filter pulse-cockpit exec stryker run` | 11.5 min full (11 559 mutants); one file (`--mutate <file>`) about 6 s       |
  | `pnpm --filter pulse-cockpit run test:engines` | 13.5 s per image (measured in the original repository)                       |

- A pull request runs no mutation check (owner decision, 2026-10-24). Locally,
  `stryker run --mutate <file>` mutates single files and fails below `thresholds.break`. CI
  mutates nightly in
  `.github/workflows/mutation-nightly.yml`, one leg per package with a `stryker.config.json`,
  this one included.
- Thresholds sit just below the measured baseline: coverage lines/statements/functions/
  branches globally 93/93/94/83, contract 97/97/98/90, core 98/98/98/90, the C7 adapter
  92/92/98/80, the model adapter 98/98/98/88, webview 78/78/78/68; mutation score 79
  (baseline 80.80 on 2026-10-24: contract 74.4, core 83.1, the C7 adapter 82.1, the model
  adapter 76.0); bundle 200 000 B, raised from 108 000 B by the maintainer on 2026-10-22 for
  the back navigation and the drilldown button (108.2 kB), with room for the next UI
  features.
- The host layer (`apps/vscode/src/host`) is excluded from coverage and mutation testing
  (VS Code glue); its pure modules are unit-tested, the glue is covered by the smoke and e2e
  tests.
- Not measured: the webview's mutation score (browser tests are too slow per mutant)
  and the scripts under `apps/vscode/scripts/`.
