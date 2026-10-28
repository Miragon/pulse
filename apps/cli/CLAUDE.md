# CLAUDE.md (apps/cli)

Rules for agents working on the CLI, the workspace package `@miragon/pulse-cli`. The root
`CLAUDE.md` holds the repository's gates and the package rules; its architecture invariants are
written for the MCP server, so this file holds the CLI's own. The pages for people are in
`docs/cli/`, the development guide in `docs/cli/development.md`.

## What the CLI is

- One command per REST operation of a Camunda 7 engine (Operaton, CIB seven, Camunda 7), plus
  the workflow commands (inspect, wait, advance, retry, deploy, status). The commands are data:
  `apps/cli/src/generated/catalog.json`, generated from the vendored OpenAPI spec in
  `apps/cli/spec/`, serves every engine. Command registration, help, `describe`, input building and body
  validation all read the same catalog.
- AI first: it never asks a question, previews every write (`--dry-run`), needs `--yes` to
  delete, has a read-only mode, and writes its answers as JSON and its errors as one JSON line on
  stderr with a documented exit code. A change to any of that is a change to the docs.
- One runtime dependency, commander. Everything else that ships is the code in
  `apps/cli/src/`, which imports only commander and Node built-ins (published-imports checks it).

## Layers

The `cli-*` rules of the root `.dependency-cruiser.cjs` enforce them; `pnpm lint:architecture`
cruises `apps/cli/src`, `pnpm lint:architecture:cli` its `scripts/` and `test/`.

| Path                        | Holds                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| `apps/cli/src/bin/`         | The entry point and the Node runtime (`createNodeRuntime`)                |
| `apps/cli/src/cli/`         | commander wiring and the utility commands; the only layer with commander  |
| `apps/cli/src/operation/`   | Input building, guards, requests, execution, paging                       |
| `apps/cli/src/workflow/`    | The workflow commands, pure, on the engine port only                      |
| `apps/cli/src/engine-port/` | `EnginePort` and `EngineAdapter`: types only                              |
| `apps/cli/src/engines/`     | One adapter per engine, all on the one generated catalog                  |
| `apps/cli/src/api/`         | One folder per engine API; only the adapters use one                      |
| `apps/cli/src/docs/`        | The guide, `describe`, examples, completion: the texts agents read        |
| `apps/cli/src/catalog/`     | Catalog access (`loadCatalog`), schemas, body validation                  |
| `apps/cli/src/config/`      | Config resolution, profiles, project files                                |
| `apps/cli/src/auth/`        | Auth providers: Basic, bearer, token commands, OAuth                      |
| `apps/cli/src/http/`        | The fetch client and the mapping of HTTP errors                           |
| `apps/cli/src/output/`      | JSON, tables, field projection, errors, secret masking                    |
| `apps/cli/scripts/`         | The catalog generator (`renderCatalog`), the executable build             |
| `apps/cli/test/`            | Fakes for the unit tests (`apps/cli/test/support/`) and the engine suites |

No cycle, a type-only one included. The pure layers import no Node built-in (WebCrypto and the
timers are globals). Only the `auth login` command reaches the interactive login (loopback
server, browser), so no other command can ever wait for a person. From the workspace the CLI may
import only a `-domain` package, and nothing of the MCP or UI stack.

## Budgets

The CLI's blocks in the root `eslint.config.mjs` are stricter than the global ones and only
tighten: the strict type-checked rules of typescript-eslint, complexity 10, 300 effective lines
per file for shipped code and scripts, 60 lines per function, 20 statements, depth 3, 4
parameters. Every test file stays within 400 lines, also under `apps/cli/test/`: a test that
grows splits along its describes into a sibling file, its shared helpers go to
`apps/cli/test/support/`, and split files never import each other. An engine suite keeps one
container topology per file and registers its tests from modules beside it.

## Catalogs

Regenerate with `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`; the package has
no `generate` script, so turbo's cached `generate` task never replays a stale catalog. Never edit
`apps/cli/src/generated/` by hand: change the spec patches or the generator.
`apps/cli/scripts/catalog/render.test.ts` fails on a stale catalog.

## Tests and mutation

- Unit and fast-check property tests drive the CLI through `fakeRuntime`, an in-memory runtime;
  only the tests of `apps/cli/src/bin/` touch the real system. Every CLI line of a `sh` block in `apps/cli/README.md` and `docs/cli/` runs
  against a fake engine (`DOC_PAGES`): a documented command line that fails is a failing test.
- The Testcontainers suites (`test:engines`, Docker, build first) run the built CLI against the
  three engines, with Basic auth, behind Keycloak and an Envoy gateway, and pack the tarball.
- `apps/cli/stryker.config.json` mutates the logic layers and the catalog generator (break 92).
  It runs in place, because the tests read `docs/cli/` and `release-please-config.json` from the
  repository root: leave the tree alone during a run. The mutate list only grows.
- Coverage floors in `apps/cli/vitest.config.ts` only rise.

## Names of operate

Up to 0.10.0 the CLI was operate; pulse-cli reads none of its names.

## Docs move with the code

A change to a command, an option, an output or an error changes, in the same commit, the guide
and help texts in `apps/cli/src/docs/`, the page in `docs/cli/` and, where it applies, the skill
in `apps/cli/skills/pulse-cli/SKILL.md`. Each page in `docs/cli/` has a line budget in
`apps/mcp-server-camunda7/test/docs-refs.test.ts`. The topics of `pulse-cli guide <topic>` are pages
of `docs/cli/`, bundled as text (`GUIDE_TOPICS`): such a page is read by agents offline too.
