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
  dialect family c7), the profile format, `@miragon/pulse-profile` (`packages/core/profile`), and
  the transport, `@miragon/pulse-http` (`packages/core/http`), are devDependencies that tsdown
  bundles, with the root-cause rule c7-core takes from the engine family's core
  (`@miragon/pulse-engine-core`, c7-core's one dependency); everything else that ships is the code
  in `apps/cli/src/`. The built bundle imports only
  commander and Node built-ins, and stays within its size budget
  (`scripts/published-imports.test.mjs` reads `apps/cli/dist` and the ceiling in
  `apps/cli/test/__golden__/bundle-budget.json`, which `pnpm lint:ratchets` holds shrink-only:
  growth needs a `Ratchet-Exception:` trailer that says why). The npm bundle leaves out every
  comment of the sources but legal ones and is not minified (owner decision 2026-11-12), so a
  comment that is not a legal one costs the budget nothing; the line rolldown writes where each
  module starts (`// src/errors.ts`) stays, so a new source file costs one. The standalone
  bundle keeps the same comments (`apps/cli/scripts/bundles.test.ts` holds both).

## Layers

The `cli-*` rules of the root `.dependency-cruiser.cjs` enforce them; `pnpm lint:architecture`
cruises `apps/cli/src`, `pnpm lint:architecture:cli` its `scripts/` and `test/`.

| Path                        | Holds                                                                    |
| --------------------------- | ------------------------------------------------------------------------ |
| `apps/cli/src/bin/`         | The entry point and the Node runtime (`createNodeRuntime`)               |
| `apps/cli/src/cli/`         | commander wiring and the utility commands; the only layer with commander |
| `apps/cli/src/operation/`   | Input building, guards, requests, execution, paging                      |
| `apps/cli/src/workflow/`    | The workflow commands, pure: c7-core's bindings, its CLI text, waiting   |
| `apps/cli/src/engine-port/` | c7-core's port plus `call`, `preview`, `route`: types only               |
| `apps/cli/src/engines/`     | One adapter per engine, all on the one generated catalog                 |
| `apps/cli/src/api/`         | One folder per engine API; only the adapters use one                     |
| `apps/cli/src/docs/`        | The guide, `describe`, examples: the texts agents read                   |
| `apps/cli/src/catalog/`     | Catalog access (`loadCatalog`), schemas, body validation                 |
| `apps/cli/src/config/`      | Config resolution, profiles, project files; the profile format's wording |
| `apps/cli/src/auth/`        | Auth providers around the transport's credential: Basic, bearer, OAuth   |
| `apps/cli/src/http/`        | The client over `@miragon/pulse-http` and the wording of what fails      |
| `apps/cli/src/output/`      | JSON, tables, field projection, errors, secret masking                   |
| `apps/cli/scripts/`         | The catalog generator (`renderCatalog`), the licence list, the packaging |
| `apps/cli/test/`            | Fakes (`apps/cli/test/support/`), engine suites                          |

No cycle, a type-only one included. The pure layers import no Node built-in (WebCrypto and the
timers are globals). Only the `auth login` command reaches the interactive login (loopback
server, browser), so no other command can ever wait for a person. The CLI imports no workspace
package but `@miragon/pulse-c7-core`, and that only from `apps/cli/src/workflow/`,
`apps/cli/src/engine-port/`, the two operation modules that apply its engine REST rules,
`apps/cli/src/operation/dates.ts` (the `UTC_WITHOUT_OFFSET` date reading) and
`apps/cli/src/operation/variables.ts` (`autoTypedValue`), and the mapping of HTTP errors,
`apps/cli/src/http/errors.ts` (the wrong-root rule `isUnknownEndpoint`) (tests anywhere), the
profile format, `@miragon/pulse-profile`, only from `apps/cli/src/config/` (`CLI_BUNDLES` and
`profile-consumers` in the root `.dependency-cruiser.cjs`), and the transport,
`@miragon/pulse-http`, only from `apps/cli/src/http/`, `apps/cli/src/auth/` and
`apps/cli/src/operation/` (`CLI_BUNDLES` and `http-consumers`), and nothing of the MCP or UI stack.
The packages return data (next steps, error reasons, a profile's problems, a failure's reason);
`next-text.ts` and `error-text.ts` in `apps/cli/src/workflow/`,
`apps/cli/src/config/profile-problems.ts` and `apps/cli/src/http/client.ts` and `errors.ts` word
them as the CLI prints them.

Every engine request goes out through the transport (`createClient` and `send` in
`apps/cli/src/http/client.ts`, over the connection `clientOf` in `apps/cli/src/cli/session.ts`
maps the resolved configuration onto): the deadline to the last byte, no redirect, no cap on an
answer, exactly one retry after a 401 when the credential renewed, and the request's secrets
(the password, the Basic value, the token, the secret extra headers) masked in what the engine
sends back; the CLI cuts an engine's message after 500 characters. An auth provider wraps the
transport's credential (`AuthProvider.credential`: Basic from the package, a bearer token whose
source is the CLI's) and keeps the CLI's preview and hints. The workflow commands send through
c7-core's `routedTransport`, whose route table is the catalog. A `--verbose` trace shows the
secrets only with `--show-secrets`: the CLI is the one caller that sets the transport's
`revealSecrets` (`scripts/trace-secrets.test.mjs`). The OAuth client protocol is the
transport's too, `@miragon/pulse-http/oauth`: discovery, PKCE, the callback's check, the token and
revocation requests on the same wire (the client's own credentials read `Basic ***` in a trace,
also with `--show-secrets`), and the renewal of a login (`refreshingTokens` over the token cache,
which `apps/cli/src/auth/oauth/store.ts` maps onto the package's `TokenStore`) and of a token
command's token (`commandTokens`), both by the shared policy `EXPIRY`; whether a cached token or a
bearer JWT has expired and whether a refresh token can renew it are the package's rules too
(`isExpired`, `canRefresh`), the CLI's own only the 30 s of clock skew before `TOKEN_EXPIRED`
(`apps/cli/src/auth/jwt.ts`). The CLI keeps the token cache files (their format unchanged) and
their lock, the loopback login and every message. The engine family's core,
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

The format of `.pulse.json` and of the user's config file is Pulse's profile format,
`@miragon/pulse-profile`: its parser, its JSON Schema (`schema/pulse.schema.json` in the package,
the `$schema` URL on unpkg) and its shared fixtures. The config layer is thin over it:
`apps/cli/src/config/profile-file.ts` reads a file under the credential policy of where it comes
from (`env-or-literal` for the user's config file, `none` for a project file, so a project file
names neither a secret nor a variable and no resolver reads a variable a repository chose; read
under `none`, its profiles keep no key of either) and maps the verdicts onto the config types; a
refused profile stays in the file as it stands (an edit keeps it, but never writes back a name or
a key the file holds twice, `settledTwice`) and fails only the command that uses it, worded by
`apps/cli/src/config/profile-problems.ts` with the CLI's way out (a `pulse config` command, a
flag, a `PULSE_CLI_*` variable). `apps/cli/src/config/profile-fixtures.test.ts` runs every
fixture of `@miragon/pulse-profile/testing` through both readers and resolves each profile the
format takes. A change to what a profile may hold changes the package, its schema and a fixture
in the same commit; the CLI and the runtime view's host kit, which Pulse for VS Code and Pulse for
Orca read their project files through, follow in theirs. The lookup fails (CONFIG) at a
directory that holds the project file only under its former name (`FORMER_PROJECT_FILE` in
`apps/cli/src/config/project.ts`, the one place of its code that names it) with a hint to rename
it, so a command never runs with the user's own default where the repository meant its profiles.

## Catalogs

Regenerate with `pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog`; the package has
no `generate` script, so turbo's cached `generate` task never replays a stale catalog. Never edit
`apps/cli/src/generated/` by hand: change the spec patches
(`packages/connectors/c7/c7-core/spec/patches.json`) or the generator. The generator reads the
patched spec and the route table c7-core's `generate` writes as files, never as an import: a
patch or an effect (the rule of `packages/connectors/c7/c7-core/scripts/effects.ts`) changes
there, then c7-core's `generate` (`pnpm build` runs it) and `catalog` run in that order.
`apps/cli/scripts/catalog/render.test.ts` fails on a stale catalog.

## Licences

The npm package, the image (in `/usr/share/doc/pulse-cli`), the Homebrew formula and the `.tar.xz`
archives of the macOS and Linux executables ship `apps/cli/LICENSE` and
`apps/cli/THIRD_PARTY_LICENSES.txt` (owner decision 2026-11-12): the works of others the two
bundles hold, each with its licence and notice files as it ships them. Like the catalog,
the file is generated and checked in:
`pnpm --fail-if-no-match --filter @miragon/pulse-cli third-party-licenses` writes it from the module
graphs tsdown builds of both bundles' configs without writing a file (`apps/cli/scripts/licenses/`),
and `apps/cli/scripts/third-party-licenses.test.ts` fails while it misses a bundled work, lists
one no bundle holds or differs otherwise (a version, a text), so a bump of commander or tsdown
(rolldown) regenerates it in its pull request. Every module is a package's under node_modules,
a virtual module of the bundler or a file of this repository, Miragon's under MIT like each of
Pulse's packages in a bundle; anything else fails the generator, and so does a work without a
licence file or one that keeps its licence texts in a folder. A module of the CLI that carries
another work's text names that work in `CLI_LAYOUT` of `apps/cli/scripts/licenses/bundles.ts`,
as a new virtual module does: the catalog carries the Operaton spec's descriptions (Apache-2.0,
its `LICENSE` and `NOTICE` in `packages/connectors/c7/c7-core/spec/`), and the file says that
Miragon changed them (section 4(b)). The test fails on a module of the bundles that carries a
whole text of that spec and does not name it; another work's text is review knowledge. The
archives also hold `NODE_LICENSE`, the licence of the Node.js an executable embeds: `build:exe`
keeps the `LICENSE` of the node that runs it as `apps/cli/build/node-license/<executable>`, and
`apps/cli/scripts/pack-binary.sh` (which `ci.yml` runs as the release does) packs it. The image
keeps the base image's `/nodejs/LICENSE`, which `ci.yml`'s image job checks. The licence fields
(npm, the image label, the formula) name the CLI's own, MIT.

The raw executables a release attaches beside the archives, the Windows one included, get the
same three files as release assets of their own (owner decision 2026-11-12): `pulse-cli-LICENSE`,
`pulse-cli-THIRD_PARTY_LICENSES.txt` and `pulse-cli-NODE_LICENSE`. `publish-cli.yml`'s licences
job writes them with `apps/cli/scripts/release-licenses.sh` from each target's kept `LICENSE`
(an artifact of each binary job), and the assets job lists them in `pulse-cli-SHA256SUMS`,
attests and uploads them like every asset. The release attaches one Node.js licence, which the
five share: each target takes the newest Node.js 24 when it builds, and the script fails while
their texts differ (carriage returns aside: the Windows build of Node.js ships its `LICENSE` with
CRLF line ends), naming the executables of each text. It compares texts, not versions: patch
releases of Node.js mostly share one text. `ci.yml`'s "CLI binary" legs check that each keeps one,
the Windows one included. `apps/cli/scripts/release-licenses.test.ts` runs the script, also with
planted licences that differ, miss or belong to no executable, and holds `publish-cli.yml` to the
way of the licences from the binary jobs through the script to the upload, its count and its
upload glob, each link with a planted break.

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
- `apps/cli/src/http/transport-cases.test.ts` runs every case of the transport's
  `TRANSPORT_CASES` the CLI can express through its wiring (the variables, the provider, the
  client, the generated command) against the package's loopback engine, and names the cases it
  leaves out and why.
- The Testcontainers suites (`test:engines`, Docker, build first) run the built CLI against
  Operaton and CIB seven (Camunda 7's image left Docker Hub in November 2026), with Basic auth,
  behind Keycloak and an Envoy gateway, and pack the tarball.
- No mutation testing of the CLI itself (owner decision, 2026-11-04): the repository mutates
  only `@miragon/pulse-c7-core`, which holds the workflow rules the CLI bundles,
  `@miragon/pulse-http`, the transport it bundles (owner decision 2026-11-08), the
  root-cause, value-kind and move-reason rules of `@miragon/pulse-engine-core`, whose root-cause
  rule the CLI bundles through c7-core (owner decision 2026-11-09), and `@miragon/pulse-profile`,
  the profile format it bundles (owner decision 2026-11-07).
- Coverage floors in `apps/cli/vitest.config.ts` only rise.

## The command and its second name

The command is `pulse`: usage, help, the guide, `describe`, the next steps and the hints print it,
and the docs and the skill say it. `CLI_NAME` (`apps/cli/src/util.ts`) names the program for
commander, the examples and the usage lines; the guide, the next steps and the hints spell `pulse`
in their text, and the product-name test keeps them free of the second name. `pulse-cli` is a
second `bin` of the same bundle, so scripts that call it work, and `npx @miragon/pulse-cli` runs
the bin named like the package. Names that are no command keep their spelling: the npm package,
`PULSE_CLI_*`, the config directory, the image, the release assets, the bundle file, the
Homebrew formula, the plugin and its skill, and the worker id and deployment name and source the
engine stores.
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
