# Development

## Standalone executable and container image

Both start from one bundle, `npm run build:standalone` (`tsdown.standalone.config.ts`): a CommonJS
file with commander inlined, the only main script format a Node.js 24 single executable
application runs.

- `npm run build:exe` (`scripts/build-exe.ts`) writes the preparation blob with
  `node --experimental-sea-config` (with V8 code cache), copies the running `node` binary, injects
  the blob with [postject](https://github.com/nodejs/postject) and on macOS signs the result ad
  hoc. It embeds the Node.js that runs it, which must be an official build (nodejs.org, nvm, fnm,
  Volta, setup-node): the script refuses a Homebrew or distribution build, whose shared libraries
  the copy would need on every machine. Releases use the newest Node.js 24 (Node.js 25 and later
  need `libatomic` on Linux, which Ubuntu and Debian do not install by default). The code cache
  only works on the platform that built it, so every target builds on its own runner.
- `docker build -t operate .` copies the bundle onto distroless Node.js 24 (`Dockerfile`, digest
  updated by Dependabot); the build runs nothing on the target platform, so a multi-platform
  build (`--platform linux/amd64,linux/arm64`) needs no emulation.
- `scripts/smoke-test.sh <command...>` checks a packaging without an engine (version, help,
  catalog, dry-run, stdin, a network error):

```sh
npm run build:standalone && npm run build:exe
scripts/smoke-test.sh build/bin/operate-macos-arm64
docker build -t operate . && scripts/smoke-test.sh docker run --rm -i operate
OPERATE_IT_BINARY="$PWD/build/bin/operate-macos-arm64" OPERATE_IT_ENGINES=operaton npm run test:integration
```

## Catalog generation

The command surface is data, not hand-written code:

1. `spec/camunda7-rest/api.json` is the vendored OpenAPI spec of the Camunda 7 / Operaton REST
   API.
2. `spec/camunda7-rest/patches.json` corrects it with RFC 6902 JSON patches (each with a `test`
   guard and a `reason`). `spec/engines/<engine>.patches.json` hold the differences of one engine;
   today they are empty.
3. `npm run generate` (`scripts/generate-catalog.ts`, `scripts/catalog/*`) turns it into one
   catalog per engine, `src/generated/catalog.<engine>.json`: operations with group, command name, aliases, effect, parameters,
   body and response descriptions, plus the referenced schemas. Naming overrides live in
   `scripts/catalog/overrides.ts`, summaries in `scripts/catalog/summaries.ts`, effects in
   `scripts/catalog/effects.ts`. The generator fails on unresolvable `$ref`s, unknown HTTP methods
   and command names or summaries that are not unique in their group.
4. The catalogs are committed; `npm run generate:check` (part of `npm run check`) fails when one
   is out of date. A test checks that the catalogs are identical while the engine patches are
   empty; an engine that diverges on purpose leaves that test.

At runtime the same catalog drives command registration, help, `describe`, input building and
body validation, so help, docs and behavior cannot drift apart. Unit tests also run every command
line of the guide, the README and the pages of `docs/` and every example against the CLI, and
parse every query flag of every operation through the real program.

## Architecture

```text
src/bin/        entry point and the Node runtime (I/O, timers, loopback server, browser, lock file, shell)
src/cli/        commander wiring and the utility commands; the only layer that imports commander
src/operation/  input building, variables, dates, guards, request building, execution, pagination
src/workflow/   the workflow commands: engine access, instance views, waiting, plans (pure)
src/engine-port/ what operate needs from an engine: EnginePort and EngineAdapter (types only)
src/engines/    one adapter per engine (operaton, cibseven, camunda7) and the list of them (pure)
src/api/        one folder per engine API; camunda7-rest builds catalog and port for the adapters (pure)
src/docs/       commands, describe, examples, workflow docs, completion and the agent guide (pure)
src/catalog/    catalog access, schema helpers, body validation (pure)
src/config/     config resolution and profile editing (pure), file store, project files
src/auth/       auth providers (none, basic, bearer with JWT expiry, token commands, OAuth; pure)
src/http/       fetch based HTTP client and error mapping
src/output/     JSON, tables, field projection, errors, secret masking (pure)
scripts/        catalog generator, standalone executable build, packaging smoke test
test/           fakes for unit tests, Testcontainers integration tests
```

The overview with diagrams is in [Architecture](architecture.md), the decisions in
[Architecture decisions](adr/).

dependency-cruiser enforces the layering: no cycles or orphans, only `src/bin` imports `src/cli`,
only `src/cli` imports commander and `src/workflow`, the pure layers import no Node builtins, `http`
does not depend on `config`, `cli` or `operation`, `config` does not depend on `auth`, `workflow`
does not depend on `cli`, `config`, `auth` or `bin` and knows engines only through
`src/engine-port`, only the adapters (`src/engines/<name>/adapter.ts`) import `src/api`, adapters
and APIs do not import each other, `src/engine-port` holds types only, only `operate auth login` can reach the
interactive login (loopback server, browser), and the generated catalogs are only read through
`src/catalog/catalog.ts` and the engine adapters, each adapter its own.

## Quality gates

- **TypeScript** strict, **ESLint** with typescript-eslint `strictTypeChecked` and size budgets
  (complexity 10, 300 lines per file, 60 lines per function, 20 statements, depth 3, 4
  parameters), **Prettier**.
- **dependency-cruiser** for the architecture rules, **knip** for unused files, exports and
  dependencies.
- **vitest** with v8 coverage thresholds: at least 90 % of lines, statements and functions and
  85 % of branches.
- **fast-check** property tests for naming, patches, variable parsing, dates, query building,
  projection, table width, config and auth precedence, the Basic auth header, PKCE, token expiry,
  the token cache, body validation and secret masking (also of every OAuth token and secret).
- **StrykerJS** mutation testing of the logic layers (`src/api`, `auth`, `catalog`, `config`,
  `engine-port`, `engines`, `http`, `operation`, `output`, `workflow`, `errors.ts`, `util.ts`) and the catalog generator
  (`scripts/catalog` without its data tables); the CLI wiring (`src/cli`), help and guide texts
  (`src/docs`) and the packaging scripts are left to the command line and integration tests. It
  runs in four parallel shards; on every push to `main` and in the weekly run their combined score
  must reach 92 % (the `mutation score` job). Runs are incremental: each shard restores its
  last result from the Actions cache and re-tests only the mutants whose code or covering tests
  changed. The weekly run and a manual run with `full-mutation` re-test every mutant and refresh
  the result. So does a change to what every test depends on but Stryker's diff does not track:
  the Stryker, vitest or TypeScript configuration, the installed dependencies or the Node major.
  Changes to other files that are neither mutated nor tests (such as `test/support`) are caught by
  the weekly run. On pull requests mutation testing only informs and is no merge criterion: it
  runs incrementally from the result of `main` (which it never writes) and reports the score, with
  a warning below the threshold. A pull request for which `main` has no result, because it changes
  the dependencies (every Dependabot pull request), that configuration or the Node major, skips it
  with a notice; the push to `main` tests the change in full. The release pull request of
  release-please skips it as well: it changes only versions and the changelog. Static mutants (module-level
  constants such as regular expressions) stay in: `ignoreStatic` would save about 40 % of a full
  run, but hide undetected ones.
- **Testcontainers** integration tests against the three engines, with and without Basic auth,
  behind a Keycloak and Envoy JWT gateway for OAuth, through the workflow commands, plus a
  packed-tarball smoke test, on every pull request.
- **Packaging** on every pull request: the linux-x64 standalone executable (smoke test and the
  Operaton suites against it) and the container image for both platforms (smoke test); every
  release smoke tests each executable on its own runner.
- **`claude plugin validate --strict`** for the marketplace, the plugin manifest, its skill and its
  command on every pull request. The plugin evals in `skills/operate/evals/` (does the skill load
  for engine tasks and stay out of unrelated ones) call the model on your account, so they run
  locally: `claude plugin eval skills/operate --no-publish`.
