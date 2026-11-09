# CLAUDE.md (apps/cli)

Rules for agents working on the CLI, the workspace package `@miragon/pulse-cli`. The root
`CLAUDE.md` holds the repository's gates and the package rules; its architecture invariants are
written for the MCP server, so this file holds the CLI's own. The pages for people are in
`docs/cli/`, the development guide in `docs/cli/development.md`.

## What the CLI is

- One command per REST operation of a Camunda 7 engine (Operaton, CIB seven, Camunda 7), plus
  the workflow commands (inspect, wait, advance, retry, deploy, status). The commands are data:
  `apps/cli/src/generated/catalog.json`, generated from the one Camunda 7 REST spec of the c7
  family, `packages/connectors/c7/c7-core/spec/api.json` with its patches applied (as c7-client's
  SDK reads it), and from c7-core's route table, each operation's effect, serves every engine.
  Command registration, help, `describe`, input building and body validation all read the same
  catalog.
- AI first: it never asks a question, previews every write (`--dry-run`), needs `--yes` to
  delete, has a read-only mode, and writes its answers as JSON and its errors as one JSON line on
  stderr with a documented exit code. A change to any of that is a change to the docs.
- One runtime dependency, commander. The workflow domain and engine REST rules,
  `@miragon/pulse-c7-core` (`packages/connectors/c7/c7-core`, the core of the Camunda 7 REST
  dialect family c7), are a devDependency that tsdown bundles, with the root-cause rule c7-core
  takes from the engine family's core (`@miragon/pulse-engine-core`, c7-core's one dependency);
  everything else that ships is the code in `apps/cli/src/`. The built bundle imports only
  commander and Node built-ins, and stays within its size budget
  (`scripts/published-imports.test.mjs` reads `apps/cli/dist` and the ceiling in
  `apps/cli/test/__golden__/bundle-budget.json`, which `pnpm lint:ratchets` holds shrink-only:
  growth needs a `Ratchet-Exception:` trailer that says why).

## Layers

The `cli-*` rules of the root `.dependency-cruiser.cjs` enforce them; `pnpm lint:architecture`
cruises `apps/cli/src`, `pnpm lint:architecture:cli` its `scripts/` and `test/`.

| Path                        | Holds                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| `apps/cli/src/bin/`         | The entry point and the Node runtime (`createNodeRuntime`)                 |
| `apps/cli/src/cli/`         | commander wiring and the utility commands; the only layer with commander   |
| `apps/cli/src/operation/`   | Input building, guards, requests, execution, paging                        |
| `apps/cli/src/workflow/`    | The workflow commands, pure: c7-core's bindings, its CLI text, waiting     |
| `apps/cli/src/engine-port/` | c7-core's port plus `call`, `preview`, `route`: types only                 |
| `apps/cli/src/engines/`     | One adapter per engine, all on the one generated catalog                   |
| `apps/cli/src/api/`         | One folder per engine API; only the adapters use one                       |
| `apps/cli/src/docs/`        | The guide, `describe`, examples: the texts agents read                     |
| `apps/cli/src/catalog/`     | Catalog access (`loadCatalog`), schemas, body validation                   |
| `apps/cli/src/config/`      | Config resolution, profiles, project files                                 |
| `apps/cli/src/auth/`        | Auth providers: Basic, bearer, token commands, OAuth                       |
| `apps/cli/src/http/`        | The fetch client and the mapping of HTTP errors                            |
| `apps/cli/src/output/`      | JSON, tables, field projection, errors, secret masking                     |
| `apps/cli/scripts/`         | The catalog generator (`renderCatalog`), the executable build              |
| `apps/cli/schema/`          | The JSON Schema of the project file, shipped in the npm package            |
| `apps/cli/test/`            | Fakes (`apps/cli/test/support/`), the project file fixtures, engine suites |

No cycle, a type-only one included. The pure layers import no Node built-in (WebCrypto and the
timers are globals). Only the `auth login` command reaches the interactive login (loopback
server, browser), so no other command can ever wait for a person. The CLI imports no workspace
package but `@miragon/pulse-c7-core`, and that only from `apps/cli/src/workflow/`,
`apps/cli/src/engine-port/` and the two operation modules that apply its engine REST rules,
`apps/cli/src/operation/dates.ts` (the `UTC_WITHOUT_OFFSET` date reading) and
`apps/cli/src/operation/variables.ts` (`autoTypedValue`) (tests anywhere), and nothing of the MCP
or UI stack. The package
returns data (next steps, error reasons); `next-text.ts` and `error-text.ts` in
`apps/cli/src/workflow/` word them as the CLI prints them. The CLI's rules also admit the profile
format, `@miragon/pulse-profile`, in `apps/cli/src/config/` (`CLI_BUNDLES` and
`profile-consumers` in the root `.dependency-cruiser.cjs`), for the config layer to read the
profiles with, and the transport, `@miragon/pulse-http`, in `apps/cli/src/http/`,
`apps/cli/src/auth/` and `apps/cli/src/operation/` (`CLI_BUNDLES` and `http-consumers`), for the
requests to go out through it; neither is used yet. The engine family's core,
`@miragon/pulse-engine-core`, the contract every dialect implements, is not the CLI's to import
until it serves a second dialect: it reaches the engine through c7-core, a job's root cause
included (`causeOf`, over engine-core's `RootCauses`), and a direct import is an admission
decision in review (`engine-core-consumers`).

## Budgets

The CLI's blocks in the root `eslint.config.mjs` (which also hold
`packages/connectors/c7/c7-core`, `packages/core/profile` and `packages/core/http`, the
packages it may bundle)
are stricter than the global ones and only tighten: the strict type-checked rules of
typescript-eslint, complexity 10, 300 effective lines per file for shipped code and scripts, 60
lines per function, 20 statements, depth 3, 4 parameters. Every test file stays within 400
lines, also under `apps/cli/test/`: a test that grows splits along its describes into a sibling
file, its shared helpers go to `apps/cli/test/support/`, and split files never import each other.
An engine suite keeps one container topology per file and registers its tests from modules
beside it.

## The project file schema

The CLI owns the format of `.pulse-cli.json`: `apps/cli/schema/project-file.schema.json` (JSON
Schema draft-07, shipped in the npm package, `$id` on unpkg) describes exactly what
`parseProjectFile` accepts. The shared fixtures in `apps/cli/test/fixtures/project-file/` (one
file each: the file and the CLI's verdict, the error or each profile as it resolves) hold both:
`apps/cli/src/config/project-schema.test.ts` gives every fixture to the parser and the schema and
resolves each profile, `apps/cli/src/config/project-schema-boundaries.test.ts` checks the edges
both ways, as a table and as properties, the refused header names drawn from the CLI's own lists.
The CLI owns the files and its verdict; Pulse for VS Code owns what it makes of them
(`apps/vscode/test/host/project-file-fixtures.expected.json`), and its
`apps/vscode/test/host/project-file-fixtures.test.ts` reads the fixtures as files. A change to
what a project file may hold changes the parser, the schema and a fixture in the same commit; a
new fixture needs an entry in the extension's expectations too. The one rule JSON Schema cannot
express (a defaultProfile names one of the file's profiles) is checked next to the schema in
`apps/cli/test/support/project-schema.ts`. An invalid fixture holds one violation, so the schema
has to catch each on its own.

## Catalogs

Regenerate with `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`; the package has
no `generate` script, so turbo's cached `generate` task never replays a stale catalog. Never edit
`apps/cli/src/generated/` by hand: change the spec patches
(`packages/connectors/c7/c7-core/spec/patches.json`) or the generator. The generator reads the
patched spec and the route table c7-core's `generate` writes as files, never as an import: a
patch or an effect (the rule of `packages/connectors/c7/c7-core/scripts/effects.ts`) changes
there, then c7-core's `generate` (`pnpm build` runs it) and `catalog` run in that order.
`apps/cli/scripts/catalog/render.test.ts` fails on a stale catalog.

## Tests

- While you iterate, run the files you touch with `pnpm test:one apps/cli/src/<name>.test.ts`
  (coverage off, c7-core built first): run alone, a file fails the floors, since
  `coverage.include` counts every file it does not load. Then
  `pnpm exec turbo run typecheck test lint --filter=@miragon/pulse-cli`; `pnpm check` is the bar.
- Unit and fast-check property tests drive the CLI through `fakeRuntime`, an in-memory runtime;
  only the tests of `apps/cli/src/bin/` and the goldens touch the real system. Every CLI line of a `sh` block in `apps/cli/README.md` and `docs/cli/` runs
  against a fake engine (`DOC_PAGES`): a documented command line that fails is a failing test.
- Goldens pin what `pulse status` and `pulse inspect` print and what the CLI writes for the
  engine failures their README lists, byte for byte (`apps/cli/src/cli/goldens/`, the files in
  `apps/cli/test/__golden__/`, the cases in `apps/cli/test/__golden__/error-paths/README.md`).
  They run `fakeRuntime` with the real `fetch` against loopback engines on real sockets, and
  `dns-failure` asks the system resolver. An intended change runs
  `pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update` (refused in CI) and
  commits the diff; never edit a golden by hand.
- The Testcontainers suites (`test:engines`, Docker, build first) run the built CLI against
  Operaton and CIB seven (Camunda 7's image left Docker Hub in November 2026), with Basic auth,
  behind Keycloak and an Envoy gateway, and pack the tarball.
- No mutation testing of the CLI itself (owner decision, 2026-11-04): the repository mutates
  only `@miragon/pulse-c7-core`, which holds the workflow rules the CLI bundles,
  `@miragon/pulse-http`, the transport it may bundle (owner decision 2026-11-08), and the
  root-cause, value-kind and move-reason rules of `@miragon/pulse-engine-core`, whose root-cause
  rule the CLI bundles through c7-core (owner decision 2026-11-09).
- Coverage floors in `apps/cli/vitest.config.ts` only rise.

## The command and its second name

The command is `pulse`: usage, help, the guide, `describe`, the next steps and the hints print it,
and the docs and the skill say it. `CLI_NAME` (`apps/cli/src/util.ts`) names the program for
commander, the examples and the usage lines; the guide, the next steps and the hints spell `pulse`
in their text, and the product-name test keeps them free of the second name. `pulse-cli` is a
second `bin` of the same bundle, so scripts that call it work, and `npx @miragon/pulse-cli` runs
the bin named like the package. Names that are no command keep their spelling: the npm package,
`PULSE_CLI_*`, `.pulse-cli.json`, the config directory, the image, the release assets, the
bundle file, the Homebrew formula, the plugin and its skill, and the worker id and deployment
name and source the engine stores.
`apps/cli/src/bin/bin-names.test.ts` holds the two bins to one entry,
`apps/cli/src/product-name.test.ts` the shipped text to `pulse` outside its named exceptions, and
the docs tests key on `CLI_NAME` and fail on a code block that runs `pulse-cli`, which they would
skip.

## Docs move with the code

A change to a command, an option, an output or an error changes, in the same commit, the guide
and help texts in `apps/cli/src/docs/`, the page in `docs/cli/` and, where it applies, the skill
in `apps/cli/skills/pulse-cli/SKILL.md`. Each page in `docs/cli/` has a line budget in
`scripts/docs-refs.test.mjs`. The topics of `pulse guide <topic>` are pages
of `docs/cli/`, bundled as text (`GUIDE_TOPICS`): such a page is read by agents offline too.
