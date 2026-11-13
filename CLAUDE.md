# CLAUDE.md

Guidance for AI agents working in this repository. Read the repo skill before you add code:
`.claude/skills/add-bpm-feature` (engine tools, queries, widgets).

Each rule below names the gate that enforces it; when a gate fails, its message and source
carry the details. A rule without a gate is review knowledge and keeps its reason.

Docs are held to the code:

- `scripts/docs-refs.test.mjs` reads the tracked Markdown (this file, the
  READMEs, agent files, skills and `docs/`): every backticked tool name is registered, every
  repo path exists, the identifiers of the skills and nested agent files exist, and each docs
  page stays within its line budget.
- `scripts/old-names.test.mjs` fails on a technical name of the retired operate CLI, on the
  unscoped npm packages pulse and pulse-cli (someone else's), on an image off GHCR, on a package
  of the retired MCP toolkit and on the npm name and path the c7 family's client had up to 0.27
  (engine-client; engine-core's name and path live on as the engine family's neutral core).
- `scripts/check-package-scripts.mjs` (`pnpm lint:package-scripts`) fails on a `--filter`
  naming no workspace package and on a pnpm filter without `--fail-if-no-match` on a gate path
  (pnpm 10 exits 0 when a filter matches nothing, so a stale name turns a gate green).

`docs/` holds the Pulse docs, a VitePress site on the Miragon docs kit
(`docs/.vitepress/miragon/`, skill `miragon-brand:docs-site`) that `.github/workflows/docs.yml`
builds on a pull request and publishes to https://miragon.github.io/pulse/ with each release, so
the site shows only released docs: `release-please.yml` calls it on `main` after the approval (the
`github-pages` environment admits `main` only, never a tag), a dispatch on `main` deploys by hand,
and no push deploys (`pnpm lint:github`). A user-visible change (env vars, tools, ports,
getting-started steps) updates them in the same PR. Below 1.0 the docs keep no upgrade page and
no migration note: a breaking change says so in its commit (`!` plus a `BREAKING CHANGE:`
footer), and release-please lists it in `CHANGELOG.md`. Headings get GitHub's anchors, so a
`#anchor` link works on the site and on GitHub. The product page https://miragon.ai/tools/pulse/
lives in Miragon/miragon-ai-docs; a change it shows needs a PR there too.

## What this repo is

Pulse (part of the Miragon AI tool family) is a pnpm + Turbo monorepo that ships an MCP server
(built on the official MCP TypeScript SDK, `@modelcontextprotocol/server` with the MCP Apps
extension `@modelcontextprotocol/ext-apps`, its UI on `@miragon/pulse-ui`) for Camunda 7 / CIB seven BPM operations,
including interactive React widgets (MCP Apps), plus a
command line interface (`apps/cli`), a VS Code extension (`apps/vscode`) and an Orca plugin
(`apps/orca`) for the same engines.

| Path                                           | Contents                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp-server/`                             | The MCP host: composes plugins, bundles the widget UI, serves HTTP on `:8400`                                                                                                                                                                                                                                                                                                                                              |
| `apps/cli/`                                    | The CLI (npm `@miragon/pulse-cli`): every REST operation of the engine as a command, generated from its OpenAPI spec, plus the workflow commands; its rules in `apps/cli/CLAUDE.md`                                                                                                                                                                                                                                        |
| `apps/vscode/`                                 | Pulse for VS Code (`pulse-cockpit`, a .vsix): the VS Code host of the runtime view; its rules in `apps/vscode/CLAUDE.md`                                                                                                                                                                                                                                                                                                   |
| `apps/orca/`                                   | Pulse for Orca (`@miragon/pulse-orca`, an Orca plugin): the Orca host of the runtime view (worker, components panel, custom editors); its rules in `apps/orca/CLAUDE.md`                                                                                                                                                                                                                                                   |
| `packages/connectors/engine/engine-connector/` | engine module, the one MCP module of every dialect: operations tools, widget tools, widgets                                                                                                                                                                                                                                                                                                                                |
| `packages/connectors/engine/engine-core/`      | The neutral core of the engine family (npm `@miragon/pulse-engine-core`), the contract every dialect implements: the ports a process engine answers (`ProcessRuntime`, `ProcessCommands`), ids, read models, queries, `RuntimeError`, `RootCauses`; the conformance kit with its laws, its fixed world and the in-memory `FakeEngine` (`/testing`); no runtime dependency, Pulse for VS Code's house rules                 |
| `packages/connectors/c7/c7-client/`            | The SDK of the Camunda 7 REST dialect family c7 (npm `@miragon/pulse-c7-client`): the REST SDK generated from c7-core's one spec (`src/generated/`), `createEngineClient` over the `fetch` it is handed and the SDK-bound reads (`src/sdk-reads/`); a leaf                                                                                                                                                                 |
| `packages/connectors/c7/c7-core/`              | The core of the Camunda 7 REST dialect family c7 (npm `@miragon/pulse-c7-core`), its workflow domain and pure engine REST rules: port, selection, inspect, status triage, the root cause of an incident (`causeOf`), retry/advance plans, dates, filters, variable writes, the one spec and its routes (`routeOf`, `intentOf`, `./routes`); one runtime dependency, engine-core's main entry                               |
| `packages/connectors/c7/c7-adapter/`           | The C7 adapter of the runtime view (`@miragon/pulse-c7-adapter`, private): its REST client and the mapping onto the contract of `engine-core`, over c7-core; bundled by the editor hosts                                                                                                                                                                                                                                   |
| `packages/core/ui/`                            | Pulse's design kit (npm `@miragon/pulse-ui`): primitives, components, tone model, type scale, locale, toasts, formatters and the Miragon theme (`theme.css` over the vendored `--cd-*` tokens) for Pulse views and customer UIs; the formatters and the tones without React under `/format` and `/tones`, the brand gates under `/testing`                                                                                 |
| `packages/core/widget-shell/`                  | The view runtime (`/widgets`: `mountViews`, the view host, the query hooks, `TestViewHost`, `ListTable`, hand-offs, BPMN), view + data-feed builders, the tool registrar (`createToolRegistrar`) and the boot (`/server`), a module's test server (`/testing`)                                                                                                                                                             |
| `packages/core/runtime-view/`                  | The runtime view both editor hosts compose (`@miragon/pulse-runtime-view`, private) over the contract of `engine-core`: the ports a host and an engine family plug in, the core, the protocol, the Preact webview, the local model reader and the host kit (targets from `.pulse.json`, policies, the write audit)                                                                                                         |
| `packages/core/profile/`                       | The one profile format of the CLI, the editor hosts and the MCP server (npm `@miragon/pulse-profile`): a parser from a file's text to a verdict per profile as data (a code and a key, never a value), the credential policy by where the file comes from, `refusalsOn` for what a reader cannot serve, the JSON Schema (`schema/pulse.schema.json`) and the shared fixtures (`/testing`); no runtime dependency           |
| `packages/core/http/`                          | The one engine transport of the MCP server, the CLI and the editor hosts' adapters (npm `@miragon/pulse-http`) over the `fetch` each hands in: a deadline to the last byte, no redirects, a 64 MiB cap, one retry after a 401, reasons as data, lossless JSON, masking, the path value rule; the OAuth client (`/oauth`); conformance cases, fake fetch (`/testing`), loopback engine (`/testing/loopback`); no dependency |
| `playground/`                                  | Demo env: CIB seven showcase engine, Compose stack, Fly.io deploy                                                                                                                                                                                                                                                                                                                                                          |
| `docs/`                                        | Pulse docs, a VitePress site on GitHub Pages (getting started, usage, architecture, developer, operations)                                                                                                                                                                                                                                                                                                                 |
| `docs/mcp/`                                    | The MCP server's pages of the docs site (getting started, usage, reference, operations, architecture, build your own, developer)                                                                                                                                                                                                                                                                                           |
| `docs/cli/`                                    | The CLI's pages of the docs site (install, commands, configuration, authentication, AI agents, development)                                                                                                                                                                                                                                                                                                                |
| `docs/vscode/`                                 | The VS Code extension's pages of the docs site (installation, configuration, usage, architecture, parity with the MCP cockpit)                                                                                                                                                                                                                                                                                             |
| `docs/orca/`                                   | The Orca plugin's pages of the docs site (installation, configuration, usage, architecture)                                                                                                                                                                                                                                                                                                                                |

Three axes decide where code goes, and they stay apart:

- Vendor (CIB seven, Operaton, Camunda 7): runtime config per engine, `flavor` →
  `EngineProvider` (invariant 8), never a package or an app.
- Dialect (an engine API family; one today, the Camunda 7 REST API all three vendors serve):
  one package family under `packages/connectors/<dialect>/`, named for the API family it speaks
  (`c7` today, with its client `@miragon/pulse-c7-client`, its core `@miragon/pulse-c7-core` and
  the runtime view's C7 adapter `@miragon/pulse-c7-adapter`, private; `c8` later), whose core
  implements the contract of the engine family's core. The engine family
  (`packages/connectors/engine/`) is the neutral layer above the dialects (owner decisions
  2026-11-07, 2026-11-08 and 2026-11-09): ONE MCP server app (`apps/mcp-server`) and ONE module,
  `engine` (`engine-connector`), serve every dialect, the module importing the clients and cores
  of the families `ENGINE_DIALECTS` names (`engine-connector-spans-the-dialects` in
  `.dependency-cruiser.cjs`; a dialect joins that list in the commit that first imports it), and
  ONE core, `@miragon/pulse-engine-core` (`engine-core`), holds the contract every dialect
  implements. A new dialect is a family, never an MCP server app or a module of its own, and
  inherits its gates from the layout.
- Interface (how a person or an agent reaches an engine): an app under `apps/`, today the
  MCP server, the CLI (`apps/cli`, rules in `apps/cli/CLAUDE.md`) and the two editor hosts,
  the VS Code extension (`apps/vscode`, rules in `apps/vscode/CLAUDE.md`) and the Orca plugin
  (`apps/orca`, rules in `apps/orca/CLAUDE.md`). Another interface (a third editor, say) is an
  app of its own. Apps never import each other, and no package imports an app: what the editor
  hosts share is the runtime view (`packages/core/runtime-view`) and a dialect's adapter of the
  engine contract (`packages/connectors/<family>/<family>-adapter`), private packages only they
  bundle. The surfaces (the MCP widgets and a starter's; the runtime view's webview, which both
  editor hosts show; the web apps of #573) share a core up to building blocks, not
  everything (owner decision 2026-11-12, `apps/vscode/docs/adr/ui-foundation.md`), in four
  layers: the formats, the board file first; the engine reads and their rules (the Camunda 7
  rules in c7-core, which the MCP server and the C7 adapter run over their `EnginePort`); the
  numbers and view models of a feature more than one surface shows, built once and
  framework-free over engine-core's read models; and building blocks, components on React that
  take props and callbacks only, with no host context inside (no `useToolQuery`,
  `ConfirmDialog`, `HandOffButton` or `HostBridge`). Each surface keeps its own screens and host
  wiring (hand-offs to the chat, live updates and the push protocol, native confirmations,
  sign-in) and may build parts of its own; where two surfaces show the same thing, a shared
  building block is the default, and no surface is forced to replace its own screen. Pulse's UIs are
  one UI family by decision, React on `@miragon/pulse-ui` with one compact look (owner decision D9,
  later on 2026-11-12, in the same record): the webview moves from Preact to React on pulse-ui in
  one switch, a commit of the pull request that recorded D9, with no `preact/compat` bridge; until
  that switch lands the webview is Preact. widget-shell stays the view runtime of the MCP widgets
  and the web apps, never the editor hosts'. The foundation stays pulse-ui's framework-free
  `/format` and `/tones` and, in tests, `/testing` (the glossary, the count words, the brand gates);
  the runtime view's core, ports, model reader and host kit stay framework-free. The board format
  and the board builder go into a new published package (the
  planned @miragon/pulse-board, whose dependency rules arrive with it); a shared building block
  goes into pulse-ui (a primitive) or into a shared package created with the first engine block
  two surfaces render. `docs/vscode/parity.md` lists what still differs between the views both
  show.

A family is one source the MCP server reads, a dialect or another source (a metrics store,
say), or `engine`, the neutral family above the dialects. Its packages are
named `<family>-<role>`: `<family>-connector` (the MCP module; a dialect brings none, the
engine module of the family `engine` serves it), `<family>-client` (the wire:
SDK, client, the SDK-bound reads), when the family's interfaces share a pure domain,
`<family>-core` (no runtime dependency, but a dialect's core imports engine-core's main entry;
one port per family, the home of the family's pure rules; extracted on its second consumer, like
`c7-core`, which the CLI bundles and the C7 adapter and the engine connector run) and, when the
editor hosts read a dialect's engines, `<family>-adapter` (the dialect's implementation of the
engine contract for the runtime view, proven by engine-core's conformance kit on a real engine;
today `c7-adapter`, the C7 adapter, which runs c7-core).
A family's tool input
schemas live in its connector, next to the tools
(`packages/connectors/engine/engine-connector/src/schemas/`), so a client carries no zod:
validating tool input is the connector's concern, and the wire takes typed parameters.
Family code stays in its family: `packages/core/` holds what every family builds on (pulse-ui,
widget-shell, the profile format, the transport), never one family's code. The engine family's
core, `@miragon/pulse-engine-core` (owner decisions 2026-11-08 and 2026-11-09), is the contract
every dialect implements: the ports, read models, failure kinds and laws a dialect answers in,
which the C7 adapter of the editor hosts speaks today, and the rules every dialect shares
(`RootCauses`). It stays narrow: a further rule (the verdict, the message signature, durations)
moves there only when a second dialect needs it in the CLI or the MCP server. Its admission rule:
a port, read model or rule enters `@miragon/pulse-engine-core` when two dialects answer it with
the same meaning, proven by the conformance laws on both (what the owner admitted ahead of a
second dialect, its README lists). It is imported where a dialect is implemented (the `src` of a
dialect's core, never its `./testing`: c7-core applies the root-cause rule `RootCauses`; the src
of a family's adapter) and where the runtime view reads the contract's answers (owner decision
2026-11-09 on #585: the runtime view's contract layer became engine-core, the one home of the
contract): the runtime view's layers that speak it (`src/ports`, `src/core`, `src/model`,
`src/host-kit`, never its webview) and the editor hosts' src, which name its ids
(`engine-core-consumers`); `packages/core/runtime-view` importing a family's core is the one edge
of the foundation into a family, which the owner accepted (`runtime-view-builds-on-the-engine-contract`).
The ports only the editor hosts need (`EngineAdapter`, the engine's web UI, the local model and
its code) stay in the runtime view's `src/ports`, never in engine-core. The engine connector
(although engine-core is its own family's core) or the CLI importing it directly waits until it
serves a second dialect, an admission decision in review, the case #488 reopens on: a second
interface needing the same use case with the same rules.

The architecture invariants below are written for the MCP server, its modules and its widgets.
The package rules of invariant 8 (layout, naming, dependency edges) hold for every workspace
package; another interface app keeps its own rules in its own CLAUDE.md.

## Commands

```bash
# From a fresh clone with Node, pnpm and Docker only (no JDK, no .env; scripts/local.mjs):
pnpm play                            # install, playground up, build, MCP server on :8400 + MCP Inspector
pnpm play:cli -- ping                # the built CLI against the playground engine
pnpm stack:up | stack:down | stack:status   # the playground in Docker (--multi-engine, --auth)
pnpm check                           # the local bar, one log per step in reports/check/
pnpm check:all                       # plus test:host, template, Gradle, docs build, engine suites
# The VS Code extension's own engines: pnpm --fail-if-no-match --filter pulse-cockpit sandbox:up

pnpm install --frozen-lockfile       # all deps are public; no registry credential needed

pnpm build                           # turbo build across the monorepo (runs `generate` first)
pnpm typecheck                       # tsc --noEmit everywhere, incl. widget/UI tsconfigs
pnpm test                            # vitest across the workspace
pnpm test:one <file...> [--watch]    # inner loop: test files in their packages, deps built, coverage off
pnpm lint                            # eslint per package (`pnpm lint:fix` to autofix)
pnpm format:check                    # prettier check (`pnpm format` to write)
pnpm generate                        # regenerate the c7 SDK and route tables from the one spec

# The server with your own settings (a .env file, see .env.example; playground: pnpm stack:up):
pnpm dev                             # MCP server on :8400 + MCP Inspector

# The playground engine (Kotlin, Java 21):
cd playground/cibseven-example && ./gradlew build # compile + unit tests

# Docs site:
pnpm docs:dev                        # local dev server; pnpm docs:build to build

# The CLI (apps/cli; Docker for the engine suites, build first):
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog       # regenerate the command catalog
pnpm --fail-if-no-match --filter @miragon/pulse-cli test:engines  # Testcontainers suites
```

`pnpm play` and `pnpm dev` build once, then serve the MCP endpoint at `http://localhost:8400/mcp`
(`vite build --watch` and `tsx watch` rebuild the view bundle and restart the server when the
app's sources or the bundle change; a package's change needs its build) and start the official MCP
Inspector (`@modelcontextprotocol/inspector`, the app's `dev:inspector`) as a process of its own
on `127.0.0.1`, connected to that endpoint. It opens no browser: open the URL it prints (with its
per-launch token). Use it to call tools and render widgets manually (its Apps tab). It has no
chat, so a hand-off and a view's model context show only in a real host; one reaches a local
server through a tunnel (`cloudflared tunnel --url http://localhost:8400`, then `MCP_URL` set to
the tunnel's `https://` origin and the server restarted, or the `Host` check refuses it).

If generated SDK files look wrong (e.g. `client.gen.ts` importing `./src/hey-api.js`
instead of `../hey-api.js`), the shared turbo cache replayed a poisoned `generate`
output. Fix it with `pnpm exec turbo run generate --filter=@miragon/pulse-c7-client --force`.

## Design-System (verbindlich)

Alle UI- und Gestaltungsarbeit folgt dem Miragon-Design-System für Produkte. Quelle der
Wahrheit ist die Skill `miragon-brand:modeler-tool-design` im Repo Miragon/corporate-identity;
sie lädt bei UI-Arbeit, wenn das Plugin installiert ist. Ohne Plugin den Guide direkt lesen:
https://raw.githubusercontent.com/Miragon/corporate-identity/main/plugins/miragon-brand/skills/modeler-tool-design/assets/modeler-design-system.md
Für jedes Wort in der UI gilt zusätzlich `miragon-brand:brand-tone`.

Die Marken-Tokens kommen aus der Skill (`cd-tokens.generated.css`); keine HEX-Werte forken. Das
Theme von `@miragon/pulse-ui` (`@miragon/pulse-ui/theme.css`) vendort sie unverändert
(`packages/core/ui/src/tokens/`) und bildet seine Rollen-Variablen in Hell und Dunkel darauf ab. Die
App (`apps/mcp-server/src/ui/globals.css`) und das Starter-Template
(`server/src/ui/brand.css`) importieren es nach `tailwindcss` und überschreiben nur Rollen- und
Alias-Variablen (`--primary`, `--link`, `--focus`, `--<ton>`, `--<ton>-soft`, `--<ton>-ink`, Radien,
Schatten), nie `--cd-*`; Komponenten nutzen nie Palettenklassen oder rohe Farben. Die Docs-Site
nimmt das Doku-Kit der CI unverändert (`docs/.vitepress/miragon/`, `docs/public/logo/`; bei jedem
CI-Release neu vendoren, nie von Hand ändern).

Ein `--cd-*` steht nur in vendorten Kopien, deren Manifest `SANCTIONED_TOKEN_MANIFESTS` freigibt:
die Kopien aus `.miragon/brand-assets.yaml` (pulse-ui in `packages/core/ui/src/tokens/` und das
Theme der Webview von VS Code und Orca in `packages/core/runtime-view/src/webview/theme/`,
Prüfsummen in `.miragon/brand-assets.sha256`) und das Doku-Kit. Eine weitere Kopie kommt mit
`brand-assets.mjs --add` aus dem Plugin miragon-brand, nie als Ausnahme im Scan. Ein Token, das
mehrere Kopien im selben Geltungsbereich setzen (`:root`, Hell, Dunkel), hat in allen denselben
Wert: Ändert ein CI-Release einen Wert, kommt er in alle Kopien zugleich. Der
Drift-Test ist `packages/core/ui/src/theme/token-drift.test.ts` (mit
`packages/core/ui/src/theme/vendored-tokens.test-support.ts`); `test:host` prüft das gebaute
Stylesheet.

UI-Texte gibt es auf Deutsch und Englisch, je nach Host-Locale. Deutsch folgt brand-tone
vollständig: du-Ansprache, AI statt `KI`, „CIB seven“, kein Gedankenstrich als Verbinder,
normale Groß- und Kleinschreibung, Fehlermeldungen sagen, was passiert ist und was du tun
kannst. Englisch übernimmt die übertragbaren Regeln: Sentence case, aktiv, kein Em-Dash als
Verbinder. `.miragon/brand.json` schaltet den brand-lint-Hook für jede geänderte Datei ein;
Strings in `.ts`/`.tsx` prüfen die Gates aus `@miragon/pulse-ui/testing` (Invariante 6). Dort
liegen auch das Produkt-Glossar und die Zählbegriffe; die VS-Code-Erweiterung prüft damit die Texte
der Laufzeitansicht, die sie mit Pulse for Orca teilt, und ihres Hosts
(`apps/vscode/test/architecture/product-words.test.ts`, dort auch der Promise-Scan: kein Text
verspricht eine spätere Funktion, `apps/vscode/test/architecture/support/promise-words.ts`, in
Pulse for Orca als Kopie) und die Webview mit den Marken-Gates
(`apps/vscode/test/architecture/brand-gates.test.ts`).

### Abweichungen für eingebettete Chat-Widgets

Die Widgets laufen als MCP Apps im Rahmen eines Chat-Hosts. Dafür gelten diese bewussten
Abweichungen vom Guide (Owner-Entscheidung, nur hier dokumentiert):

- Theme: Die Widgets folgen dem Host-Theme (#339), ohne Umschalter in der App; ohne Host das
  OS. Die neutralen Rollen nehmen in Hell und Dunkel die Werte der `--cd-ui-*`-Rollen des Guides
  (Grund, Fläche, Fläche hoch, Hover, Linie, leiser Text, Backdrop) wie die Webview, keine
  eigenen Aufhellungen von `--cd-schwarz` (entschieden in D9,
  `apps/vscode/docs/adr/ui-foundation.md`); dazu `--raised`, `--interaction` und
  `--<ton>-surface`. pulse-ui folgt auch `data-cd-theme`, `data-cd-kontrast="hoch"` und
  `forced-colors`. Sonst folgt Dunkel den Dark-Ground-Regeln der CI: Text Weiß, Links und
  Akzenttext `--cd-gruen`, Buttons `--cd-blau` mit Weiß, Fokus `--cd-blau-hell`, der
  eingeschaltete Schalter und die Linie unter dem aktiven Tab `--interaction` (dunkel
  `--cd-blau-hell`), Status in den `-hell`-Werten ohne getönte Flächen. Der Host setzt nur die
  neutralen Rollen (`HOST_TOKEN_MAP`: Flächen, Text, `--border`), nie `--primary`, `--link`, `--focus`, `--ring`, `--input`, `--accent` oder einen
  Status; unter seinem Theme fallen Grund und Fläche zusammen, Bereiche trennen dann die
  1-px-Linien. BPMN-Papier und seine Zoom-Leiste bleiben immer hell.
- Schrift: Geist zuerst, dann die Schrift des Hosts (`adoptHostFontVariables`), dann System.
  Der Server liefert Geist und Geist Mono selbst aus (`installFontAssets`, kein CDN), jede View
  erlaubt den Ursprung über ihre CSP `resourceDomains` (`declareServedFonts`). Blockt ein Host
  den Ursprung, rendert die Host-Schrift, ohne dass etwas wartet.
- Sprache: Deutsch und Englisch nach Host-Locale (Fallback Englisch) statt nur Deutsch.
- Chrome: im Rahmen des Hosts (Kopf mit Titel und Aktionen) statt randlosem Canvas mit
  schwebendem Chrome in den Ecken.
- Titel: Der Titel einer Ansicht ist Chrome, 13 px in 600 als Überschrift in der 40-px-Leiste
  (der Chrome-Titel des Guides); 28 px in 700 als h2 nur auf App-Ebene (Landing, Flotte) statt
  h1 mit 40 px.
- Data-Viz: eine einfarbige Rampe von `--cd-info-soft` bis `--cd-blau`; Rot nur für
  Incidents.
- Komet: nur auf App-Ebene (Landing, Erststart, „keine Engines“), nicht in jedem Widget
  (`KometMark`/`AppEmptyState`, die CI-Datei unverändert). Eine Kundenmarke blendet ihn über
  den Theme-Slot `--brand-mark-display: none` aus.
- BPMN-Zoom-Leiste oben rechts statt unten rechts: unten rechts liegt das bpmn.io-Logo
  (Lizenzpflicht).

### Abweichung Dichte, für alle Oberflächen

Alle Oberflächen (die MCP-Widgets, die Web-Apps, die Webview von VS Code und Orca) haben einen
kompakten Look aus `@miragon/pulse-ui`, nach dem Vorbild der Webview (Owner-Entscheidung D9 vom
2026-11-12, `apps/vscode/docs/adr/ui-foundation.md`; pulse-ui, das Cockpit und die Webview ziehen
in eigenen Commits nach). Die Dichte-Rollen stehen in `rem` in pulse-uis `theme.css`; ein Test
hält sie bei 16 px Wurzelgröße gleich zu den Shell-Tokens des
Guides (`--cd-shell-zeile`, `--cd-shell-eintrag`, `--cd-shell-ziel`, `--cd-shell-rand`).
Kompakt ist der Standard. Auf Touch (`any-pointer: coarse`) und unter
`[data-density=comfortable]` gilt die komfortable Stufe: Bedienelemente 36 px, Zeilen und
Toolbars 40 px, Radius md auf Knöpfen. Die Schrift bleibt in jeder Stufe gleich; nur Eingaben
zeigen auf Touch 16 px Text, damit iOS beim Fokus nicht in die Seite zoomt, und
`[data-density=comfortable]` allein lässt sie bei 13 px. `[data-density=compact]` hält die
kompakte Stufe auch auf Touch fest, damit die Editoren auf einem Touch-Laptop kompakt bleiben wie
VS Code selbst; die Webview setzt es mit dem Umstieg auf ihr `<html>`. Die Eingaben behalten dort
13 px Text, denn ihre Schrift ist eine eigene Rolle (`--field-text`), die der kompakte Pin
erreicht. Leiste 40 px, Toolbar 36 px und Rand 12 px sind Werte des Guides und keine Abweichung.
Diese bewussten Abweichungen vom Guide gelten für alle Oberflächen (Owner-Entscheidung):

- Bedienelemente (Knöpfe, Eingaben, Auswahlen) mit 28 px und klickbare Tabellenzeilen mit 28 px
  statt 36 px.
- Radius sm (6 px) statt md auf beschrifteten Knöpfen.
- Knöpfe mit 24 px (xs: in Hinweisstreifen, zum Kopieren, in Tabellenzeilen), unter der kleinsten
  Größe des Guides von 28 px; die Aktionen einer Tabellenzeile sind xs, damit jede Zeile 28 px
  hoch bleibt (40 px komfortabel), wie in der Webview.
- Gewicht 400 auf den Beschriftungen der Toolbar-Knöpfe.
- Zähler als Pille.
- Der angedockte Hinweisstreifen ohne die 4-px-Kante.
- Icons: 12 px mit Strich 2,5 neben dichtem Text und auf den 20-px-Overlays des Diagramms (Zähl-
  und Move-Badges, Code- und Move-Knöpfe, Links und Warnungen im Text), sonst 16 und 24 px.
  `Icon` mit `dense` ist das 12-px-Icon. `scanIconSizes` liest `size={…}`, die `size-*`-Klassen
  auf SVG-Selektoren (`[&>svg]:size-3`) und auf `Icon` und `dense` auf `Icon` und lässt 12 px nur
  in den Dateien zu, die das Gate je mit Grund nennt (`allowDense`; im Kit
  `packages/core/ui/src/brand-gates.test.ts`: Badge, die Knöpfe xs und icon-xs, der Pfeil des
  `DrillButton` in xs, `Icon` selbst, der Sortierpfeil im Tabellenkopf, das Ton-Icon im Segment;
  widget-shell und der Konnektor in ihrer `brand-gates.test.ts`); ein Eintrag ohne 12-px-Icon
  schlägt fehl.

### Abweichung für die VS-Code-Webview

Die Webview der VS-Code-Erweiterung, die Pulse for Orca ebenso zeigt (in
`packages/core/runtime-view`), zieht in einem Umstieg von Preact auf React 19 und
`@miragon/pulse-ui` um, ohne Brücke über `preact/compat` (Owner-Entscheidung D9 vom 2026-11-12,
`apps/vscode/docs/adr/ui-foundation.md`; der Umstieg ist ein Commit der PR, die D9 festhält).
Bis dahin läuft sie auf Preact mit eigenem CSS. Danach baut sie ihre Ansichten aus dem Kit, ohne
widget-shell: Sie rendert die View-Modelle, die der Kern schickt, und behält ihre Host-Anbindung
(Push-Protokoll, Live-Updates, native Bestätigung). Mit den Widgets teilt sie das Fundament aus
pulse-ui (Töne `@miragon/pulse-ui/tones`, Formatierer `@miragon/pulse-ui/format`, Glossar,
Zählbegriffe, Marken-Gates) und die Bausteine, die D9 aus der Webview in pulse-ui hebt
(`ViewBar`, `StatusStrip`, `Facts`, `StateLabel`, `CountBadge`, `DataTable` …); nur die geteilte
Ansicht mit ihrer verstellbaren Trennung und den gespeicherten Breiten bleibt im Editor. Die Hosts
setzen `data-cd-theme`; VS Code setzt für seine Hochkontrast-Themes schon heute
`data-cd-kontrast="hoch"`. Das Theme-Ereignis von Orca meldet nur hell oder dunkel
(`apps/orca/types/orca/index.d.ts`): In Orca erreicht hoher Kontrast die Webview über
`forced-colors`, und die Brücke von Pulse for Orca setzt `data-cd-kontrast="hoch"` nur, wo Orca
hohen Kontrast meldet. Was die Oberflächen noch unterscheidet und ob es gewollt ist, steht in
`docs/vscode/parity.md`. Für die Webview gilt zusätzlich diese
bewusste Abweichung vom Guide (Owner-Entscheidung, auch in
`apps/vscode/docs/adr/user-interface.md`):

- Diagramm: Die Zähl-Badges auf dem Diagramm bleiben gefüllte 20-px-Pillen.

Ihre 12-px-Icons (Dichte, oben) lässt `scanIconSizes` in der Webview nur in den Dateien zu, die
`apps/vscode/test/architecture/brand-gates.test.ts` je mit Grund nennt.

## Architecture invariants

1. **New operations tools go through the registrar, never a raw `server.registerTool()`.** Add the Zod
   input schema in `packages/connectors/engine/engine-connector/src/schemas/`, then register
   the tool in `packages/connectors/engine/engine-connector/src/tools/<domain>.ts` via the
   `register` callback of `createToolRegistrar` (`@miragon/pulse-widget-shell/server`, wired in
   `src/tools/index.ts`): a `category` matching its domain file, `...engineParamShape` in the
   input schema, the handler wrapped in `withEngine(...)`
   (both from `src/lib/engine/with-engine.ts`). Canonical shape: `engine_list_process_instances` in
   `packages/connectors/engine/engine-connector/src/tools/process-instances.ts`. ESLint
   (`no-restricted-syntax` in `eslint.config.mjs`) blocks a raw `registerTool` and ext-apps'
   `registerAppTool` wherever a source of any extension names it outside the widget-path files
   its `ignores` lists: a member, an import, a destructuring at any depth, a string that is the
   whole name outside a type (so `Object.entries` too). Left to review: a key concatenated or
   computed at runtime, a parameter's own destructuring (a carve-out from when the gated member was
   `tool`; no source uses one) and `src/generated/`, which ESLint skips.
   `no-restricted-syntax` is ONE rule: a later flat-config block REPLACES its selectors, so a glob
   two gates share gets one block with the union (`scripts/eslint-gates.test.mjs`).
   - Annotations decide the toolset. A destructive or admin tool goes into `ADMIN_ONLY_TOOLS`
     (`src/lib/mcp/toolsets.ts`); `src/lib/mcp/toolsets.test.ts` checks every registrar tool
     and `src/plugin.test.ts` every tool the module registers, feeds included (the read-only floor
     holds only `readOnlyHint` tools; every write states `destructiveHint`, since MCP reads an
     absent hint as `true`). Fix the annotations, not the test.
   - Toolsets are FAIL-CLOSED: without a suffix a module runs its read-only floor on an
     unauthenticated boot and its standard toolset (engine `operations`) under OAuth;
     `admin` is never implied; an empty or unknown suffix warns and falls back to the floor;
     nothing resolves to "everything" (widget-shell's `toolsets.test.ts` +
     `composition.test.ts`). A module without toolsets registers every tool, and a suffix on it
     is ignored with a warning.
   - Admin-only by decision, each with `destructiveHint: true`: the engine-wide
     `engine_throw_signal` and the external-task worker protocol (`engine_fetch_and_lock`,
     `engine_complete_external_task`, `engine_handle_external_task_failure`); the read path
     `engine_list_external_tasks` and the recovery `engine_set_external_task_retries` stay
     in `operations`. Reads that only feed an admin write are admin-only too:
     `engine_create_migration_plan`, `engine_get_batch` and
     `engine_get_activity_instance_tree` (the instance ids `engine_modify_process_instance`
     takes); below admin, `engine_inspect_process_instance` shows where an instance waits.
   - `engine_create_deployment` registers only with `ENGINE_ALLOW_DEPLOYMENTS=true`:
     deploying BPMN/DMN is code execution inside the engine JVM (JUEL, scripts). Never relax
     that gate or fold it into a toolset.

2. **Never talk to an engine directly.** All engine access goes through
   `resolveEngine`/`withEngine` (`packages/connectors/engine/engine-connector/src/lib/engine/`),
   which routes by precedence: per-call `engine` > the operator default
   `ENGINE_DEFAULT` > the profile file's `defaultProfile` (each must name a profile, else the boot
   fails) > the only profile (counted with the refused ones) > `ENGINE_NOT_SELECTED` listing the
   engines. The engines are profiles of `@miragon/pulse-profile` (`src/engine-profiles.ts`): a
   profile the server cannot use is refused on its own (the boot warns, `engine_list_engines`
   lists it under `refused`), and a call to it, a default on it included, fails with
   `ENGINE_PROFILE_REFUSED`, never rerouted. There is deliberately NO
   per-user or in-memory selection (replica-unsafe; the server is stateless, one `McpServer`
   per request, no session ids). A client
   you construct or cache yourself breaks multi-engine routing; `resolveEngine` already returns
   `baseUrl`/`cockpitUrl`.

3. **A bundle view is registered in three places**; a view that misses one is silently absent:
   - the module's view map, keyed by its view tool's name (the engine module has ONE view,
     `engine_open_cockpit` → `CockpitApp` in
     `packages/connectors/engine/engine-connector/src/widgets/views.tsx`)
   - `apps/mcp-server/src/ui/view-registry.ts`: every module's views
   - `packages/connectors/engine/engine-connector/src/tool-names.ts`: the tool-name constant
     for the view tool and every `*_data` feed, so in-widget feed calls stay rename-safe

   New engine UI is a cockpit route, never a second view: a section in `CockpitView` and its
   data in `CockpitStartData` (`src/view-models.ts`), its builder in `src/data/`, its `*_data`
   feed in `DATA_FEEDS` (`src/data/feeds.ts`) and the feed's name in `src/tool-names.ts`, its
   entry in the route descriptor `COCKPIT_ROUTES` (`src/data/routes.ts`: the ids it needs and
   takes, its start data as that feed's first page and its facts for the model) and a case in
   the widgets' `CockpitRoute` (`src/widgets/cockpit-app/routes.tsx`). The feed registrations
   (`src/widget-tools/data-feeds.ts`), the `view` enum and its ids
   (`src/widget-tools/cockpit.ts`) and the start dispatch (`src/data/cockpit-start.ts`) derive
   from them; `COCKPIT_ROUTES` and the widgets' route switch are total over the sections, so
   they fail to compile until each has the route. A route that nothing emits and
   `engine_open_cockpit` cannot open is dead.

   A view is picked by its NAME, the view tool's name (`showToolBinding` binds the tool to
   `ui://views/<name>.html` in its `_meta.ui.resourceUri`, the boot serves the one bundle there
   with a prelude naming it), so
   `apps/mcp-server/test/view-registry.test.ts` holds the view registry to the
   view-bound tools of the tools/list goldens and fails both ways: on a tool without a view
   (the "can't show this view" state) and on a view no tool opens (dead code in every
   view's bundle).

   The engine module's views are bundle views, never a resource of their own: an ESLint gate
   (`no-restricted-syntax`, `scripts/eslint-gates.test.mjs`) blocks `registerResource` and ext-apps'
   `registerAppResource` under `packages/connectors/`, the widget-tools files too, wherever invariant
   1's gate would (left to review here too: a key concatenated or computed at runtime, a parameter's
   own destructuring, `src/generated/`), so they stay on the kit and the view host. A customer's
   module may bring a finished HTML document instead (invariant 8, the module port); only that view
   skips the three places.

4. **The view bundle's `resolve.dedupe` is load-bearing: never remove or trim it.** It is
   widget-shell's `VIEW_BUNDLE_DEDUPE` (`@miragon/pulse-widget-shell/server`), spread whole in
   `apps/mcp-server/vite.config.ts` and the template's `server/vite.config.ts`. Without it each
   widget package bundles its own React, TanStack Query, pulse-ui, widget-shell or lucide-react
   instance, the React contexts no longer match, a widget finds no view host and no
   `QueryClient`, and every in-widget query hangs on "Loading…" (ext-apps' `App` keeps no React
   context, so a second copy of it costs only bytes and stays off the list). widget-shell's
   `src/view-bundle.test.ts` holds the list to its peers, `test/view-bundle.test.ts` the app's
   config to the list, test:host's in-widget query the built bundle.

5. **There are three render paths; pick deliberately:**
   - Registrar tools (`src/tools/`): plain JSON data _for the model_.
   - Widget tools (`engine_open_cockpit` in the engine module, a customer module's `*_show_*`; spread
     `...showToolBinding(name, title)` from `@miragon/pulse-widget-shell/server` into
     `registerTool`'s config): render a
     view for the user, as `buildViewResult(data, text)`: the `structuredContent` IS the view's
     data and the `content` text is the model-facing result as compact JSON or a short English
     summary. `engine_open_cockpit`'s `view` picks the start
     route, its `structuredContent` carries that route's data (the route's widgets seed their
     feeds with it) and its `content` that route's facts. The view is picked by its name
     (= the tool's name); a composed view (a dashboard, the process detail) is ONE component
     that composes its widgets, never a layout the server sends.
   - `*_data` feeds (spread `...appOnly`, **no** view binding; the engine module's `registerDataFeed`):
     app-only JSON for in-widget refresh and navigation, returned as
     `buildDataFeedResult(data)`. SEP-1865 hosts hide them from the LLM, and a widget-tool
     result would be rendered by the host instead of returned to the in-widget `callTool()`.

   Every tool takes STRICT input (the registrar always, a raw registration through
   `strictToolInput(…)`; the boot refuses a schema that lets an unknown key through), with no
   exemption list: an unknown key is a tool error listing the valid keys, never a silently
   stripped filter (`test/strict-input.e2e.test.ts` in the app). Parameter names and descriptions follow the
   guide in the add-bpm-feature skill: a parameter that means the same on every tool is
   explained once in the module instructions, and a tool describes it only where it means more
   there.

6. **MCP App widgets compose from the design kit `@miragon/pulse-ui` and the view runtime of
   `@miragon/pulse-widget-shell/widgets`; never re-inline their primitives.** This covers
   the React views an MCP host renders (pulse-ui's and widget-shell's `src`, the connectors'
   `src/widgets`, the host bundle in `apps/mcp-server/src/ui/`); another interface
   app's own UI follows the design system above, and the VS Code webview takes from pulse-ui its
   foundation (`/format`, `/tones`) and, for shared building blocks, its React kit and
   stylesheet. By the owner's decision D9 of 2026-11-12 (`apps/vscode/docs/adr/ui-foundation.md`)
   the webview moves from Preact to React on pulse-ui in one switch and then composes the kit
   without widget-shell, in the one compact look of the design section.
   - **Pairs.** Six cockpit views have a counterpart in the VS Code webview (the overview, a
     process, its instances, an instance, an incident, the history). A field, a count or an
     action added to or changed in one is a pair feature: where both show it, a shared building
     block is the default (React, props and callbacks only, no host context inside: no
     `useToolQuery`, `ConfirmDialog`, `HandOffButton` or `HostBridge`), which both render in
     React once the webview's switch lands, and each side keeps its own screen and host wiring
     around it; until that switch (its preconditions in `apps/vscode/CLAUDE.md`), a pair feature
     is still built on each side. Its pull request updates `docs/vscode/parity.md` by its review
     rule. Which blocks two surfaces share is the owner's decision in normal review. A
     primitive goes into pulse-ui, an engine block into a shared package created with the first
     one two surfaces render; until then the cockpit side keeps its props-only content in the
     connector (`process-definitions-table-view.tsx` with `renderActions`, `history-steps.tsx`).
   - **One kit.** Primitives, components, the tone model (`TONE_*`, `resolveTone`), `cn`, the
     formatters and the kit pieces (`Icon`, `Th`/`Td`, `TableEmptyState`, `NativeSelect` …) come
     from `@miragon/pulse-ui`, a leaf (`ui-is-a-leaf`, invariant 8); widget-shell exports only
     what touches the host and never a pulse-ui name
     (`packages/core/widget-shell/src/pulse-ui-overlap.test.ts`). A form says an invalid
     entry inline next to the control it marks `aria-invalid` (pulse-ui's `Field` wires both),
     never clamps it silently.
   - **The view runtime is widget-shell's.** Its host adapter (`ExtAppsViewHost` in
     `src/ui/ext-apps-host.tsx` over the official `App` of `@modelcontextprotocol/ext-apps` in
     `src/ui/view-runtime.ts`, mounted by `src/ui/view-root.tsx`) is the ONE place that speaks to
     the host: it mounts the
     host-agnostic contexts every widget reads (`HostContexts`, from one `ShellHost` and one
     `ViewHost`), as `TestViewHost` does in tests, so another host (a web app, a VS Code
     webview) brings an adapter of its own and never touches a widget.
     The root's call hook (`useViewCall` over `resolveViewCall`) owns the stripped-result
     recovery: a host that drops `structuredContent` gets ONE re-run of the view's own view
     tool, so every view-bound tool is a read (`apps/mcp-server/test/view-registry.test.ts`).
     `ViewFrame` renders the phases (waiting, error, cancelled, ready); every `ViewStack` row
     has its own error boundary, so one crashing widget never takes its view down. Widgets
     reach the host only through `useViewHost`/`HostModelContext` and the query hooks
     (`useToolQuery`, `useToolQueries`, `useToolMutation`, `useViewData`), test under
     `TestViewHost`, and never import the MCP Apps runtime of
     `@modelcontextprotocol/ext-apps` (ESLint `no-restricted-imports` outside the adapter's three
     files; its `/server` half is invariant 1's; `scripts/eslint-gates.test.mjs`).
   - **States and feedback** (#322). Loading, error and no data go through `ViewDataState`, or
     `QueryFallback` + `TableSkeleton` in a self-fetching widget (without an `isError` branch
     the skeleton never ends); both take a required `onRetry` and word a failure with
     `describeError`, the raw engine text only under "Details". A refusal no retry changes
     (`isPermanentError`: a refused profile, a write to a read-only engine) is not retried by the
     view's query client and offers no Try again, in an error state or a failed refresh's notice
     (a paged list's footer through `canRetry`, which then says why through `describeRefusal`,
     never "try again"; a view's failed refresh over the data it shows is a `StatusStrip` docked
     under its bar, `useDetailView`'s `notice`, the raw engine text under the strip's Details); a
     write words it once, at its control or in its confirmation's dialog, and the cockpit shows a
     refused engine once, as its view's one state (`RefusedEngineGate`), also before the engine
     list answers. A write reports through
     `useActionFeedback()` toasts that name the object and confirms through `ConfirmDialog`;
     nothing to show is `TableEmptyState`. A first load shows its skeleton only after 400 ms
     (`SKELETON_DELAY_MS`), a refresh keeps the content on screen with its region `aria-busy`
     (both components' `children` and `refreshing`), and an error is the guide's status box
     (`ErrorState`).
   - **Inline is a card, not a page** (#396). A list under a host shows the rows that FIT the
     host's height budget, measured on the rendered view (`InlineFitBox`), never estimated
     with px constants. A paged list registers ONE list (`PagedRows` + `paged.fit`, its footer
     `labels={paged.footerLabels}`; `inline-fit-wiring.test.ts`); a row that continues the one
     before carries `FIT_CONTINUES_ROW`. An id in a table cell takes one line, so a row keeps the
     row height: `NamedId` lays out inline in a `DataTable`'s body (the name, then the short id
     quiet in mono, the whole in its title), whole where the table has room and cut with an
     ellipsis first where it has none, and `IdText`'s copy button reaches into the cell's padding,
     shows on the row's hover and focus, always on touch, never leaving the tab order. Only
     outside tables (facts, a detail's header) does an id stack and wrap between its parts
     (`BreakableId`). Roots declare inline + fullscreen only (`SHELL_VIEW_CONFIG`).
   - **Tables never widen the document** (WCAG 1.4.10): `ListTable`, over pulse-ui's
     `DataTable` (a sticky head of one-line captions, 28 px rows, a hover fill on `--accent`),
     scrolls inside a named region (`ariaLabel`) and drops columns on narrow regions
     (`hideBelow`); a wide table of figures lets its captions wrap (`wrapHeads`). It sizes no
     column: `DataTable`'s column sizing (`useColumnSizing`, its persistence injected) is for a
     view that passes `sizing`; the grips, the column menu and their measuring come with it, and
     a selection column's box with `rowSelection`, so a bundle without them carries none. Ids
     show through `IdCell`/`IdText`, processes and elements through `NamedId`, named by ONE
     reader (`readBpmnNames`/`parseBpmnNames`), so every module shows them alike.
   - **Type, dates and numbers.** Text sits on pulse-ui's `TYPE_SCALE` (13 px floor, weights
     400, 600 and 700 only, `scanTypeScale`); a disabled control is opaque, never faded. Dates,
     durations, numbers, counts and short ids go through the kit's `format*` helpers and `shortId`
     in the locale `LocaleGate` publishes, one set for every Pulse UI (pulse-ui's framework-free
     `@miragon/pulse-ui/format`, which the VS Code extension's core and webview read too; a lower
     bound is `formatCount({ atLeast })`, `≥ 2,000`; ESLint's date and number gates over
     `WIDGET_TREES`, every widget tree: the host bundle's `src/ui`, widget-shell's and the
     connector's widgets, and the extension's core and webview; `scripts/eslint-gates.test.mjs`).
     A count reaches a catalog entry already formatted, and the entry puts the noun in the right
     number (`countOf`, `plural(…)`), never a `…One`/`…Other` key pair.
   - **BPMN** renders through `useBpmnViewer` + `BpmnZoomControls` on a forced-light canvas
     whose colours all come from `BPMN_TOKENS` (`packages/core/widget-shell/src/ui/bpmn-tokens.ts`).
   - **Paged lists** compose `usePagedListView` (the feed takes `firstResult`/`maxResults` and
     returns an honest total; counts, filters and model contexts read the payload ON SCREEN,
     never the request) + `ListTable` + `PagedListFooter`. Optimistic local state resets with
     `useResetOnChange(data, reset)`, never in an effect.
   - **A status is a tone, never a coloured word.** `ToneVariant` is
     `danger | warning | success | info | neutral`: an open incident or a failed job without retries
     is `danger`, a failed job with retries left or a degraded engine `warning`, a count without a
     state `neutral`; one table gives each situation its tone in every Pulse UI (`SITUATION_TONES`
     in pulse-ui's framework-free `@miragon/pulse-ui/tones`: running `info`, suspended, ended and a
     process that runs without a problem `neutral`, never a green "healthy"; the VS Code webview's
     state labels read it too; a widget reads a state's tone there, never a literal), the count
     ladder over it pulse-ui's `countTone`/`severityTone`. An engine's own state is the tone of its
     one verdict (`VERDICT_TONE`, the health feed's `status`; `ok` is the table's `healthy`,
     neutral; the VS Code extension shows no verdict): the overview's badge and the engine's dot
     on the landing and the fleet view alike. A failed health read has no verdict: its tone is
     the engine module's `HEALTH_FAILURE_TONE`
     (`packages/connectors/engine/engine-connector/src/widgets/lib/health-verdict.ts`), an
     unreachable engine `danger`, a refused profile or login `warning`. Each tone has four
     roles: `--<tone>` (dot, edge, icon), `--<tone>-soft` (tint, black text), `--<tone>-surface`
     (the guide's status surface for a status box or strip: the tint on light, neutral on dark)
     and `--<tone>-ink` (text on card or page, never on a tint, never a number). Numbers stay
     neutral: an alarming count shows its tone by an icon of the tone's own shape and says it in
     words (`CountFigure` in a table cell, a fact or a KPI tile, `CountBadge` as a pill at a row's
     end; filled in its tone only on a BPMN diagram, the named deviation), never by a coloured
     number, a tinted pill or a tinted KPI tile (owner decision of 2026-11-12, D9), a state in a
     cell is a `StateLabel` (an icon of the state's own shape, its one word from the kit's
     catalog) on the row's one line, never a pill (those are a header's `badge`) and never stacked
     under an id. Components use
     role names only (`scanColors`); `packages/core/ui/src/theme/tone-contrast.test.ts` holds every
     role pair to WCAG AA (a role a brand may override belongs in `ROLE_CONTRAST_PAIRS`). A brand
     override goes under `:root` AND the dark scopes, or a light-only value shows in dark
     (`parseThemeVariables`).
   - **Icons are Lucide**, never glyphs or emoji: `Icon`, 16 or 24 px, 12 px only in the files
     the gate names with a reason (`scanIconSizes`, the density section's deviation), its
     stroke through lucide's own `strokeWidth`, never a CSS `stroke-width` rule, which would
     beat the `LucideProvider` widget-shell's view root sets with pulse-ui's `ICON_STROKE`.
     Every package that imports `lucide-react` and every host bundle pin the SAME exact 1.x
     devDependency (today `1.70.0`): pnpm installs a package once per peer set, so two versions
     resolve a second pulse-ui and widget-shell instance and split the React contexts.
   - **Actions and hand-offs.** A view's actions are ONE group in `WidgetHeader` `actions` (the
     view's `ViewBar`, the hero only at app level with `size="app"`), all the kit's toolbar
     buttons of one size (`variant="toolbar"`, `size="sm"`: an icon and its label at 400, the
     label hidden visually in a bar under 36rem and kept as the name; `OpenInCockpitLink` and
     `HandOffButton` take `variant="toolbar"` there), ordered: deterministic steps, the engine's
     own web app (`OpenInCockpitLink`), then the chat; the bar's facts hold facts only
     (`action-group.test.tsx`), and a state goes into the header's `badge`, not an icon tile.
     `WidgetShell` pads nothing: its `header` (the bar, the strips under it) runs from edge to
     edge, its content sits in the gutter, and a `flush` shell's children are views of their own
     (the cockpit's routes). A row's drill is `DrillButton` (`row-actions.test.ts`), its
     further actions sit in `MoreActions`; a table row's actions are `xs` (24 px: `DrillButton`
     `size="xs"`, a hand-off's `size="xs"`, `MoreActions`), so the row keeps the row height. A
     chat hand-off is widget-shell's `HandOffButton` (`action` from `HAND_OFF_ACTIONS`: one Lucide
     icon and one verb naming the chat per function), a secondary outline after the action it
     accompanies (in a view's bar its toolbar button); `scanGlyphs` bans sparkle icons and an
     ESLint gate a raw `AskAiButton`, so a new function goes into widget-shell's table.
   - **Brand gates and glossary.** Every widget package runs the gates of
     `@miragon/pulse-ui/testing` (`catalogTextFindings`, `scanGlyphs`, `scanIconSizes`,
     `scanColors`) in its own `brand-gates.test.ts` (the host bundle's `src/ui` runs
     `scanGlyphs`; widget-shell checks its words next to its catalogs, in
     `packages/core/widget-shell/src/ui/kit-words.test.ts`), and its en/de catalogs hold the same
     keys; the VS Code extension runs `scanGlyphs`, `scanIconSizes` and `scanColors` over its
     webview (`apps/vscode/test/architecture/brand-gates.test.ts`, its 12 px icons the named
     deviation of the design section). One term per thing across the product, the VS Code
     extension included: `PRODUCT_GLOSSARY` (`@miragon/pulse-ui/testing`, with the brand gates; Incident,
     "Jobs ohne Versuche" / "jobs without retries", "bereitstellen", Geschäftsschlüssel,
     aussetzen, Versuche, alle Engines, ein Profil "abgelehnt" / "refused"), checked with each
     connector's own terms by `src/messages/glossary.test.ts` and listed in
     `src/messages/GLOSSARY.md`, and over the
     extension's sources by `apps/vscode/test/architecture/product-words.test.ts`, whose promise
     scan also refuses a text that promises a later feature (its rules in
     `apps/vscode/test/architecture/support/promise-words.ts`, of which Pulse for Orca's gate
     holds a copy). The counts
     both tools show take the words of `COUNT_TERMS` (owner decision E2): "Incidents" are the open
     incidents of the thing shown, "With incident" the instances that have one, and a count's
     header names its version scope. A feature more than one surface shows (boards first) shows
     the same numbers on every surface, from one builder over one read (owner decision D2 of
     2026-11-12, amending E2); elsewhere a tool keeps its own numbers behind the same words until
     its view moves onto shared numbers.
   - **Locale on the server.** Tool results for the model are English only (the engine module's
     cockpit facts are JSON keys); a
     verdict travels as data and the widget words it in the host's language. The server never
     titles a view.
   - **Everything a widget tells the model is built by `askAiPrompt`/`modelContextText`**
     (`packages/core/widget-shell/src/ui/ask-ai-prompt.ts`). A hand-off is posted as the
     USER's message, so engine text (messages, names, business keys) goes into `untrusted`,
     fenced and length-capped; ids and facts go in as typed values (a value that is not
     id-shaped is demoted to `untrusted`); intents and summaries are static catalogue text. A
     hand-off names no tool of any module: playbooks, the engine-pinning rule and when to use
     which tool live in the module `instructions` and the tool descriptions.
     `scripts/hand-off-refs.test.mjs` checks every widget source for it; that the server
     instructions name only tools a toolset registers is the app's `tools-list.golden.test.ts`.

7. **Shared server data paths are single-sourced.**
   - Definition name/version/instance lookups come from
     `packages/connectors/engine/engine-connector/src/data/definition-info.ts`. Every
     cockpit route has ONE builder in `src/data/` behind its `*_data` feed and the start view of
     `engine_open_cockpit`, both read through its feed in `src/data/feeds.ts`.
   - Honest numbers (`data/engine-reads.ts`): **primary rows/counts propagate errors;
     enrichment degrades to `null` (rendered "—"), never 0**; totals come from `/count` or
     statistics, never a capped page or scan; a definition view spans every version of its key
     (`data/honest-numbers.test.ts`).
   - No view payload carries BPMN XML (a view tool's `structuredContent` reaches the model on
     some hosts): a view names the version it draws (`diagramDefinitionId`) and `BpmnDiagram`
     reads the XML from the app-only `engine_bpmn_xml_data`. The ONE XML read is `lib/bpmn/definition-xml.ts`, cached per
     engine client and per caller.
   - The process flow's "Throughput" (`data/activity-throughput.ts`) reads the engine's history
     statistics, which load its database (measured 2026-11-08): a fixed 30-day window, cut to the
     shortest `historyTimeToLive` of a version that ran in it or could have, and said so (0 days:
     no window, nothing read); counts first, over the likely versions and six older ones at most
     (the rest named as not counted), so a version without an instance in the window is never
     read; one statistics read at a time per engine (`oneAtATime`); one read
     per engine client, caller, key and window for the hour (`createCallerCache`, both in
     `lib/engine/per-engine.ts`, the XML read's cache too). Its widget query sits outside the
     cockpit's Refresh (`THROUGHPUT_QUERY_ROOT`) and never retries by itself.
   - Each engine REST rule the client defaults miss has one home, used by `tools/` AND `data/`
     (and by the CLI and the C7 adapter of the editor hosts): the pure rules (`toEngineDate`, `engineSorting`, the filters,
     `toEngineVariable(s)`, `autoTypedValue`, `incidentRecovery`, `RAW_VARIABLES`, the
     missing-resource rule `isMissing`) in `@miragon/pulse-c7-core`; the root cause of a failure
     text, the one rule every dialect shares, in the engine family's core,
     `@miragon/pulse-engine-core` (`RootCauses.of`, `RootCauses.lineOf`), which c7-core applies
     as `causeOf` (the root cause,
     else the incident's or the engine's message) for the inspect view and the CLI's jobs; the
     reads bound to the SDK (text/plain endpoints, raw variable reads, `readBatch`, queued
     batches) in c7-client's `packages/connectors/c7/c7-client/src/sdk-reads/`,
     which does not import c7-core. Dates parse in one parser, read in one of two named
     readings (`DateInputReading`: `OFFSET_REQUIRED` for the MCP tools and the C7 adapter's
     variable writes, `UTC_WITHOUT_OFFSET` for the CLI). A 404 is "none" only by `isMissing` (a 404 `NotFoundException`, a
     `QueryParamException` or one without an engine answer is a wrong REST root or request and
     fails loud): the client's reads throw every 404 and their callers decide (the connector's
     `isMissingResource`/`noneIfMissing` in `src/lib/core-adapter/engine-port.ts`), the CLI and
     the C7 adapter of the editor hosts call it. One copy is left, held equal by a test: in the leaf
     client the raw-variable flag (to `RAW_VARIABLES`, the connector's
     `src/sdk-reads.test.ts`). No client follows a redirect: a 3xx fails with a message that
     names the fix, the rule of `@miragon/pulse-http` (`packages/core/http`), the one home of it
     and of the other wire rules (the deadline to the last byte, the 64 MiB cap, Basic as UTF-8,
     one retry after a 401 only when the credential renewed, the write caveat only for a write,
     the masking, the path value rule), whose `TRANSPORT_CASES` every wiring passes against its
     loopback engine (each case its surface can express, `casesFor`). The MCP server sends
     through it: the engine connector builds each engine's credential and transport once at boot
     and hands the SDK client its `asFetch` and a `requestValidator` for the path values
     (`src/lib/engine/engine-connection.ts`), and words every failure for the model in one place
     (`src/lib/engine/engine-error.ts`, the wrong-root hint by `isUnknownEndpoint` itself). The
     CLI sends through it as well (`apps/cli/src/http/client.ts`, the connection mapped from its
     resolved configuration; its cases in `apps/cli/src/http/transport-cases.test.ts`) and words
     every failure itself (`apps/cli/src/http/errors.ts`, the wrong-root hint by
     `isUnknownEndpoint` too), and so does the C7 adapter of the editor hosts from its wire
     (`packages/connectors/c7/c7-adapter/src/engine-rest/http`: `EngineHttp` over `Http.send`,
     60 s and 64 MiB, a read-only connection the transport's `readOnly`), which words every failure
     itself (the reason of each `HttpFailure`, the root hint by `isUnknownEndpoint`) before its
     `ErrorTranslation` maps it onto the contract's failures (TLS and DNS stay `unreachable`;
     its cases in `packages/connectors/c7/c7-adapter/test/engine-rest/transport-cases.test.ts`).
     Every write tool has a
     recording-fake-engine case in `src/tools/*.wire.test.ts`.
   - **One Camunda 7 REST spec** (`packages/connectors/c7/c7-core/spec/api.json`, Operaton's,
     vendored as it is): c7-core's `generate` applies its `patches.json` (the one RFC 6902
     applier, `packages/connectors/c7/c7-core/scripts/patches.ts`) and writes the patched spec,
     which c7-client's SDK and the CLI's catalog read as a file, and the route table from it
     (`packages/connectors/c7/c7-core/src/generated/`): each operation's method, path template,
     effect, engine scope and media types, `CORE_ROUTES` the reads c7-core sends,
     `@miragon/pulse-c7-core/routes` all 399. Whether a request only reads is
     `intentOf(routeOf(…))` over it (literal segments before placeholders; an unknown request
     reads only as a GET or a HEAD), and `failureOf` reads an error answer, so a surface that
     sends through `routedTransport` keeps no table of its own: the server's composites go out as
     routes of `CORE_ROUTES` through its client (`src/lib/core-adapter/engine-port.ts`), and the
     intent of each SDK request comes from `@miragon/pulse-c7-core/routes`, so a reading POST
     never carries the write caveat; the C7 adapter's inspection goes out as routes of
     `CORE_ROUTES` over its `EngineHttp` (`HttpEngineTransport`). The effect rule
     (`packages/connectors/c7/c7-core/scripts/effects.ts`) has one home: the CLI's catalog takes
     each effect from the table.
   - The workflow rules the CLI and the read composites (`engine_inspect_process_instance`,
     `engine_status`, `src/lib/core-adapter/composites.ts`) share live in
     `@miragon/pulse-c7-core`: selection, the root cause (`causeOf`), the composites' paging and
     caps, the ONE incident mask and cause (`messageSignature`, `causeKeyOf`: the status groups, the
     verdict's largest cause, the cockpit's cluster ids) and the ONE live verdict (`engineVerdict`:
     `engine_status`, `pulse status` and the cockpit's health route, `ok | warning | critical`;
     the MCP server's thresholds from `ENGINE_HEALTH_*`, the CLI's the defaults 50/25), a
     threshold breach a critical `INCIDENTS_CRITICAL` finding; the
     connector's port (`src/lib/core-adapter/engine-port.ts`) maps each operation to an SDK or
     SDK-bound read. Deliberate carve-outs: the composites read definitions by id inside inspect (not `data/definition-info.ts`;
     `definitionKeyOf` only as a fallback), send UTC `+0000` dates (`engineFormat`, not
     `toEngineDate`), and count overdue jobs from a capped scan of 1,000 per key, named in
     `truncated` (not a `/count`). The MCP side caps the result lists c7-core leaves uncapped
     for the CLI (wait states, incidents, timeline, variables, definitions, topics) and names each
     cut in `truncated`; c7-core still loads them whole.
   - **Caller identity** is read once per request by the MCP middleware
     (`installMcpRequestContext` → `callerUserId` in `packages/core/widget-shell/src/caller.ts`),
     from the server's own OAuth only: nothing a client chooses (a session id, a header)
     identifies a caller. Code reads it through the ambient request info (`getMcpRequestInfo`):
     per-caller caches key on `callerCacheKey`, passthrough auth forwards the caller's bearer
     token (under OAuth the one the gate verified; a header with a second credential gets 401).
     Without OAuth there is no caller: a request still caches apart by its bearer token,
     and one without a token shares the empty cache partition.

8. **Modules are self-contained peers; an MCP server app is a thin composition root.** The
   package rules hold for every workspace package, the composition-root rules for MCP server
   apps (this repo's and the template's).
   - **Layout and naming** are load-bearing: the gates key on them, and a package that breaks
     the convention silently falls out of them. Connector modules live at
     `packages/connectors/<family>/<family>-connector` (npm `@miragon/pulse-<family>-connector`),
     their SDK leaves at `packages/connectors/<family>/<family>-client`, the family's domain at
     `packages/connectors/<family>/<family>-core` (the role suffixes `CONNECTOR_ROLES`; the gate
     holds the family name), the foundation packages under `packages/core/` (npm
     `@miragon/pulse-<name>`, no role suffix), apps at `apps/<dir>` (npm
     `@miragon/pulse-<dir>`); the VS Code extension is `pulse-cockpit` (vsce takes no scope);
     a family package ends in a role of `CONNECTOR_ROLES` (`-connector`, `-client`, `-core`,
     `-adapter`).
     Rules key on `@miragon/pulse-`, never on bare `@miragon/`, which other Miragon packages
     share. Gate: `scripts/check-package-naming.mjs` (`pnpm lint:naming`).
   - **Dependency edges** (`.dependency-cruiser.cjs`, `pnpm lint:architecture` +
     `pnpm lint:architecture:cli`; the closed-world rules of the editor hosts and of the two
     packages they share: `apps/vscode/CLAUDE.md`, `apps/orca/CLAUDE.md`): connectors never
     import each other, a connector imports only its
     own family's client and core (`connectors-own-their-family`) and the engine module also
     those of the dialect families (`engine-connector-spans-the-dialects`, `ENGINE_DIALECTS`:
     `c7`), clients and family cores are leaves (a dialect core's one foreign edge is engine-core's
     main entry), a family's client is imported only by its family's connector (a dialect's client
     by the engine module) and by tests, never by a family's adapter (it sends through its family's
     core and the transport), an app (the MCP server composes connectors, not their wire) or another
     package (`client-consumers`), core is the foundation and pulse-ui its leaf, no package or app
     imports an app, no cross-package deep imports. The interface apps import nothing of the
     MCP/UI/server stack, zod included. The CLI imports no workspace package except a family core it
     bundles (`@miragon/pulse-c7-core`), the profile format where it reads its profiles (what
     `profile-consumers` admits; it may bundle it with its core, `CLI_BUNDLES`) and the transport
     where it sends its engine requests (what `http-consumers` admits; it bundles it too). The
     editor hosts import only the runtime view and a family's adapter (`runtime-view-consumers`,
     `adapter-consumers`; their closed worlds let only the composition roots wire the adapter) and
     of the family cores engine-core's main entry alone, for the contract's ids and read models
     (`editor-hosts-reach-dialects-through-adapters`). The runtime view
     (`packages/core/runtime-view`) is foundation code with one edge into a family, the owner's
     decision of 2026-11-09 on #585: engine-core by its entries
     (`runtime-view-builds-on-the-engine-contract`); its core and webview import pulse-ui's
     framework-free formatters and tones (`@miragon/pulse-ui/format`, `@miragon/pulse-ui/tones`,
     which import nothing: `ui-foundation-entries-import-nothing`). Its core, ports, model reader
     and host kit stay framework-free, with nothing else of pulse-ui (its closed world's
     `pulse-ui-only-its-foundation`); the webview may import pulse-ui's React kit and stylesheet
     for shared building blocks, by the package's root and `@miragon/pulse-ui/theme.css` only
     (`webview-pulse-ui-by-its-entries`; the decisions of 2026-11-12:
     `apps/vscode/docs/adr/ui-foundation.md`, whose D9 moves the webview to React on pulse-ui in
     one switch, its rendering libraries then `react`, `react-dom` and `lucide-react` instead of
     `preact`, never widget-shell). A family's adapter imports only its
     own family's core, engine-core, the runtime view and the transport
     (`adapters-own-their-family`; the C7 adapter, `packages/connectors/c7/c7-adapter`, runs
     c7-core), never a client, its own family's included (`client-consumers`, owner decision
     2026-11-11). A family core
     (`family-core-is-a-leaf`) is imported only by its family's connector (a dialect's core by the
     engine module) and adapter and by the apps that bundle it (`family-core-consumers`,
     `CORE_BUNDLERS`); the profile format (`@miragon/pulse-profile`, `packages/core/profile`) is a
     leaf as well, which takes the text of a profile file and returns a verdict per profile as data,
     reading no file and no environment (`profile-is-a-leaf`), and only the readers of profiles
     import it: the CLI's config layer, the connections of the runtime view's host kit (where Pulse
     for VS Code and Pulse for Orca parse their project files), the engine connector's
     configuration, and tests (`profile-consumers`, `PROFILE_READERS`; the CLI, the editor hosts and
     the engine connector read their profiles with it, the connector its engines under the
     credential policy `env`: a secret only by the name of an `ENGINE_SECRET_*` variable); the
     transport (`@miragon/pulse-http`, `packages/core/http`) is a leaf too, which
     runs over an injected `fetch` on the web platform's globals, no npm package and no Node
     built-in (`http-is-a-leaf`; ESLint's `no-restricted-globals` keeps out what only a browser
     has, `HTTP_BROWSER_GLOBALS`) but in the loopback engine of its conformance cases
     (`@miragon/pulse-http/testing/loopback`: node:http, node:https and node:crypto alone,
     `http-loopback-only-its-sockets`, a project of its own with Node types; no other module of
     the package reaches it, `http-is-a-leaf`), and only where a surface sends its engine
     requests is it imported: the CLI's `src/http`, `src/auth` and `src/operation`, the src of a
     family's adapter of the runtime view, a connector's `src/lib/engine` (where the engine
     connector sends through it, behind `resolveEngine`/`withEngine`; never its tools, data
     builders or widgets), and tests anywhere, never the MCP server app's shipped code
     (`http-consumers`, `HTTP_USERS`; in the C7 adapter only its wire, `src/engine-rest/http`, by
     its closed world's `http-only-in-the-wire`, and only by the main entry); the
     engine family's core (`@miragon/pulse-engine-core`,
     `packages/connectors/engine/engine-core`) is a family core like any other, importing only its
     own modules (`family-core-is-a-leaf`), and is imported only where a dialect is implemented,
     the `src` of a dialect's core (`ENGINE_DIALECTS`, never its `./testing` entry), its main
     entry alone (`family-core-is-a-leaf`; c7-core takes `RootCauses` from it, so the CLI
     bundles it with c7-core and never imports it), and the src of a family's adapter
     (`ENGINE_CORE_IMPLEMENTERS`), where the runtime view reads the contract's answers, its
     layers `src/ports`, `src/core`, `src/model` and `src/host-kit` (never its webview) and the
     editor hosts' src (`ENGINE_CORE_READERS`; the closed worlds hold them to the main entry and
     their tests and dev harnesses to the package's entries), and by test files and test-support
     anywhere and the test trees of the runtime view and the adapters (`ENGINE_CORE_TESTS`);
     never the engine connector (although it is its own family's core) or the CLI until they
     serve a second dialect, another family's core or a `./testing`
     entry, which ships (`engine-core-consumers`), and it keeps the extension's ESLint house
     rules, its config files included, with the connector resource gate in their union; and no
     shipped code imports a `./testing` entry (`shipped-code-not-to-testing`).
     The family rules key on the roles, so a
     new family inherits them. The seams keep browser code apart from the server: widget-shell's
     view half (`src/ui`) imports only itself, `src/protocol` (the wire both halves share: tool
     results, the view name, the served fonts, the translator, the BPMN-name reader) and the
     view stack (`widget-shell-views-browser-only`); its server half never imports `src/ui` or
     React (`widget-shell-server-headless`); `src/protocol` imports nothing but itself
     (`widget-shell-protocol-is-a-leaf`); its `tsconfig.widgets.json` (DOM, no Node types) and
     `tsconfig.json` (Node, no DOM) split the types the same way. A connector's `src/widgets`
     and `src/lib/shared` import at runtime only an allowlist
     (`connector-widgets-are-browser-code`): its own widgets, `src/lib/shared`, `src/messages`,
     `src/tool-names.ts`, the view models, `src/bpmn-names.ts`, widget-shell's `/widgets` and the
     view stack; anything else of the connector, its client, a server package or a Node built-in
     only as a type, and the other lib folders not even as a type
     (`connector-widgets-only-shared-lib`). Inside a connector the edges point one way: `src/data`
     and the lib folders (`src/lib/engine` routing, `src/lib/core-adapter` the c7-core port,
     `src/lib/bpmn` BPMN and task forms, `src/lib/mcp` the tool surface, `src/lib/shared` what the
     widgets share) never import `src/tools`, `src/widget-tools`, `src/widgets` or the
     connector's root (`src/index`, `src/plugin`, `src/module`)
     (`connector-data-and-lib-point-down`). Each rule has planted violations in
     `scripts/dependency-cruiser-gates.test.mjs`; a new app adds its npm name to the config's
     `APP_PACKAGES`. A rule names all three shapes an import reaches it in
     (a relative escape, `<importer>/node_modules/<name>/`, a bare specifier) and never exempts a
     package's own directory in a `pathNot`.
   - **The module port.** Each module exports its definition in `src/module.ts` (config schema,
     `configFromEnv`, `knownEnvVars`, `referencedEnvVars` (the variables its own settings name,
     which the typo warner then knows), `toolsets`, `bootWarnings`, `instructions`, the rules for
     every tool instead of 60 descriptions; plugin factory), conforming STRUCTURALLY to
     `ComposableModule<TShared>`. Its `createPlugin(config, shared)` returns a `ModulePlugin`,
     `{ name, register(server) }`: `register` puts every tool, prompt and resource of the module
     on the `ModuleServer` the boot hands it, the official SDK's API itself
     (`Pick<McpServer, "registerTool" | "registerPrompt" | "registerResource">`, so ext-apps'
     `registerAppTool` and `registerAppResource` work on it too), and `name` is the owner the
     duplicate guards name. Pulse adds no facade over
     the SDK: helpers that return config parts (`showToolBinding`, `appOnly`, `strictToolInput`)
     and the registrar, which registers through the SDK's own `registerTool`. A resource is for
     what a customer's module brings itself: a finished HTML view, bound by
     `showToolBinding(name, title, { resourceUri, csp })`, which an npm package ships without
     the server's Vite build knowing it. It pays for that: no bundle code shared, no host
     contexts from widget-shell, its CSP and its fonts its own; the boot's server-wide view CSP
     stops at bundle views. The composition machinery (selection with `module:toolset` suffixes in
     `MCP_ACTIVE_MODULES`, `resolveBoot`) lives inside the boot
     (`@miragon/pulse-widget-shell/server`); a root hands it its module list and its `shared`
     wiring and nothing about auth. The boot installs OAuth, a resource server that verifies
     bearer tokens with `jose`, from one provider's `MCP_OAUTH_*` variables (the table and the
     failure rules: `docs/mcp/operations.md`) and is authenticated exactly when it installed a
     provider, never inferred from an env var.
   - **The app composes, nothing more.** `setup.ts` holds `MODULES` and `sharedResources`, the
     `SharedResources` wiring: `shared` is the port for what the modules of a composition share
     (how a module gets another's capability, the engine module's engine access say, without
     importing it); today the app hands nothing through. Widget components and
     boot plumbing live in packages; the bundle root is
     `mountViews({ views })` (its `ViewRoot` provider order is load-bearing), the
     stylesheet pulse-ui's `theme.css` after `tailwindcss` (`test/ui-stylesheet.test.ts`).
   - **One boot.** `createComposedServer` owns the boot order and the production listener and
     takes the root's `modules` and `shared`. It records each plugin's registrations once
     (`createModuleRegistry`): a tool, prompt or resource name or a resource URI two plugins share
     fails the boot naming both owners, so does an input schema that lets an unknown key through,
     a resource under `ui://views/` (the boot's, so no module replaces a view) or a template whose
     variables could reach it, or a view-bound tool that binds neither the view of its own name,
     `ui://views/<tool>.html`, nor a `ui://` resource a module registered; it trims the input
     schemas, and every bundle view's tool gets the server-wide view CSP defaults (the served
     fonts' origin). A resource's or prompt's callback runs guarded (`module-callbacks.ts`), since
     the SDK leaves a request unanswered behind one that returns no result or throws no `Error`: it
     gets an answer naming the module, and a template's `list` that fails or hangs costs only its
     own entries in `resources/list`. Once every plugin has registered,
     it primes the one widget bundle for every bundle view, replays the recording once (what the
     SDK refuses fails the boot, not each request), and each request replays it into
     a fresh `McpServer` behind the SDK's `createMcpHandler` (stateless, no session ids; a
     registration is fixed at boot). Each MCP server app owns ONE
     `createApp(env, deps?)` (`src/app.ts`) that `src/index.ts` AND the e2e suites boot, never a
     test-only re-implementation. Readiness never probes engines (it answers 503
     only while the server drains); metric labels stay bounded (tool catalogue + known routes,
     never users or arguments). A route answers under its own path only: the listener refuses a
     raw `req.url` that is not its own normal form with 404 (`isNormalTarget`: dot and empty
     segments, a backslash, a fragment, absolute-form), a `Host` the SDK's bridge would join
     into the path or fail on (`isUsableHost`) with 400 and a method no `Request` can carry
     (`isUsableMethod`: TRACE gets that far, Node's parser answers TRACK 400 and closes a CONNECT
     unanswered) with 405, in front of the guard and OAuth, counted under `route="other"`; a
     `Request` has its dot segments resolved, so `composed-server.paths.test.ts` drives real
     sockets. The router reads the path as sent, never percent-decoded, so `/%6Dcp` is no alias of
     `/mcp` (`composed-server.edge.test.ts`). The HTTP edge guard
     (`resolveHttpEdgePolicy`) is DNS-rebinding protection in front of the OAuth gate that
     exempts `/health*` and `/metrics`; it is the ONE `Host`/`Origin` check, so never add the
     SDK's `hostHeaderValidationResponse` or a transport's `allowedHosts` next to it.
   - **No module renders another's UI.** A module's views show its own widgets over its own
     feeds (the engine module's cockpit reads the engines itself: the cross-engine landscape
     from each engine's overview and `engine_job_backlog_data`, the process flow's "Running"
     and "Throughput" from `engine_activity_statistics_data`), widget-shell keeps no host widget map, and no
     module imports another (`connectors-are-peers`). A view that composes modules goes in a
     dedicated package created with the first real one, never in the app.
     `scripts/tool-name-refs.test.mjs` checks every `<module>_…` literal against the full
     surface of the admin golden and finds no raw cross-module name; the apps the source guards
     read are listed in `APP_SCAN` (`scripts/source-scan.mjs`), where a new app adds its entry
     (an app missing there fails). Hand-offs and model contexts name no tool (invariant 6). A
     module's tool texts and instructions name only its own tools, since another module may be
     off; the app composes one module, so review holds that.
   - **A write registers only through the registrar**, whose toolset filter decides it
     (`withToolsetFilter`/`isToolInToolset` in the engine module), never an ad-hoc `toolset === …`
     compare; an in-widget write asks `engine_widget_actions_data` whether it exists. The
     registrar is also where a profile's `readOnly` holds: `withReadOnlyEngines`
     (`src/lib/engine/read-only.ts`) fails every tool without `readOnlyHint` on such an engine
     with `ENGINE_READ_ONLY` before its handler runs, and its transport refuses a write too.
   - **In-widget engine writes** run through ONE primitive, `useEngineAction`
     (`engine-connector/src/widgets/lib/engine-action.ts`): the gate (`allowed` from
     `engine_widget_actions_data` for the engine it writes to, its `readOnlyEngines` included,
     AND `available`: no write on an ended, cancelled or
     unconfirmed instance), the confirmation that names its target, the targeted invalidation
     through the view's one `QueryClient` (`useQueryClient`) and the optimistic marks
     (`WRITE_POLICY`); controls are hidden, not disabled (`src/widget-actions.test.ts`,
     `widgets/action-gating.test.tsx`). The cockpit's start route refreshes after a write
     because the tool result seeds its live feed query (`useViewData` always seeds).
   - **Vendors** are per-engine runtime config (`flavor` → `EngineProvider` in
     `packages/connectors/engine/engine-connector/src/providers/`); the port holds ONLY real
     differences (cockpit routes, branding, client hook), never an SDK mirror.

## Contracts

- **Never aggregate a RATE across engines.** Engines host different process definitions, so a
  rate or duration summed per engine measures the engine's process mix and can even invert the
  per-process truth. Cross-engine views report absolute counts plus the engine-owned backlog:
  the engine module's landscape sums counts only
  (`packages/connectors/engine/engine-connector/src/lib/shared/fleet-landscape.ts`, its test). A
  like-for-like comparison holds the process fixed.
- **Pinning is split by dependency stanza.** `dependencies`/`devDependencies` stay EXACT
  (`save-exact=true` in `.npmrc`). Consumer-shared libraries are RANGED `peerDependencies`, so
  a downstream app dedupes them (`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `bpmn-js`
  `^18.31.1`, `@miragon/pulse-ui` and `@miragon/pulse-widget-shell` as `workspace:^`, packed to
  `^<version>`), each also an EXACT devDependency. `bpmn-js` is a peer of widget-shell
  (`./widgets` exports the BPMN viewer, so every view bundle imports it) and of the engine
  connector, which draws diagrams. A published package imports only what its `dependencies` or
  `peerDependencies` declare (`scripts/published-imports.test.mjs`), and its tarball ships no
  test, every module its entries reach and every source its maps name
  (`scripts/pack-contents.mjs`, run by `scripts/test-template.sh`): each library ships `dist`
  and its `src` (a connector's is the template's reference implementation). The official SDK
  (`@modelcontextprotocol/server`, `/node`, `/ext-apps`) follows the same split: a ranged peer
  where a module types against it (a caret range that admits widget-shell's pin), else an exact
  dependency of widget-shell; its `App` keeps no React context, so no SDK package needs an exact
  peer pin. A server that installs an npm module peering ext-apps also pins ext-apps at
  widget-shell's version, or its strict peers check nothing: the starter's
  `server/test/pins.test.ts` holds such a pin once it is set, and nothing demands one. Name the SDK ranges a package needs in its README. Each package the template lists it
  pins as the workspace does (the `@miragon/pulse-*` libraries, the `@modelcontextprotocol/*`
  packages, the inspector the dev loop starts among them, `react`, `react-dom`, `zod`,
  `lucide-react`, `@tanstack/react-query`, `prettier`, `prettier-plugin-tailwindcss`;
  `scripts/template-pins.mjs`, in `pnpm test` and `scripts/test-template.sh`), never one package
  in isolation. Dependabot's one npm entry covers the root and the template, so a grouped minor
  or patch bump moves both; a major or a
  security update can arrive for one directory only and turns `pnpm test` red until the
  template pins the same version: bump both in that pull request. A bump of a package an
  artifact bundles turns that artifact's licence test red (the licence item below) until
  `pnpm third-party-licenses` (after `pnpm build`; every package's `third-party-licenses`
  script) writes the lists again in that pull request.
- **The widget `_meta` carries two halves; never hand-write either.** `showToolBinding`
  stamps both on a view tool: MCP Apps' `ui.resourceUri` (with the flat `ui/resourceUri`, as
  ext-apps' `registerAppTool` writes it) and the OpenAI Apps SDK's `openai/*` keys; `appOnly`
  stamps a feed's `ui.visibility: ["app"]` and `openai/widgetAccessible`. For a bundle view the
  boot adds the rest: the view CSP defaults (`openai/widgetCSP`, the resource's `ui.csp`), the
  view resource's metadata; `_meta.ui` on the tool's result it stamps for every bound view. A
  view a module registers states its own `_meta.ui` on its resource, ext-apps' API, and the
  same CSP through `showToolBinding(name, title, { resourceUri, csp })`.
  `apps/mcp-server/test/widget-contract.e2e.test.ts` checks the wire **by name**
  (every `*_show_*` tool and `engine_open_cockpit` carry the widget `_meta`, every `*_data`
  feed is app-only), so the naming convention is load-bearing.
- **The tools/list wire payload is a golden, per toolset**
  (`apps/mcp-server/test/tools-list.golden.test.ts`). The ONLY update path is
  `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update` (refused in CI);
  never hand-edit a golden. `__golden__/char-budgets.json` pins each toolset's model-visible
  size, the tools/list text plus the server instructions sent at initialize (text moved into
  the instructions still counts), shrink-only: a change that makes the model read MORE text
  needs a `Ratchet-Exception:` trailer.
- **What an engine read gives and how it fails is a golden on every interface.** Against
  loopback engines (real sockets, the real `fetch`), the MCP server's
  `apps/mcp-server/test/engine-goldens/` pins `engine_list_engines`, `engine_status` and
  `engine_inspect_process_instance` as the model reads them, and the CLI's
  `apps/cli/src/cli/goldens/` what `pulse status` and `pulse inspect` print. All three
  interfaces, the C7 adapter of the editor hosts in
  `packages/connectors/c7/c7-adapter/test/goldens/`, also pin one list of
  failures: redirect, 401 per auth type, wrong root, missing resource, a secret in an engine
  text, deadline, refused, TLS, DNS, size, `€`, `.` and `..`, `//`, token line breaks, integers
  beyond 2^53. Each `__golden__/error-paths/README.md` says per case what is pinned, not
  reachable or deferred, and which later step changes a pinned bug. Each surface keeps its copy
  of the cases and the engine answers that make them (`error-cases.ts`);
  `scripts/error-path-goldens.test.mjs` holds the three copies and the case tables equal. The
  update path is each package's `golden:update`, refused in CI, never a hand edit:
  `pnpm --fail-if-no-match --filter <package> golden:update`.
- **The widget bundle has a budget.** Every view resource inlines the whole bundle, so its
  size is the cost of every render: `test/__golden__/bundle-budget.json` holds shrink-only gzip
  ceilings that `test-host/bundle-budget.spec.ts` checks; growth needs a `Ratchet-Exception:`
  trailer that says why. Two more shipped bundles have a shrink-only ceiling: the VS Code
  webview's (`apps/vscode/test/__golden__/bundle-budget.json`, gzip) and the CLI's npm dist
  (`apps/cli/test/__golden__/bundle-budget.json`, raw bytes, c7-core with engine-core's
  root-cause rule, http and profile bundled in, read by `scripts/published-imports.test.mjs`,
  which also makes it come down once the dist shrinks more than 10 % below it). The CLI's
  standalone bundle (`build/standalone`, the single executables and the image) has none.
- **Federation happens in an external MCP gateway (agentgateway) IN FRONT of this server;
  this repo builds one self-contained MCP server including its UI.** Federation was dropped
  deliberately in #162: no upstream/proxy mechanics. A gateway that terminates auth in front is
  invisible to this server: without an OAuth provider (`MCP_OAUTH_*`) it boots read-only
  with no caller identity, so
  such a deployment names its toolsets in `MCP_ACTIVE_MODULES`.
- **An artifact ships the licences of the works of others it holds** (owner decision
  2026-11-12): a generated, checked-in `THIRD_PARTY_LICENSES.txt` beside its `LICENSE`, today
  the CLI's (`apps/cli/CLAUDE.md`, "Licences"), `@miragon/pulse-c7-client`'s (its generated SDK),
  the server image's (`/usr/share/doc/pulse-server`: the view bundle's works, which the bundle
  itself never carries, for its gzip budget), the .vsix's (`apps/vscode/CLAUDE.md`) and the Orca
  plugin folder's (`apps/orca/CLAUDE.md`). The shared licence list
  `scripts/third-party-licenses.mjs` (Node built-ins only, typed by its `.d.mts`, in `scripts/`
  because apps never import each other) reads what the artifact really holds: its bundler's
  module graph (`renderedModules` for rolldown, rollup and Vite, `cssDependencies` for the
  stylesheets Vite inlines, `esbuildModules` for an esbuild metafile and esbuild's runtime
  helpers) or its generated files. A module under node_modules is its package's, a virtual module
  the bundler's (named in the artifact's layout), a file of the repository Miragon's, and one of
  Pulse's packages must share the artifact's MIT; a module that carries another work's text names
  that work (`embedded`). Anything else fails, and so does a work without a licence file unless
  the layout names a copy (`licenceFiles`). Each artifact's drift test fails while its file misses
  a work or lists one it holds no more, and its package's `third-party-licenses` script writes it;
  `scripts/third-party-licenses.test.mjs` holds the shared part to planted cases. The editor
  hosts' closed worlds allow the list Node built-ins only.
- **The server reads no `PULSE_*` variable.** PulseAudio owns `PULSE_*` and `PULSE_CLI_*` is
  the CLI's; the typo warner watches the prefix of every known variable, so one server name
  under `PULSE_` would make it warn about both in a shared environment. A server setting goes
  into its own family (`ENGINE_*`, `ENGINES_*`, `MCP_*`;
  `scripts/server-env-names.test.mjs` and the app's `test/setup.test.ts`).

## Releases

The release workflows hold the publish credentials and no pull request runs them;
`scripts/check-github-config.mjs` (`pnpm lint:github`) pins their security shape against the
workspace (its header lists each check).

- **One release-please train.** Conventional commits on `main` drive `release-please.yml`: one
  Release PR (tag `v<version>`) bumps the root, every app, the eight packages, the two private
  packages the editor hosts bundle, the Orca plugin's manifest, the template's pins and the
  c7-client User-Agent in lockstep (`extra-files` in `release-please-config.json`).
  Merging it creates the release; every publish job then waits for manual approval of the
  `release` environment gate.
- **npm:** the eight packages and `@miragon/pulse-cli` publish through
  `publish-npm-package.yml` with OIDC trusted publishing (no NPM_TOKEN, provenance attached).
  Each names this repository in its `repository` field, since npm refuses a provenance publish
  from another repository. The pack job runs `pnpm pack`, which rewrites `workspace:*` (npm's
  own pack would ship it verbatim); the one job that holds `id-token: write` runs no package
  manager. The server app, the two editor hosts and the packages only they bundle (the runtime
  view, the C7 adapter) stay private. The `miragon-ai` names
  used up to 0.20.0 are retired, and so is the npm name of engine-client, the c7 family's client
  up to 0.27 (now `@miragon/pulse-c7-client`); never reuse them. `@miragon/pulse-engine-core`
  held the c7 family's rules up to 0.27 (now `@miragon/pulse-c7-core`) and from 0.28 on is the
  engine family's neutral core, a breaking change of the same name.
- **The starter** reaches customers as `Miragon/pulse-starter`, the read-only mirror of
  `templates/composed-server` and the customer-facing composition path, through
  `sync-template-mirror.yml` after the npm publish (before it, the template's pins would not
  resolve). The sync installs and tests the template against the public registry, builds its
  Docker image, pushes the tree with that lockfile, then tags the mirror commit with the release
  tag and publishes a release there, so a starter's owner learns of a new version by watching the
  mirror's releases. A rerun creates only what is missing and never moves a published tag.
- **The VS Code extension ships as a .vsix, never through npm**
  (`.github/workflows/publish-vscode-extension.yml`): packaged without credentials, published
  to the Visual Studio Marketplace and Open VSX from one job in the `vscode-marketplace`
  environment that builds nothing; `VSCE_PUBLISH`/`OVSX_PUBLISH` are handed down by name, never
  `secrets: inherit`.
- **The Orca plugin ships into Miragon's Orca catalog, never through npm**
  (`.github/workflows/publish-orca-plugin.yml`): Orca installs a plugin from committed files,
  pinned to a commit and the hash of its files, so the built folder lives in
  `Miragon/orca-plugins` (`plugins/pulse-cockpit`, listed as `miragon.pulse-cockpit` in its
  `orca-catalog.json`), never in this repository. The workflow builds `apps/orca/dist` without
  credentials, checks it with the CLI of the Orca release CI pins and hands it, with the release
  tag and the plugin's lines of the changelog (`apps/orca/scripts/release-notes.mjs`), to that
  repository's `publish-plugin` action, pinned to a commit, with a token of the release-please
  app. The action admits only what its `sources.json` names (`pulse-cockpit` from
  `Miragon/pulse`) and merges the folder and the catalog entry through two validated pull
  requests; the job that holds the token installs nothing. Until `orca-plugins` lists
  `pulse-cockpit` in its `sources.json`, release-please.yml calls it with `publish: false`: a
  release builds and checks the plugin and publishes nothing; turning it on is that one line.
- **The server image** publishes via `publish-to-docker.yml` to
  `ghcr.io/miragon/pulse-server` with the run's `GITHUB_TOKEN`; a reusable workflow gets no
  more than its caller grants, so the `publish-docker` job grants `packages: write` itself.
  Nothing publishes to Docker Hub.
- **The CLI's binaries, image and Homebrew formula** publish via `publish-cli.yml` and
  `publish-homebrew.yml`: five Node.js 24 single executables, `ghcr.io/miragon/pulse-cli` and,
  for a stable release, the formula `miragon/tap/pulse-cli` (the executable `pulse-cli` and the
  command `pulse` linked to it) as a pull request to Miragon/homebrew-tap. The jobs that hold a
  token install nothing. A new GHCR package starts private; an organization owner makes it public
  once.

## Verification: what each check actually covers

| Check             | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`      | turbo `build` everywhere: tsc emit of the packages and server code, the server app's Vite widget bundle (`build:ui`), the CLI's tsdown bundle (`apps/cli/dist`), the declarations of the runtime view and the C7 adapter, and the esbuild bundles of the VS Code extension and the Orca plugin (`apps/orca/dist`, the plugin folder); excludes widget `.tsx` type errors in packages                                                                                                                                                                                                                                                                                                                               |
| `pnpm typecheck`  | **The only check that type-checks widget code**: `tsc -p tsconfig.widgets.json` in the engine connector and widget-shell (its view half), `tsc -p tsconfig.ui.json` (and `tsconfig.test.json`) in the server app; the runtime view per layer (`packages/core/runtime-view/tsconfig.<layer>.json`), the editor hosts per part, each with that part's runtime globals only                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test`       | Vitest unit tests, the server app's wire-contract tests and tools/list goldens (in-process boot, loopback HTTP), the engine output and error-path goldens of the three interfaces (the CLI, the MCP server and the C7 adapter of the editor hosts), the architecture tests of the editor hosts and the packages they share, the per-package coverage floors, then `node --test` over `scripts/*.test.mjs` (repo guards and gate self-tests, below the table); docs-refs, old-names and `lint:package-scripts` also run in Lint + Format; **no widget rendering** (the runtime view's webview tests render in Chromium; locally once: `pnpm --filter @miragon/pulse-runtime-view exec playwright install chromium`) |
| `pnpm lint`       | The build-free gates first (`lint:naming`, `lint:package-scripts`, `lint:github`, `lint:ratchets`, which needs `git fetch origin`), then ESLint per package incl. the pattern gates, dependency-cruiser (`lint:architecture`, `:cli`, `:vscode`, `:runtime-view`, `:c7-adapter`, `:orca`) and knip (`lint:deadcode`: everything but exports and types; `:exports`: exports and types in every workspace but the vendored docs kit), and last `lint:configs` (the config files no tsconfig holds and no package lints: `DEFAULT_PROJECT_FILES` in `eslint.config.mjs`)                                                                                                                                              |
| `pnpm fitness`    | Report: architecture graph, per-package coverage and the mutation scores of c7-core, the transport, engine-core's rules and the profile format; locally after `pnpm test` (no CI job on a pull request), else the "Mutation summary" job of `.github/workflows/mutation-nightly.yml`                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `./gradlew build` | The playground engine (`playground/cibseven-example/`): Kotlin compile + unit tests of its processes; CI "CIB Seven Example (Build + Test)", in `pnpm check:all`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `test:host`       | `pnpm --filter @miragon/pulse-mcp-server test:host`: Playwright host simulation of the **built** widget bundle behind a SEP-1865 host shim, the real `engine_open_cockpit` against a stub engine (`pinned …` scenarios are known defects, flipped when fixed); CI "Widget host simulation (test:host)"; run it for changes to widget-shell, pulse-ui, `src/ui/` or the `@modelcontextprotocol/ext-apps` pin                                                                                                                                                                                                                                                                                                        |
| Template          | `scripts/test-template.sh` (in `pnpm check:all`; CI "Composed-server template (Build + Test)"): packs the published libraries (`scripts/workspace-packages.mjs`), checks their contents (`scripts/pack-contents.mjs`), points a copy of `templates/composed-server` at them and runs its build, typecheck, test and format check, its pins matched to the workspace first (`scripts/template-pins.mjs`), then build, typecheck and test again with the fixture module `templates/fixtures/prebuilt-module` installed (`scripts/prebuilt-module.mjs`). ESLint, knip and dependency-cruiser skip `templates/`: the template's composition-root rules (invariant 8) are review knowledge                              |
| Starter engine    | "Starter try-out engine" in `.github/workflows/ci.yml` (scope `starter-engine`: `templates/composed-server/compose.yaml` and the job itself): starts that engine on Linux and checks what a Run tag bump can break (healthy within 240 s, 401 without a login, 200 for demo/demo, invoice and ReviewInvoice deployed), then reaches it from a container on `pulse-starter_default`, the network of the starter's container recipe                                                                                                                                                                                                                                                                                  |
| Docker build      | `.github/workflows/docker-build.yml`: plain `docker build` of the root `Dockerfile` (no push) on every PR touching what the build stage copies, then a check that the image holds its licence files (`/usr/share/doc/pulse-server`, Node.js's `/usr/local/LICENSE`)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Engines           | `Engines (<flavor>)` in `.github/workflows/ci.yml`: CIB seven and Operaton in Testcontainers (Camunda 7's image left Docker Hub in November 2026), running the CLI's suites and the C7 adapter's conformance laws (`test:engines`; images pinned in `apps/cli/test/integration/support/engines.ts`); the `Engines` job aggregates the legs                                                                                                                                                                                                                                                                                                                                                                         |
| VS Code smoke     | activation, every contributed command and the project file under both names in VS Code stable under Xvfb, `test:smoke` (`.github/workflows/ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| VS Code package   | `vsce package` dry run of the production build (`.github/workflows/ci.yml`): bundles and `THIRD_PARTY_LICENSES.txt` in, no sources, maps or node_modules; the webview budget is `pnpm test`'s (`apps/vscode/test/architecture/bundle-budget.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Orca plugin       | "Orca plugin (validate, check, kit tests)" in `.github/workflows/ci.yml` (scope `orca`): the built plugin folder through the CLI of a pinned Orca release, its .deb checked against the release digest and run on plain Node (`test:orca`: `orca plugin validate` and `orca plugin check`, which renders the panel once with the worker on a mock host and loads each custom editor), then the panel and the worker on that release's `orca/testing` (`test:kit`); locally `test:smoke` drives the installed Orca against the sandbox engines                                                                                                                                                                      |
| CLI jobs          | `ci.yml` in the `cli` scope: `CLI binary (<target>)` (single executable on Linux x64, macOS arm64, Windows x64), `CLI image (build + smoke)`, `CLI plugin (validate)`, aggregated by `CLI (all checks)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CI scopes         | The `changes` job runs `scripts/ci-scopes.mjs` over a PR's files and every other job runs only in its scope (a skipped job reports success); "Lint + Format" runs on every PR. A new job gets `needs: changes` and a scope; a test that starts reading a file outside its package adds that path to `PATH_RULES` or `ALSO_READ_BY`, unless that path already selects the job that runs the test (a package's code and data files select the TypeScript job)                                                                                                                                                                                                                                                        |
| Manual            | `pnpm play` (or the playground + `pnpm dev` with a `.env`), then exercise tools/widgets in the MCP Inspector it starts. The default boot is read-only; write paths need an explicit suffix: `pnpm play --admin`, or `MCP_ACTIVE_MODULES=engine:admin` in `.env`                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

The repo guards `pnpm test` runs over the real tree: docs-refs, old-names, published imports,
tool-name and hand-off references, server env names, the source scan's `APP_SCAN`, the
template's pins and shipped module list, that a test vitest runs in its package holds the
sorted runtime names of every published entry, since knip reports no entry's exports
(`scripts/entry-lists.test.mjs`, owner decision 2026-11-11; its header names the form it reads),
and that only the CLI's sources set
`@miragon/pulse-http`'s `revealSecrets` (`scripts/trace-secrets.test.mjs`: a trace shows a
request's secrets only for its `--show-secrets`, owner decision 2026-11-10). Besides the dependency-cruiser and ESLint self-tests
(invariants 8 and 1), the naming, package-scripts, ratchet, GitHub-config, CI-scope, entry-list and pack-content checks each prove
themselves on planted violations in fixtures; the gates of the editor hosts and of the packages
they share live in the `test/architecture` of `apps/vscode`, `apps/orca`,
`packages/core/runtime-view` and `packages/connectors/c7/c7-adapter`.

A green `pnpm build && pnpm typecheck && pnpm test && pnpm lint` (`pnpm check` runs them) is the minimum bar for
every change, in that order (`scripts/published-imports.test.mjs` reads the built CLI bundle);
widget changes additionally need `test:host` plus a manual render check in the MCP Inspector (the
host simulation renders one real view, not every widget's data path).

**Ratchets only move one way.** `scripts/check-ratchets.mjs` (`pnpm lint:ratchets`) compares
each against the merge base with `origin/main`, and its header lists them: coverage floors in
each `vitest.config.ts` rise (raise one when you better a file); a `stryker.config.json`'s
`mutate` allowlist (the tested surface; today c7-core's, the transport's, engine-core's three
rule files and the profile format's) grows and its `thresholds.break` rises; the ESLint budgets
(complexity 15 and 400 lines; the CLI, the editor hosts and their packages 10 and 300), knip ignores (each
with its reason), the char and bundle budgets (Contracts) and inline suppressions only shrink;
gate commands stay as they are; a second config that would shadow a ratcheted one fails. The one
escape is a `Ratchet-Exception: <reason>` commit trailer, which turns the failures into warnings
for the reviewer; never weaken the checker instead. The trailer covers the commit that carries
it: the checker replays the range commit by commit and waves a violation only when every commit
that makes it carries one; a commit that brings a ratchet file back to a path the merge base
holds (after another commit removed it) makes what that file changes against the base's.
`pnpm lint:package-scripts` holds a package's first configs: every package with `src/` has a
`vitest.config.ts`, a valid `stryker.config.json` sits in each package `MUTATED_PACKAGES`
lists and in no other, and every program of a package (each tsconfig, the nested editor projects
included) compiles with `verbatimModuleSyntax` and `isolatedModules`, so tsc refuses a type
re-exported without `type`, which vitest would keep as a name without a value
(`scripts/module-syntax.mjs`; `MODULE_SYNTAX_EXEMPT` leaves out the server app, which publishes
no entry). With both, an import or re-export whose names all carry an inline `type` stays in the
emitted JavaScript as a side-effect import, so ESLint refuses it
(`@typescript-eslint/no-import-type-side-effects`, the config's own
`pulse/no-export-type-side-effects`) and reads JSX with the automatic runtime (`jsxPragma: null`),
which reports a namespace import that only types use (`scripts/eslint-gates.test.mjs`).

**Mutation testing covers `@miragon/pulse-c7-core`, `@miragon/pulse-http`, the rules of
`@miragon/pulse-engine-core` and `@miragon/pulse-profile`** (owner decisions: c7-core, engine-core
until 0.27, 2026-11-04; the profile format 2026-11-07; the transport 2026-11-08; engine-core's
rules 2026-11-09). c7-core holds the pure engine rules of the Camunda 7 REST family, the
transport the wire rules the CLI, the MCP server and the editor hosts share and the OAuth client
protocol of every surface (`/oauth`), and the profile format the rules that decide which secrets,
variables and URLs all of them accept (its `src` without the tests, `index.ts` and `testing/`;
StrykerJS mutates nothing under an `as`, so only the tests hold the `as const` tables of its
`types.ts`); engine-core's root-cause, value-kind and move-reason rules
(`packages/connectors/engine/engine-core/src/model/root-causes.ts`, `value-kinds.ts` and
`move-reasons.ts`, its only mutated files; `RootCauses` was mutated with c7-core until it moved)
are the contract's rules a dialect applies: `RootCauses` in all three interfaces (the CLI and the
MCP server reach it through c7-core), `ValueKinds` and `MoveReasons` today in the editor hosts
alone (the runtime view's core and the C7 adapter). A surviving mutant there is a wrong rule
everywhere it runs; in every other package a full run costs more than it finds. A package joins
only by an owner decision, as an entry in `MUTATED_PACKAGES` (`scripts/check-package-scripts.mjs`).
It runs nightly (`.github/workflows/mutation-nightly.yml`), never on a pull request (owner
decision); a pause flips `scripts/mutation-pause.mjs` and drops the schedule. Locally:
`pnpm --fail-if-no-match --filter @miragon/pulse-c7-core exec stryker run`, the same with
`@miragon/pulse-http`, `@miragon/pulse-engine-core` and `@miragon/pulse-profile` (`--mutate <file>`
narrows it), with each package's `vitest.stryker.config.ts`: coverage off, since a threshold
failure would read as a killed mutant.
