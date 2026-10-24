# Guardrails

- Status: accepted
- Last reviewed: 2026-10-22

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
of our own, and faster runs.

## Decision

Each rule lives in the tool that can express it. Two commands run them in parallel
(`npm-run-all2`): `npm run verify` for the inner loop, `npm run check` before "done".

| Tool                               | What it guards                                                                                                                                                                                                                                                                                                                                                | Configured in                                                      | Seen to fail                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| TypeScript (`tsc -b`, incremental) | strict types; each package sees only its runtime's globals (no DOM in contract, core and host, no Node in contract, core and webview)                                                                                                                                                                                                                         | `tsconfig*.json`, `packages/*/test/runtime.boundary.ts`            | `DOM` added to the core's `lib` → `Unused '@ts-expect-error' directive` in `apps/vscode/test/core/runtime.boundary.ts`          |
| ESLint                             | no comments (the one rule of our own), no inline disabling, budgets (complexity 10, 300 lines, 60 per function, 4 params, 20 statements); no engine words in contract, core and webview, nor in the extension outside `composition-root.ts` and `connections/`; no `--vscode-*` colours in webview TS and CSS                                                 | `eslint.config.js` (`no-restricted-syntax`, `@eslint/css` for CSS) | `apps/vscode/test/architecture/lint-rules.test.ts` lints probes for each rule                                                            |
| dependency-cruiser                 | closed-world package dependencies, no cycles, engine CLI wrapper self-contained, protocol imports nothing, webview takes the protocol type-only, adapters only via the composition root, BPMN model libraries only in the model adapter, no dev or undeclared dependencies in shipped code, every adapter run by an engine test that uses the conformance kit | `.dependency-cruiser.cjs` (`allowed`, `forbidden`, `required`)     | `apps/vscode/test/architecture/dependency-rules.test.ts` cruises a fixture with one planted violation per rule and expects exactly those |
| knip                               | no dead files, exports or dependencies (with dependency-cruiser this also keeps the contract free of runtime dependencies)                                                                                                                                                                                                                                    | `knip.json`                                                        | —                                                                                                                            |
| Prettier, EditorConfig             | formatting, line endings, final newline                                                                                                                                                                                                                                                                                                                       | `.prettierrc.json`, `.editorconfig`                                | —                                                                                                                            |
| Vitest                             | unit, browser (Chromium) and engine tests; coverage thresholds, global and per package                                                                                                                                                                                                                                                                        | `vitest.config.ts`                                                 | core lines set to 99.9 → `ERROR: Coverage for lines (99.48%) does not meet "packages/core/src/**" threshold (99.9%)`         |
| Stryker                            | mutation score of contract, core, the C7 adapter and the model adapter does not drop                                                                                                                                                                                                                                                                          | `stryker.config.json` (`thresholds.break`)                         | with the score at 76.08, break set to 77 → `Final mutation score 76.08 under breaking threshold 77`, exit 1                  |
| size-limit                         | webview bundle ≤ 200 000 B gzip                                                                                                                                                                                                                                                                                                                               | `.size-limit.json`                                                 | limit set to 100 000 B → `Package size limit has exceeded by 8.22 kB`, exit 1                                                |
| `@vscode/test-cli`, Playwright     | the extension activates and registers every command; the user-facing flows work against a real engine                                                                                                                                                                                                                                                         | `npm run test:smoke`, `npm run test:e2e`                           | —                                                                                                                            |

Error messages are written as instructions to the next agent (what to move where).
Bundling the webview for `platform: 'browser'` already refuses Node built-ins, and
dependency-cruiser refuses `vscode` there, so the bundle needs no content scan.

Behaviour that no tool can express stays in ordinary tests next to the code: overlapping
loads (`core/test/races.test.ts`), the target and write policy
(`extension/test/connections.test.ts`, `writes.test.ts`, `manifest.test.ts`), intent
validation (`protocol-and-problems.test.ts`, `write-texts.test.ts`), the write runner
(`adapter-c7/test/c7-commands.test.ts`), write feedback (`instance-writes.test.ts`) and the
conformance kit with its saboteurs (`contract/test/conformance-kit.test.ts`,
`command-kit.test.ts`).

### Thresholds move one way

Coverage and mutation score only go up, the bundle budget only goes down, tests are not
deleted (deleting one lowers coverage and the mutation score, both gated). A threshold
moves only in a pull request that a human merges; `.github/CODEOWNERS` names one owner
for the whole repository. This replaces the ratchet diff script and the
`guardrail-exception` label. Code owner review is not required in the ruleset of `main`:
with one code owner who also opens the pull requests, it would block every change.

### The ruleset of `main`

As in Miragon's other tool repositories: changes reach `main` only through a pull request, squash-merged
(linear history, signed commits, no force push, no deletion). Required checks are the CI
jobs `check`, the three `conformance (…)` runs, `VS Code smoke` and
`validate-pr-title` (`.github/workflows/pr-title.yml`: the title, and a single commit's
message, follow Conventional Commits). Dependabot opens weekly npm and monthly Actions
updates; patch and minor updates merge on their own once the required checks pass.

### Why these tools

- dependency-cruiser is this repository's ArchUnit. ArchUnitTS writes the same folder
  rules as tests; dependency-cruiser keeps them as configuration with a message per
  rule and also knows what this architecture needs beyond folders: type-only imports
  (webview → protocol), npm dependency kinds and reachability (an adapter without an
  engine test). One tool per rule is enough.
- Stryker runs with its `command` runner: `@stryker-mutator/vitest-runner` 10.0.0 does
  not activate mutants under Vitest 5 (every mutant survived with "0 tests per mutant",
  while the same mutants fail the tests when activated by environment). Switch to the
  vitest runner with `perTest` coverage once it supports Vitest 5; it only reruns the
  tests that cover a mutant and is much faster.
- `pulse/no-comments` stays an inline ESLint rule of a dozen lines: ESLint has no
  core rule that bans every comment, and a plugin dependency for it would cost more
  than those lines.

## Consequences

- Measured on 2026-10-22 (18 cores, warm `node_modules`):

  | Command                 | Before (own scripts, in sequence) | After (tools, in parallel)                            |
  | ----------------------- | --------------------------------- | ----------------------------------------------------- |
  | `npm run verify`        | 8.7 s                             | 3.7 s                                                 |
  | `npm run check`         | 12.4 s                            | 4.3 s (390 unit and browser tests, coverage, bundle)  |
  | `npm run test:mutation` | —                                 | 5–8 min full (about 5 800 mutants), 2–3 s incremental |
  | `npm run test:engine`   | 13.5 s per image                  | unchanged                                             |

- The mutation command runs one Vitest worker without isolation per mutant
  (`--maxWorkers=1 --no-isolate`); with Vitest's default pool, 17 Stryker workers each
  started a full thread pool and the run took 15.7 min. The command runner cannot see
  which test kills which mutant, so an incremental run reuses results when only tests
  changed: run `npm run test:mutation -- --force` after changing tests.
  `npm run test:mutation:delta` (`apps/vscode/scripts/mutation-delta.mjs`) mutates only the lines of
  contract, core and adapter sources added or changed against `origin/main` (Stryker's
  `file:from-to` ranges from `git diff -U0`; a new file is all new lines), with the same
  break threshold; run it locally after logic changes.
- Mutation testing is not part of the pull request checks any more (the maintainer's
  decision with #17): even the delta of #17 (2 195 mutants on its changed lines, 4 622 on
  its whole files) stood at about 40 % after an hour on a hosted runner with 4 cores, so CI
  took longer than the change itself. The workflow `Mutation`
  (`.github/workflows/mutation.yml`) runs the full, incremental run on `main` every night
  at 02:00 UTC and on demand, with one test runner per core (`--concurrency $(nproc)`) and
  180 min; it keys its cached report on the test files and restores the newest older
  report after a test change, so only the affected mutants run again. A failing night is
  fixed by the next pull request. Making the run fast enough for pull requests again is
  open (a Vitest runner that knows which test kills which mutant, sharding).

- Thresholds sit just below the measured baseline: coverage lines/statements/functions/
  branches globally 93/93/94/83, contract 97/97/98/90, core 98/98/98/90, adapter-c7
  92/92/98/80, model-adapter 98/98/98/88, webview 78/78/78/68; mutation score 79 (baseline 79.55 % on 2026-10-22: adapter-c7 79.8, contract 73.3, core 83.4); bundle 200 000 B, raised from 108 000 B by the maintainer on 2026-10-22 for the back navigation and the drilldown button (108.2 kB), with room for the next UI features.
- The extension package is excluded from coverage and mutation testing (VS Code glue);
  its pure modules are unit-tested, the glue is covered by the smoke and e2e tests.
- Not measured: the webview's mutation score (browser tests are too slow per mutant)
  and the scripts under `apps/vscode/scripts/`.
