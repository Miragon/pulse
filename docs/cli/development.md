# Development

The CLI lives in `apps/cli` of the Pulse repository, the workspace package `@miragon/pulse-cli`.
It goes through the repository's gates like every other package; this page covers what is
particular to it. The rules for agents that change it are in `apps/cli/CLAUDE.md`.

## Commands

Run them from the repository root. `pnpm build && pnpm typecheck && pnpm test && pnpm lint` is
the bar for every change; the CLI's own scripts run one part of it:

```sh
pnpm install --frozen-lockfile
pnpm --fail-if-no-match --filter @miragon/pulse-cli build
pnpm --fail-if-no-match --filter @miragon/pulse-cli test
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog
pnpm --fail-if-no-match --filter @miragon/pulse-cli test:engines
pnpm --fail-if-no-match --filter @miragon/pulse-cli test:mutation
```

`test:engines` runs the Testcontainers suites against the built CLI (Docker or Podman, `build`
first). `test:mutation` is a full Stryker run that mutates the working tree in place: leave
`apps/cli` alone while it runs.

## Standalone executable and container image

Both start from one bundle, `build:standalone` (`apps/cli/tsdown.standalone.config.ts`): a
CommonJS file with commander inlined, the only main script format a Node.js 24 single executable
application runs.

- `build:exe` (`apps/cli/scripts/build-exe.ts`) writes the preparation blob with
  `node --experimental-sea-config` (with V8 code cache), copies the running `node` binary, injects
  the blob with [postject](https://github.com/nodejs/postject) and on macOS signs the result ad
  hoc. It needs Node.js 24 (the repository's `.nvmrc` says 22) from an official build (nodejs.org,
  nvm, fnm, Volta, setup-node): the script refuses a Homebrew or distribution build, whose shared
  libraries the copy would need on every machine. The code cache only works on the platform that
  built it, so every target builds on its own runner.
- `apps/cli/Dockerfile` copies the bundle onto distroless Node.js 24; the build runs nothing on the
  target platform, so a multi-platform build needs no emulation.
- `apps/cli/scripts/smoke-test.sh <command...>` checks a packaging without an engine (version,
  help, catalog, dry-run, stdin, a network error).

```sh
pnpm --fail-if-no-match --filter @miragon/pulse-cli build:standalone
pnpm --fail-if-no-match --filter @miragon/pulse-cli build:exe
docker build -t pulse-cli apps/cli && apps/cli/scripts/smoke-test.sh docker run --rm -i pulse-cli
```

## Catalog generation

The command surface is data, not hand-written code:

1. `apps/cli/spec/camunda7-rest/api.json` is the vendored OpenAPI spec of the Camunda 7 /
   Operaton REST API. `apps/cli/spec/camunda7-rest/patches.json` corrects it with RFC 6902 JSON
   patches (each with a `test` guard and a `reason`); `apps/cli/spec/engines/` holds one file of
   differences per engine, today empty.
2. `catalog` (`apps/cli/scripts/generate-catalog.ts`, `apps/cli/scripts/catalog`) turns it into one
   catalog per engine in `apps/cli/src/generated/`: operations with group, command name, aliases,
   effect, parameters, body and response descriptions, plus the referenced schemas. Naming
   overrides live in `apps/cli/scripts/catalog/overrides.ts`, summaries in
   `apps/cli/scripts/catalog/summaries.ts` and `apps/cli/scripts/catalog/summary-overrides.ts`,
   effects in `apps/cli/scripts/catalog/effects.ts`. The generator fails on unresolvable `$ref`s,
   unknown HTTP methods and command names or summaries that are not unique in their group.
3. The catalogs are committed; `apps/cli/scripts/catalog/render.test.ts` fails on a stale one. At
   runtime the same catalog drives registration, help, `describe`, input building and body
   validation, so help, docs and behavior cannot drift apart.

## Architecture

```text
src/bin/        entry point and the Node runtime (I/O, timers, loopback server, browser, lock file, shell)
src/cli/        commander wiring and the utility commands; the only layer that imports commander
src/operation/  input building, variables, dates, guards, request building, execution, pagination
src/workflow/   the workflow commands: engine access, instance views, waiting, plans (pure)
src/engine-port/ what the CLI needs from an engine: EnginePort and EngineAdapter (types only)
src/engines/    one adapter per engine (operaton, cibseven, camunda7) and the list of them (pure)
src/api/        one folder per engine API; camunda7-rest builds catalog and port for the adapters (pure)
src/docs/       commands, describe, examples, workflow docs, completion and the agent guide (pure)
src/catalog/    catalog access, schema helpers, body validation (pure)
src/config/     config resolution and profile editing (pure), file store, project files
src/auth/       auth providers (none, basic, bearer with JWT expiry, token commands, OAuth; pure)
src/http/       fetch based HTTP client and error mapping
src/output/     JSON, tables, field projection, errors, secret masking (pure)
scripts/        catalog generator, standalone executable build, packaging smoke test
test/           fakes for unit tests, Testcontainers engine suites
```

The overview with diagrams is in [Architecture](architecture.md), the decisions in
[Architecture decisions](adr/). The `cli-*` rules of `.dependency-cruiser.cjs` hold the layering:
no cycle (a type-only one included), only `src/bin` imports `src/cli`, only `src/cli` imports
commander, the pure layers import no Node built-in, `workflow` knows engines only through
`src/engine-port`, only the adapters import `src/api`, only the `auth login` command reaches the
interactive login, and the generated catalogs are read only by `src/catalog/catalog.ts` and the
adapters, each adapter its own. `pnpm lint:architecture` cruises `apps/cli/src`,
`pnpm lint:architecture:cli` its `scripts/` and `test/`.

## Quality gates

- **TypeScript** strict (`apps/cli/tsconfig.json`), **ESLint** with the CLI's blocks of
  `eslint.config.mjs`: typescript-eslint `strictTypeChecked`, complexity 10, 300 lines per file
  (400 for tests), 60 lines per function, 20 statements, depth 3, 4 parameters. **Prettier** and
  **knip** as everywhere in the repository.
- **vitest** with v8 coverage floors of 90 % for lines, statements and functions and 85 % for
  branches (`apps/cli/vitest.config.ts`); the floors only rise.
- **fast-check** property tests for naming, patches, variable parsing, dates, query building,
  projection, table width, config and auth precedence, PKCE, token expiry, the token cache, body
  validation and secret masking.
- **StrykerJS** over the logic layers and the catalog generator without its data tables
  (`apps/cli/stryker.config.json`, break 92): a pull request's changed files run through
  `pnpm test:mutation`, the nightly run covers the whole list.
- **Testcontainers** suites against the three engines, with and without Basic auth, behind
  Keycloak and an Envoy JWT gateway for OAuth, through the workflow commands, plus a test of the
  packed tarball. CI runs them, the packaging smoke tests and `claude plugin validate --strict` on
  every pull request that touches the CLI. The plugin evals in
  `apps/cli/skills/pulse-cli/evals/` call the model on your account and run locally.

## Ground rules

- Docs move with the code: a change to a command, an option or an output also changes the
  guide in `apps/cli/src/docs/`, the page in `docs/cli/` and, where it applies, the skill.
- Documented commands are tested: the unit tests run every CLI line of a ` ```sh ` block in
  `apps/cli/README.md` and in `docs/cli/` against a fake engine. Write such blocks without a `$`
  prompt, and put transcripts with output into ` ```text ` blocks.
- The catalog is generated: change the spec patches or the generator and run `catalog`; never
  edit a file in `apps/cli/src/generated/` by hand.
- Commits are conventional, with the scope `cli`: the CLI is released with the rest of the
  repository, and release-please writes the release notes from the commit titles.
