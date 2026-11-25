# CLAUDE.md

Guidance for AI agents working in this repository.

Each rule below names the gate that enforces it; when a gate fails, its message and source carry
the details. A rule without a gate is review knowledge and keeps its reason. This file holds what
spans the repository; each interface app keeps its own rules in its own agent file
(`apps/web/CLAUDE.md`, `apps/cli/CLAUDE.md`, `apps/vscode/CLAUDE.md`, `apps/orca/CLAUDE.md`).
Write a rule once, where it belongs, as one sentence with its gate or its reason; how a gate
works belongs in the gate, and when a decision came in its commit or ADR.

## Docs

Docs are held to the code: `scripts/docs-refs.test.mjs` checks the tracked Markdown (every
backticked tool name is registered, every repo path exists, the identifiers of the skills and
nested agent files exist, each docs page keeps its line budget), `scripts/old-names.test.mjs`
fails on a retired name, and `pnpm lint:package-scripts` fails on a `--filter` naming no
workspace package or lacking `--fail-if-no-match` on a gate path (pnpm 10 exits 0 when a filter
matches nothing).

`docs/` is the docs site (VitePress on `@miragon/docs-starter`, skill `miragon-brand:docs-site`),
a folder per interface. `.github/workflows/docs.yml` builds it on a pull request and publishes it
to https://miragon.github.io/pulse/ only with a release (`pnpm lint:github`). A user-visible
change (env vars, tools, ports, getting-started steps) updates the docs in the same PR. Below 1.0
there is no upgrade page and no migration note: a breaking change says so in its commit (`!` plus
a `BREAKING CHANGE:` footer). Headings get GitHub's anchors, so a `#anchor` link works on the site
and on GitHub. The product page https://miragon.ai/tools/pulse/ lives in Miragon/miragon-ai-docs;
a change it shows needs a PR there too.

## What this repo is

Pulse (part of the Miragon AI tool family) is a pnpm + Turbo monorepo for Camunda 7 / CIB seven
BPM operations: an MCP server on the official MCP TypeScript SDK (`@modelcontextprotocol/server`,
with MCP Apps widgets through `@modelcontextprotocol/ext-apps`), a web app that shows those views
as pages of the server, a CLI and two editor hosts for the same engines.

- `apps/mcp-server/`: the MCP host: composes the modules, bundles the widget UI, serves HTTP on
  `:8400`
- `apps/web/`: the web app (`@miragon/pulse-web`, private), the server's views as pages under
  `/app`
- `apps/cli/`: the CLI (npm `@miragon/pulse-cli`), every engine REST operation as a command plus
  the workflow commands
- `apps/vscode/`, `apps/orca/`: Pulse for VS Code (`pulse-cockpit`, a .vsix) and Pulse for Orca
  (`@miragon/pulse-orca`), the editor hosts of the runtime view
- `packages/connectors/engine/engine-connector/`: the engine module, the one MCP module of every
  dialect: tools, widget tools, widgets, the web app's screen feeds
- `packages/connectors/engine/engine-core/`: `@miragon/pulse-engine-core`, the contract every
  dialect implements (`ProcessRuntime`, `ProcessCommands`, ids, read models, `RuntimeError`,
  `RootCauses`) and its conformance kit (`/testing`)
- `packages/connectors/c7/`: the Camunda 7 REST family: `c7-client` (the generated SDK), `c7-core`
  (the pure rules, the one spec and its routes, the contract's reads in `./runtime`) and the
  editor hosts' private `c7-adapter`
- `packages/connectors/c8/`: the Camunda 8 family: `c8-core` (`C8Runtime`, `C8Failures` over a
  transport port) and the editor hosts' private, read-only `c8-adapter`
- `packages/core/ui/`: `@miragon/pulse-ui`, the design kit and theme (`theme.css`), the BPMN
  diagram for any page (`/bpmn`, bpmn-js its optional peer), framework-free `/format` and
  `/tones`, the brand gates in `/testing`, and its browser bundle for a page without a build
  (`dist/browser`, `packages/core/ui/scripts/browser-bundle.mjs`)
- `packages/core/widget-shell/`: the view runtime (`/widgets`), the registrar
  (`createToolRegistrar`), the boot (`/server`) with the web app's sign-in (`src/web`), a module's
  test server (`/testing`)
- `packages/core/runtime-view/`: the runtime view both editor hosts compose (private): ports,
  core, protocol, webview, model reader, host kit
- `packages/core/profile/`, `packages/core/board/`, `packages/core/screens/`: the profile format,
  the board format with its builder, the shared screens as data with their builders
  (`@miragon/pulse-profile`, `@miragon/pulse-board`, `@miragon/pulse-screens`)
- `packages/core/migration-plan/`: `@miragon/pulse-migration-plan` (private), the migration plan
  file `pulse plan-migration` writes and Pulse for VS Code previews
- `packages/core/blocks/`: `@miragon/pulse-blocks`, the shared building blocks
- `packages/core/http/`: `@miragon/pulse-http`, the one engine transport and its OAuth client
  (`/oauth`)
- `playground/`: the demo env (CIB seven showcase engine, Compose stack, Fly.io); `docs/`: the
  docs site
- `templates/composed-server/`: the starter for a server of your own (mirrored to
  Miragon/pulse-starter); `templates/claude-artifact/`: the template of a Claude artifact on Pulse,
  a page in claude.ai reading the engine through the server as the viewer's connector
- `apps/mcp-server/skills/pulse-artifact/`: the Claude Code plugin `pulse-artifact`, listed in
  `.claude-plugin/marketplace.json` next to the CLI's, whose skill builds such a page from the
  template

### Where code goes

Three axes decide where code goes, and they stay apart:

- **Vendor** (CIB seven, Operaton, Camunda 7): runtime config per engine, `flavor` →
  `EngineProvider` (invariant 8), never a package or an app.
- **Dialect** (an engine API family): one package family under `packages/connectors/<dialect>/`
  whose core implements engine-core's contract: `c7` (the Camunda 7 REST API all three vendors
  serve) and `c8` (Camunda 8's Orchestration Cluster REST API, read-only; the server offers it in
  the engine list, the boards, the web app's screens and their JSON for the model, the chat's
  views on boards only: `docs/mcp/camunda8.md`). `DIALECT_FAMILIES` and `ENGINE_DIALECTS` in `.dependency-cruiser.cjs`
  name them. A new dialect is a family, never an MCP server app or a module of its own.
- **Interface** (how a person or an agent reaches an engine): an app under `apps/` with its own
  agent file. Apps never import each other, and no package imports an app; what the editor hosts
  share is the runtime view and the adapters, private packages only they bundle.

Above the dialects stands the engine family (owner decisions 2026-11-07 to 2026-11-09): ONE MCP
server app, ONE module, `engine`, for every dialect (`engine-connector-spans-the-dialects`; a
dialect joins `ENGINE_DIALECTS` in the commit that first imports it), ONE contract core,
`@miragon/pulse-engine-core`.

A family's packages are named `<family>-<role>` (`CONNECTOR_ROLES`): `-connector` (the MCP
module; its tool input schemas live next to the tools in `src/schemas/`, so a client carries no
zod), `-client` (the wire), `-core` (the family's pure domain, one port per family, extracted on
its second consumer or ahead of it) and `-adapter` (the contract for the editor hosts, proven by
engine-core's conformance kit on a real engine; Camunda 8's locally only until #531). Family code
stays in its family; `packages/core/` holds what every family builds on. engine-core stays narrow:
a port, read model or rule enters it when two dialects answer it with the same meaning, proven by
the conformance laws on both (what the owner admitted ahead of that, its README lists); ports only
the editor hosts need (`EngineAdapter`, the engine's web UI, the local model) stay in the runtime
view's `src/ports`. The CLI importing it waits until it serves a second dialect.

### What the surfaces share

The surfaces (the MCP widgets, the editors' webview, the web app) share a core up to building
blocks, not everything (owner decision 2026-11-12, `apps/vscode/docs/adr/ui-foundation.md`): the
formats (the board file first), the engine reads and their rules (c7-core), the numbers and view
models of a feature more than one surface shows, built once and framework-free (the board and
screens builders, D8), and building blocks that take props and callbacks only, with no host
context inside (no `useToolQuery`, `ConfirmDialog`, `HandOffButton` or `HostBridge`): a primitive
in pulse-ui, an engine block in `@miragon/pulse-blocks`. Each surface keeps its own screens and
host wiring; where two show the same thing, a shared block is the default, and none is forced to
replace its screen. Every UI is React on `@miragon/pulse-ui` in one compact look (D9);
widget-shell is the view runtime of the MCP widgets and the web app, never the editor hosts'.
`docs/vscode/parity.md` lists what still differs.

## Commands

```bash
# From a fresh clone with Node, pnpm and Docker only (no JDK, no .env; scripts/local.mjs):
pnpm play                            # install, playground up, build, MCP server on :8400 + MCP Inspector
pnpm play --web                      # plus the web app on :8400/app, signed in through Keycloak
pnpm play:cli -- ping                # the built CLI against the playground engine
pnpm stack:up | stack:down | stack:status   # the playground in Docker (--multi-engine, --auth)
pnpm check                           # the local bar, one log per step in reports/check/
pnpm check:all                       # plus test:host, test:web, template, Gradle, docs build, engine suites
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

`pnpm play` and `pnpm dev` serve `http://localhost:8400/mcp` (rebuilding the view bundle and
restarting on changes to the app; a package's change needs its build) and start the MCP Inspector
on `127.0.0.1`: open the URL it prints and render widgets in its Apps tab. It has no chat, so a
hand-off and a view's model context show only in a real host, which reaches a local server
through a tunnel (`cloudflared tunnel --url http://localhost:8400`, then `MCP_URL` set to its
`https://` origin, or the `Host` check refuses it).

If generated SDK files look wrong (`client.gen.ts` importing `./src/hey-api.js`), the turbo cache
replayed a poisoned `generate`: `pnpm exec turbo run generate --filter=@miragon/pulse-c7-client --force`.

## Design-System (verbindlich)

Alle UI-Arbeit folgt dem Miragon-Design-System für Produkte, Quelle der Wahrheit ist die Skill
`miragon-brand:modeler-tool-design` (ohne Plugin:
https://raw.githubusercontent.com/Miragon/corporate-identity/main/plugins/miragon-brand/skills/modeler-tool-design/assets/modeler-design-system.md);
für jedes Wort in der UI gilt zusätzlich `miragon-brand:brand-tone`.

Die Marken-Tokens (`cd-tokens.generated.css`) vendort `@miragon/pulse-ui` unverändert
(`packages/core/ui/src/tokens/`) und bildet seine Rollen in Hell und Dunkel darauf ab; keine
HEX-Werte forken. Die App (`apps/mcp-server/src/ui/globals.css`) und das Starter-Template
(`server/src/ui/brand.css`) importieren `@miragon/pulse-ui/theme.css` nach `tailwindcss` und
überschreiben nur Rollen- und Alias-Variablen (`--primary`, `--link`, `--focus`, `--<ton>`,
`--<ton>-soft`, `--<ton>-ink`, Radien, Schatten), nie `--cd-*`; Komponenten nutzen nie
Palettenklassen oder rohe Farben. Ein `--cd-*` steht nur in den Kopien, die
`.miragon/brand-assets.yaml` vendort (`SANCTIONED_TOKEN_MANIFESTS`, Prüfsummen in
`.miragon/brand-assets.sha256`); eine weitere kommt mit `brand-assets.mjs --add`, nie als Ausnahme
im Scan. Setzen mehrere Kopien ein Token im selben Geltungsbereich, hat es überall denselben Wert,
auch im Doku-Kit (`packages/core/ui/src/theme/token-drift.test.ts`). Die Docs-Site hebt
`@miragon/docs-starter` mit jedem Kit-Release. Nennt die Wurzel weder `data-theme` noch
`data-cd-theme` noch `data-theme-mode`, folgt `theme.css` dem OS (`prefers-color-scheme`), ohne
Skript der Seite (#661); ein Host, der eines davon setzt, entscheidet allein, und die Kopien der
dunklen Rollen hält `theme-css.test.ts` gleich.

UI-Texte gibt es auf Deutsch und Englisch nach Host-Locale. Deutsch folgt brand-tone vollständig:
du-Ansprache, AI statt `KI`, „CIB seven“, kein Gedankenstrich als Verbinder, normale Groß- und
Kleinschreibung, Fehlermeldungen sagen, was passiert ist und was du tun kannst. Englisch: Sentence
case, aktiv, kein Em-Dash als Verbinder. `.miragon/brand.json` schaltet den brand-lint-Hook ein;
Strings in `.ts`/`.tsx` prüfen die Gates aus `@miragon/pulse-ui/testing` (Invariante 6).

### Abweichungen für eingebettete Chat-Widgets

Bewusste Abweichungen vom Guide für die Widgets im Rahmen eines Chat-Hosts (Owner-Entscheidung,
nur hier dokumentiert):

- Theme: Die Widgets folgen dem Host-Theme (#339) ohne Umschalter, ohne Host dem OS. Die neutralen
  Rollen nehmen die `--cd-ui-*`-Rollen des Guides wie die Webview, keine eigenen Aufhellungen von
  `--cd-schwarz` (D9); pulse-ui folgt auch `data-cd-theme`, `data-cd-kontrast="hoch"` und
  `forced-colors`. Dunkel folgt den Dark-Ground-Regeln der CI (Text Weiß, Links `--cd-gruen`,
  Buttons `--cd-blau`, Fokus `--cd-blau-hell`, Status in den `-hell`-Werten ohne getönte Flächen).
  Der Host setzt nur die neutralen Rollen (`HOST_TOKEN_MAP`), nie `--primary`, `--link`,
  `--focus`, `--ring`, `--input`, `--accent` oder einen Status; fallen Grund und Fläche zusammen,
  trennen 1-px-Linien.
- BPMN-Leinwand (D10, Punkt 7, auch in der Web-App): folgt dem Theme wie die der Webview. Hell
  bleibt das Papier weiß; dunkel ist es der Grund, Striche und Beschriftungen im Text, Marker im
  `-hell`-Wert ihres Tons, Zähl-Badges gefüllt auf einem Ring aus Papier. Hoher Kontrast: Marker
  3 px, Badges mit 1-px-Kante statt Ring. `forced-colors`: Systemfarben, weil der Browser SVG nicht
  umfärbt. Eine Seite ohne Modus an ihrer Wurzel folgt dem System. Die Werte:
  `packages/core/ui/src/bpmn/bpmn-tokens.ts`.
- Schrift: Geist, dann die Schrift des Hosts (`adoptHostFontVariables`), dann System. Der Server
  liefert Geist selbst aus (`installFontAssets`, kein CDN, `declareServedFonts` in der CSP); blockt
  ein Host den Ursprung, rendert die Host-Schrift, ohne dass etwas wartet.
- Diagrammbeschriftung (auch in der Webview, Owner-Entscheidung 2026-11-14): bpmn-js' Arial
  (`BPMN_LABEL_STYLE`) statt Geist, weil Diagramme aus dem Modeler für Arial bemessen sind und
  Geist bis zu 8 % breiter umbräche. Chrome, Tooltips, Popups, Zähl-Badges und Overlays bleiben in
  Geist.
- Sprache: Deutsch und Englisch nach Host-Locale (Fallback Englisch) statt nur Deutsch.
- Chrome im Rahmen des Hosts (Kopf mit Titel und Aktionen) statt randlosem Canvas.
- Titel: 13 px in 600 in der 40-px-Leiste; 28 px in 700 als h2 nur auf App-Ebene (Landing,
  Flotte) statt h1 mit 40 px.
- Data-Viz (Owner-Entscheidung 2026-11-24): eine einfarbige Rampe von `--cd-info-soft` bis
  `--cd-blau`, Rot nur für Incidents, nie Grün; auf dunklem BPMN-Papier von `--cd-schwarz` bis
  `--cd-blau`, aufgehellt. Die Reihen eines Diagramms unterscheiden sich in der Helligkeit,
  `--chart-1` vor `--chart-2` (die Reihenfolge steht an den Tokens in `theme.css`); nur diese
  beiden halten 3:1 auf jeder Fläche, darum zeichnen die Diagramme des Kits höchstens zwei Reihen
  auf der Rampe (`packages/core/ui/src/theme/chart-ramp.test.ts`).
- Komet nur auf App-Ebene (Landing, Erststart, „keine Engines“: `KometMark`/`AppEmptyState`); eine
  Kundenmarke blendet ihn mit `--brand-mark-display: none` aus.
- BPMN-Zoom-Leiste oben rechts, weil unten rechts das bpmn.io-Logo liegt (Lizenzpflicht).

### Abweichung Dichte, für alle Oberflächen

Alle Oberflächen haben den kompakten Look aus `@miragon/pulse-ui` nach dem Vorbild der Webview
(D9); die Dichte-Rollen in `rem` hält ein Test bei 16 px gleich zu den Shell-Tokens des Guides.
Auf Touch (`any-pointer: coarse`) und unter `[data-density=comfortable]` gilt die komfortable
Stufe (Bedienelemente 36 px, Zeilen und Toolbars 40 px, Eingaben auf Touch mit 16 px Text gegen
den Zoom von iOS); `[data-density=compact]` hält die kompakte auch auf Touch fest, so in der
Webview. Abweichungen vom Guide (Owner-Entscheidung):

- Bedienelemente und klickbare Tabellenzeilen 28 px statt 36 px, Radius sm statt md auf
  beschrifteten Knöpfen.
- Knöpfe xs mit 24 px (Hinweisstreifen, Kopieren, Tabellenzeilen), damit eine Zeile 28 px hoch
  bleibt.
- Gewicht 400 auf Toolbar-Knöpfen, Zähler als Pille, der angedockte Hinweisstreifen ohne 4-px-Kante.
- Icons 12 px mit Strich 2,5 neben dichtem Text und auf den 20-px-Overlays des Diagramms
  (`Icon` mit `dense`), sonst 16 und 24 px; 12 px nur in den Dateien, die `scanIconSizes` mit Grund
  nennt (`allowDense`).

### Abweichung für die VS-Code-Webview

Die Webview (`packages/core/runtime-view`, in VS Code und Orca) ist React auf `@miragon/pulse-ui`
(D9) ohne widget-shell: Sie rendert die View-Modelle des Kerns, behält ihre Host-Anbindung
(Push-Protokoll, Live-Updates, native Bestätigung) und teilt mit den Widgets das Fundament und die
Bausteine aus pulse-ui und `@miragon/pulse-blocks`. Ihr Stylesheet beschreibt
`packages/core/runtime-view/src/webview/styles/webview.css`. Hoher Kontrast kommt in VS Code über
`data-cd-kontrast="hoch"`, in Orca nur über `forced-colors`. Abweichung vom Guide
(Owner-Entscheidung, auch in `apps/vscode/docs/adr/user-interface.md`): Die Zähl-Badges auf dem
Diagramm bleiben gefüllte 20-px-Pillen.

## Architecture invariants

Written for the MCP server, its modules and its widgets; the package rules of invariant 8 hold
for every workspace package.

1. **New operations tools go through the registrar, never a raw `server.registerTool()`.** Add
   the Zod input schema in `packages/connectors/engine/engine-connector/src/schemas/` and register
   the tool in `src/tools/<domain>.ts` through `createToolRegistrar`'s `register` (wired in
   `src/tools/index.ts`): a `category` matching its domain file, its annotations, its mark
   `dialects` (`["c7"]` for a tool over the Camunda 7 client), `...engineParamShape` and the
   handler in `withEngine(...)` (`src/lib/engine/with-engine.ts`). Canonical shape:
   `engine_list_process_instances` in
   `packages/connectors/engine/engine-connector/src/tools/process-instances.ts`. ESLint
   (`no-restricted-syntax`) blocks a raw `registerTool` or `registerAppTool` outside the
   widget-path files; it is ONE rule, so a later flat-config block REPLACES its selectors, and a
   glob two gates share gets one block with the union (`scripts/eslint-gates.test.mjs`).
   - Annotations decide the toolset: a destructive or admin tool goes into `ADMIN_ONLY_TOOLS`
     (`src/lib/mcp/toolsets.ts`), the read-only floor holds only `readOnlyHint` tools, and every
     write states `destructiveHint`, since MCP reads an absent hint as `true`
     (`src/lib/mcp/toolsets.test.ts`, `src/plugin.test.ts`). Fix the annotations, not the test.
   - Toolsets are FAIL-CLOSED: without a suffix a module runs its read-only floor unauthenticated
     and its standard toolset (`operations`) under OAuth; `admin` is never implied, an unknown
     suffix falls back to the floor, nothing resolves to "everything".
   - Admin-only by decision: `engine_throw_signal`, the worker protocol (`engine_fetch_and_lock`,
     `engine_complete_external_task`, `engine_handle_external_task_failure`) and the reads that
     only feed an admin write (`engine_create_migration_plan`, `engine_get_batch`,
     `engine_get_activity_instance_tree`). `engine_create_deployment` registers only with
     `ENGINE_ALLOW_DEPLOYMENTS=true`: deploying BPMN/DMN is code execution in the engine JVM.
     Never relax that gate or fold it into a toolset.
   - The mark decides what is offered (owner direction 2026-11-17): every tool, feed
     (`src/data/feeds.ts`, `src/data/screen-feeds.ts`) and cockpit route (`ROUTE_DIALECTS`) names
     the dialects it serves; the boot registers it only where a configured engine serves it, a
     write only where such an engine is not read-only, and its `engine` enum offers those engines
     plus the refused profiles, so a call says why (`withServedEngines`,
     `src/lib/engine/served-engines.ts`). The tools/list goldens pin each configuration.

2. **Never talk to an engine directly.** All engine access goes through
   `resolveEngine`/`withEngine` (`packages/connectors/engine/engine-connector/src/lib/engine/`),
   by precedence: per-call `engine` > `ENGINE_DEFAULT` > the profile file's `defaultProfile` (each
   must name a profile, else the boot fails) > the only profile > `ENGINE_NOT_SELECTED`.
   `resolveRuntimeEngine` does the same for reads through the engine contract in either dialect.
   - The engines are profiles of `@miragon/pulse-profile` under its credential policy `env` (a
     secret only by the name of an `ENGINE_SECRET_*` variable). A profile the server cannot use is
     refused on its own (`engine_list_engines` lists it under `refused`), and a call to it fails
     with `ENGINE_PROFILE_REFUSED`, never rerouted. A `camunda8` profile takes none, Basic or
     `clientCredentials`; a fixed bearer token, or a credential over plain http beyond loopback,
     refuses it.
   - Before any request, `engineServing` refuses an engine of a dialect the call's mark does not
     serve with `ENGINE_DIALECT_NOT_SERVED`, never rerouted
     (`apps/mcp-server/test/dialect-refusal.e2e.test.ts`, where a new tool fails until it is
     classified).
   - There is deliberately NO per-user or in-memory selection (replica-unsafe; the server is
     stateless, one `McpServer` per request, no session ids). A client you construct or cache
     yourself breaks multi-engine routing; `resolveEngine` already returns
     `baseUrl`/`cockpitUrl`.

3. **A bundle view is registered in three places**; a view that misses one is silently absent:
   the module's view map, keyed by its view tool's name (the engine module has ONE view,
   `engine_open_cockpit` → `CockpitApp` in
   `packages/connectors/engine/engine-connector/src/widgets/views.tsx`),
   `apps/mcp-server/src/ui/view-registry.ts`, and the tool-name constants in
   `packages/connectors/engine/engine-connector/src/tool-names.ts` (the view tool and every
   `*_data` feed). `apps/mcp-server/test/view-registry.test.ts` fails on a tool without a view and
   on a view no tool opens.
   - New engine UI of the chat is a cockpit route, never a second view: a section in
     `CockpitView`, its data in `CockpitStartData`, its builder in `src/data/`, its feed in
     `DATA_FEEDS` and `src/tool-names.ts`, its entry in `COCKPIT_ROUTES` (`src/data/routes.ts`)
     and a case in `CockpitRoute` (`src/widgets/cockpit-app/routes.tsx`); the rest derives from
     them, and the compiler fails until each section has its route. A route reads one engine
     (`scope: "engine"`) or, at app level (`scope: "app"`), a board's engines or the engine list.
   - A screen of the web app's own (D10, `apps/web/src/screens`) is no view either: it reads the
     app-only `SCREEN_FEEDS` (`src/data/screen-feeds.ts`), built by
     `@miragon/pulse-screens/builder` over `runtimeOf`, and renders them with
     `@miragon/pulse-blocks`; nothing of it reaches the chat's bundle
     (`apps/mcp-server/test/view-bundle.test.ts`). Where a screen shows a place of the cockpit's,
     the page claims it (`ViewLocation.claims`) and the embedded cockpit renders nothing there.
   - A screen's or a board's JSON form reaches the model and any page outside the web app as data
     (owner decision 2026-11-24, #666; D10 holds for the screens as UI): the read-only registrar
     tools `engine_get_screen` and `engine_get_board` (`src/tools/screens.ts`), marked as their
     feeds, return `{ formatVersion, data }` from the feeds' own builders and floors
     (`src/data/json-forms.ts`), never a view and never a builder of their own; the version is the
     format's (`ScreenFormat.JSON_VERSION`, `BoardVocabulary.JSON_VERSION`), and
     `src/tools/test-support/screen-forms.ts` holds the forms.
   - The engine module's views are bundle views, never a resource of their own: ESLint blocks
     `registerResource` and `registerAppResource` under `packages/connectors/`. Only a customer's
     module may bring a finished HTML document (invariant 8, the module port).

4. **The view bundle's `resolve.dedupe` is load-bearing: never remove or trim it.** It is
   widget-shell's `VIEW_BUNDLE_DEDUPE`, spread whole in `apps/mcp-server/vite.config.ts` and the
   template's `server/vite.config.ts`. Without it a widget package bundles its own React, TanStack
   Query, pulse-ui, widget-shell or lucide-react, the React contexts no longer match, and every
   in-widget query hangs on "Loading…" (widget-shell's `src/view-bundle.test.ts`, the app's
   `test/view-bundle.test.ts`, test:host).

5. **There are three render paths; pick deliberately:**
   - Registrar tools (`src/tools/`): plain JSON data _for the model_.
   - Widget tools (`engine_open_cockpit`, a customer module's `*_show_*`; spread
     `...showToolBinding(name, title)` into `registerTool`'s config): render a view, as
     `buildViewResult(data, text)`: `structuredContent` IS the view's data, `content` the
     model-facing result (compact JSON or a short English summary). A composed view is ONE
     component that composes its widgets, never a layout the server sends.
   - `*_data` feeds (`...appOnly`, **no** view binding, `registerDataFeed`): app-only JSON for
     in-widget refresh and navigation, as `buildDataFeedResult(data)`. Hosts hide them from the
     model, and a widget-tool result would be rendered by the host instead of returned to the
     in-widget `callTool()`. A registrar tool a view reads too stays the model's and is marked
     `forViews: true` (`src/widget-reads.test.ts`; the web app's `test/page-reads.test.ts` for a
     page's calls).

   Every tool takes STRICT input (the registrar always, a raw registration through
   `strictToolInput(…)`; the boot refuses a schema that lets an unknown key through): an unknown
   key is a tool error listing the valid keys, never a silently stripped filter. A concept has one
   parameter name on every tool (`apps/mcp-server/test/strict-input.e2e.test.ts` refuses the
   retired ones), and a parameter that means the same on every tool is explained once in the
   module instructions, on a tool only where it means more there
   (`apps/mcp-server/test/tools-list.golden.test.ts`).

6. **MCP App widgets compose from `@miragon/pulse-ui` and the view runtime of
   `@miragon/pulse-widget-shell/widgets`; never re-inline their primitives.** This covers the
   React views an MCP host renders (pulse-ui, widget-shell, the connectors' `src/widgets`,
   `apps/mcp-server/src/ui/`); the web app and the webview follow the design section.
   - **Pairs.** Six cockpit views and a board have a counterpart in the VS Code webview (overview,
     process, instances, instance, incident, history). A field, count or action added to one is a
     pair feature: a shared building block is the default, each side keeps its screen and wiring,
     and the PR updates `docs/vscode/parity.md`. Which blocks two surfaces share is the owner's
     decision in review.
   - **One kit.** Primitives, components, tones (`TONE_*`, `resolveTone`), `cn`, formatters and kit
     pieces (`Icon`, `Th`/`Td`, `TableEmptyState`, `NativeSelect` …) come from pulse-ui;
     widget-shell exports only what touches the host, never a pulse-ui name
     (`packages/core/widget-shell/src/pulse-ui-overlap.test.ts`). A form says an invalid entry
     next to the control it marks `aria-invalid` (`Field`), never clamps it silently.
   - **The view runtime is widget-shell's.** In a chat its host adapter (`ExtAppsViewHost`) is the
     ONE place that speaks to the host; a page mounts through `mountApp`, `PageView` and
     `mountPage` over `BrowserViewHost` (the web app, `apps/web/CLAUDE.md`), which tree-shake out
     of the MCP bundle. Both mount the same host-agnostic contexts, as `TestViewHost` does in
     tests. Widgets reach the host only through `useViewHost`/`HostModelContext` and the query
     hooks (`useToolQuery`, `useToolQueries`, `useToolMutation`, `useViewData`) and never import
     ext-apps' runtime (ESLint `no-restricted-imports`). What a view offers follows its host:
     `followUp` (a chat posts a hand-off, a page offers `copy` or `none`), `writes` (a page writes
     nothing), `location` and `chrome` (a page's address and frame).
   - **Phases.** A host that drops `structuredContent` gets ONE re-run of the view's own tool, so
     every view-bound tool is a read. `ViewFrame` renders waiting, error, cancelled and ready, each
     the document's one `<main>`, so a view renders none; every `ViewStack` row has its own error
     boundary.
   - **States and feedback** (#322). Loading, error and empty go through `ViewDataState`, or
     `QueryFallback` + `TableSkeleton` with an `isError` branch, both with a required `onRetry`; a
     failure is worded by `describeError`, the raw engine text only under "Details". A refusal no
     retry changes (`isPermanentError`) is not retried and offers no Try again; panels that fail
     alike say it once. A refused engine, and a Camunda 8 engine in the chat, is its view's one
     state and reads nothing (`RefusedEngineGate`, `BoardsOnlyEngineGate`). A write reports
     through `useActionFeedback()` toasts that name the object and confirms through
     `ConfirmDialog`; nothing to show is `TableEmptyState`. A skeleton shows only after 400 ms
     (`SKELETON_DELAY_MS`), a refresh keeps the content with its region `aria-busy`, and a view's
     guard keeps its bar and title, so the page keeps its one `h1`. A page outside a host (an
     artifact) holds the same rules with pulse-ui's `SectionState` under one `SectionStateGroup`
     and words its transport's refusals once with `describePageError` (#664); the server's error
     texts stay `describeError`'s.
   - **Inline is a card, not a page** (#396): a list under a host shows the rows that fit the
     host's height, measured (`InlineFitBox`), never estimated; a paged list registers ONE list
     (`PagedRows` + `paged.fit`). An id in a table cell takes one line (`NamedId`, `IdText`), so a
     row keeps its height. Roots declare inline + fullscreen only (`SHELL_VIEW_CONFIG`).
   - **Tables never widen the document** (WCAG 1.4.10): `ListTable` over pulse-ui's `DataTable`
     scrolls in a named region (`ariaLabel`), drops columns (`hideBelow`) and fits a column to one
     line (`fit`). Ids show through `IdCell`/`IdText`, processes and elements through `NamedId`,
     named by ONE reader (`readBpmnNames`).
   - **Type, dates and numbers.** Text sits on `TYPE_SCALE` (13 px floor, weights 400, 600, 700;
     `scanTypeScale`); a disabled control is opaque, never faded; a section's title is
     `SectionHeading`. Dates, durations, numbers, counts and short ids go through the kit's
     `format*` helpers and `shortId` in the view's locale (ESLint's date and number gates over
     `WIDGET_TREES`); a count reaches a catalog entry formatted, and the entry puts the noun in the
     right number (`plural(…)`), never a `…One`/`…Other` key pair.
   - **BPMN** renders through pulse-ui's `./bpmn` entry, which needs no host (owner decision
     2026-11-24): `BpmnDiagram`, or `useBpmnViewer` + `BpmnZoomControls` for a drawing of a
     surface's own (the heat), on the themed canvas, every colour from `bpmn-tokens.ts`; a chat view
     hands it the host's inline budget (`useDiagramMaxHeight`). One badge scheme, the shared
     screens' (owner decision 2026-11-24): an element's counts apart over its top right corner, root
     incidents red, the incidents in called instances a quiet badge of their own, running blue; only
     an own root incident outlines the element (the editors' webview keeps its filled pills). A
     marker paints its shape's outline, never a label; the canvas alone is the image (`ariaLabel`).
   - **Paged lists** compose `usePagedListView` (an honest total; counts and model contexts read
     the payload on screen, never the request) + `ListTable` + `PagedListFooter`; optimistic state
     resets with `useResetOnChange`, never in an effect. A shared screen's list pages by cursor
     with Load more (D10), a stopped count shown as a lower bound (`≥ n`), never a capped page's
     total.
   - **A status is a tone, never a coloured word.** Each situation's tone comes from
     `SITUATION_TONES` (`@miragon/pulse-ui/tones`), never a literal: an open incident or a job
     without retries `danger`, retries left or a degraded engine `warning`, running `info`, the
     rest `neutral`, never a green "healthy"; an engine's state is its verdict's tone
     (`VERDICT_TONES`), a failed read's `READ_FAILURE_TONES`. Components use role names only
     (`scanColors`), every role pair holds WCAG AA
     (`packages/core/ui/src/theme/tone-contrast.test.ts`), and a brand override goes under `:root`
     AND the dark scopes.
   - **Numbers stay neutral** (D9): an alarming count shows its tone by an icon of its own shape
     and words (`CountFigure`, `CountBadge`; filled only on a BPMN diagram), never by a coloured
     number, a tinted pill or a tinted tile. A state in a cell or a count in a header is a
     `StateLabel`, never a tinted `StatusBadge`; when numbers were read is the bar's `freshness`,
     never a "Live" pill.
   - **Icons are Lucide**, never glyphs or emoji, through `Icon` (sizes: the density section),
     the stroke through lucide's `strokeWidth`, never CSS. Every package importing `lucide-react`
     and every host bundle pin the SAME exact version (today `1.73.0`), or pnpm resolves a second
     pulse-ui and widget-shell and splits the React contexts.
   - **Actions and hand-offs.** A view's actions are ONE group in `WidgetHeader` `actions`,
     toolbar buttons (`variant="toolbar"`, `size="sm"`) ordered: deterministic steps, the engine's
     own web app (`OpenInCockpitLink`), then the chat; the bar's facts hold facts only
     (`action-group.test.tsx`), never a count the tiles below show. A table row opens what it
     names on a click or Enter and copies its id with Ctrl or Cmd+C (owner direction 2026-11-18,
     `ListRow`); it carries no drill (`row-actions.test.ts`), and its further actions sit at its
     end in `xs`. A chat hand-off is `HandOffButton` (`action` from `HAND_OFF_ACTIONS`) after the
     action it accompanies; a new function goes into that table, never a raw `AskAiButton`.
   - **Brand gates and glossary.** Every widget package runs pulse-ui's gates (`scanGlyphs`,
     `scanIconSizes`, `scanColors`, `scanOutlines`, `catalogTextFindings`) in its own
     `brand-gates.test.ts`, the web app and the webview over their sources too, and its en/de
     catalogs hold the same keys. One term per thing across the product, the extension included:
     `PRODUCT_GLOSSARY` (each connector's `src/messages/glossary.test.ts`,
     `apps/vscode/test/architecture/product-words.test.ts`, whose promise scan refuses a text that
     promises a later feature). The words and `COUNT_TERMS` live once, as browser-safe data in
     `@miragon/pulse-ui/glossary` (`./testing` hands out the same bindings), and `docs/glossary.md`
     is generated from them (pulse-ui's `golden:update`), so a page and an agent read the table the
     gate holds.
   - **Counts mean the same on every surface.** Count words come from `COUNT_TERMS` (owner
     decision E2). "Incidents" are open root incidents (D2): a call activity's copy counts in the
     called process only. "With incident" are the instances that have one, on Camunda 7 read from
     the runtime on every history level (owner decision 2026-11-14,
     `packages/connectors/c7/c7-core/src/with-incident.ts`), never from the history, which finds
     nothing below FULL. A count's header names its version scope. A feature more than one surface
     shows (boards first) shows the same numbers from one builder over one read (D2); the boards'
     gates are each dialect's recorded answers (`C7_BOARD_ENGINE`, `C8_BOARD_ENGINE`), which the
     server's wire
     (`packages/connectors/engine/engine-connector/src/data/board-data.numbers.test.ts`) and each
     adapter must build exactly.
   - **Locale on the server.** Tool results for the model are English only; a verdict travels as
     data and the widget words it. The server never titles a view.
   - **What a widget tells the model** is built by `askAiPrompt`/`modelContextText`
     (`packages/core/widget-shell/src/ui/ask-ai-prompt.ts`): a hand-off is posted as the USER's
     message, so engine text goes in as `untrusted` (fenced, capped), ids and facts as typed
     values. A hand-off names no tool (`scripts/hand-off-refs.test.mjs`); which tool to use lives
     in the module `instructions` and the tool descriptions.

7. **Shared server data paths are single-sourced.**
   - Definition lookups come from `src/data/definition-info.ts`; every cockpit route has ONE
     builder in `src/data/` behind its feed and `engine_open_cockpit`'s start.
   - **Honest numbers** (`data/engine-reads.ts`): **primary rows and counts propagate errors;
     enrichment degrades to `null` (rendered "—"), never 0**; totals come from `/count` or
     statistics, never a capped page or scan. The named exception is c7-core's
     `ElementStatisticsReader`, which reads the incidents at a version's call activities whole to
     tell root incidents from copies
     (`packages/connectors/c7/c7-core/src/runtime/element-statistics-reader.law.test.ts`). A
     board's numbers degrade per engine and tile instead of failing the call
     (`data/honest-numbers.degrade.test.ts`).
   - **Expensive reads have floors.** What loads the engine's database (the screen feeds, a
     board's build, the cockpit's element counts, a process's numbers of `engine_process_stats`
     and `engine_activity_counts` over the cockpit's builders) is kept 30 s per caller and
     arguments (`callerCacheKey`, so a renewed token reads anew), never an answer that misses a
     part. The process flow's "Throughput" reads a 30-day window cut to the shortest
     `historyTimeToLive`, one read at a time per engine (`oneAtATime`), outside the cockpit's
     Refresh; `engine_process_stats` counts per bucket by `/count`, a bucket older than that time
     to live as a lower bound, every history count unknown where the engine writes no history.
   - **No view payload carries BPMN XML** (a view's `structuredContent` reaches the model on some
     hosts): a view names the version it draws (`diagramDefinitionId`) and reads the XML from
     `engine_bpmn_xml_data`, through the ONE cache `lib/bpmn/definition-xml.ts`.
   - **One home per engine REST rule**, used by `tools/` AND `data/`, the CLI and the C7 adapter:
     the Camunda 7 rules in `@miragon/pulse-c7-core` (dates, sorting, filters, variables,
     `isMissing`, "with incident", the root incident: `scripts/root-incident-rule.test.mjs`), the
     root cause of a failure text in engine-core (`RootCauses`), the SDK-bound reads in
     `packages/connectors/c7/c7-client/src/sdk-reads/`. A 404 is "none" only by `isMissing`, an
     engine answer that names a missing resource; a 404 without an exception type, a
     `NotFoundException` (a wrong REST root) or a `QueryParamException` fails loud.
   - **One transport.** `@miragon/pulse-http` holds every wire rule: no redirect followed, a
     deadline to the last byte, a 64 MiB cap, one retry after a 401 only when the credential
     renewed, masking, the path value rule. Every surface (the MCP server in `src/lib/engine`, the
     CLI, the C7 adapter) passes its `TRANSPORT_CASES` and words its failures itself; the Camunda 8
     words name no variable, token endpoint URL or cluster url. Every write tool has a
     recording-fake-engine case in `src/tools/*.wire.test.ts`.
   - **One Camunda 7 REST spec** (`packages/connectors/c7/c7-core/spec/api.json`, Operaton's,
     vendored as is, patched by its `patches.json`): `pnpm generate` writes the SDK and the route
     table, and whether a request only reads is `intentOf(routeOf(…))`, so no surface keeps a
     table of its own.
   - **The workflow rules** the CLI and the read composites (`engine_inspect_process_instance`,
     `engine_status`) share live in c7-core: selection, `causeOf`, paging and caps, the ONE
     incident mask (`messageSignature`) and the ONE live verdict (`engineVerdict`,
     `ok | warning | critical` over open root incidents, `ENGINE_HEALTH_*`). The MCP side caps the
     lists c7-core leaves whole for the CLI and names each cut in `truncated`.
   - **The contract's reads** are c7-core's `C7Runtime`, which the C7 adapter runs over its wire
     and the connector over the server's (`runtimeOf`), held to engine-core's laws on real engines
     (`packages/connectors/engine/engine-connector/src/lib/core-adapter/c7-runtime.engine.test.ts`).
   - **Caller identity** comes from the server's own OAuth only, read once per request
     (`packages/core/widget-shell/src/caller.ts`), never from anything a client chooses;
     per-caller caches key on `callerCacheKey` (caller and bearer token). The web app's session is
     no second source: it holds a token of the server's own sign-in that `/mcp` verifies like any
     other, its cookie is no credential at `/mcp`, and a page's call reaches `/mcp` in-process with
     that token, only for a read a view calls (`src/web/forward.ts`).

8. **Modules are self-contained peers; an MCP server app is a thin composition root.**
   - **Layout and naming** are load-bearing (`pnpm lint:naming`): connectors at
     `packages/connectors/<family>/<family>-connector` (npm `@miragon/pulse-<family>-connector`),
     their `-client`, `-core` and `-adapter` beside them, foundation packages under
     `packages/core/` (npm `@miragon/pulse-<name>`), apps at `apps/<dir>` (npm
     `@miragon/pulse-<dir>`; the VS Code extension is `pulse-cockpit`). Rules key on
     `@miragon/pulse-`, never on bare `@miragon/`.
   - **Dependency edges** (`pnpm lint:architecture`, `.dependency-cruiser.cjs`, whose messages say
     what each rule allows; the editor hosts' closed worlds in their agent files): connectors never
     import each other, only their own family's client and core (the engine module also the
     dialects'); clients and family cores are leaves, and a client is imported only by its
     connector; engine-core only where a dialect is implemented or its contract read
     (`engine-core-consumers`); adapters only their family's core, engine-core, the runtime view
     and the transport; the formats and the transport are leaves; the CLI imports only what it
     bundles, the editor hosts only the runtime view and the adapters, the web app only the page
     half (`web-is-a-page`); widget-shell's view half stays browser code and its server half
     headless; a connector's widgets import only browser code, and its `src/data` and lib folders
     never import its tools, widgets or root; no cross-package deep imports, no shipped code
     imports `./testing`. Each rule has planted violations in
     `scripts/dependency-cruiser-gates.test.mjs`; a new app adds its npm name to `APP_PACKAGES`.
   - **The module port.** Each module exports its definition in `src/module.ts` (config schema,
     `configFromEnv`, `knownEnvVars`, `toolsets`, `instructions`, plugin factory), structurally a
     `ComposableModule<TShared>`; `createPlugin(config, shared)` returns `{ name, register(server) }`,
     and `register` uses the official SDK's API itself. Pulse adds no facade over the SDK, only
     helpers that return config parts (`showToolBinding`, `appOnly`, `strictToolInput`) and the
     registrar. A customer's module may bring a finished HTML view
     (`showToolBinding(name, title, { resourceUri, csp })`) and pays for it: no shared bundle code,
     no host contexts, its own CSP and fonts.
   - **Auth.** The boot installs OAuth from one provider's `MCP_OAUTH_*` variables (the providers:
     `docs/mcp/operations.md`, `docs/mcp/identity-providers.md`), and the server is authenticated
     exactly when it installed one, never inferred from an env var. Only beside a provider does
     `MCP_WEB_CLIENT_ID` install the web app's sign-in and its routes under `/app`; without one the
     variable fails the boot.
   - **The app composes, nothing more.** `setup.ts` holds `MODULES` and `sharedResources` (the port
     for what modules share without importing each other); widget components and boot plumbing
     live in packages, and the bundle root is `mountViews({ views })`.
   - **One boot.** `createComposedServer` owns the boot order and the listener: a name or URI two
     plugins share, a schema that admits an unknown key, a resource under `ui://views/` and a view
     tool without its view fail the boot, naming the owners. Each request replays the recorded
     registrations into a fresh `McpServer` (stateless). Each server app owns ONE
     `createApp(env, deps?)` (`src/app.ts`) that `src/index.ts` AND the e2e suites boot, never a
     test-only copy. Readiness never probes engines; metric labels stay bounded (never users or
     arguments).
   - **The HTTP edge.** A route answers under its own path only (the router reads the path as
     sent, never percent-decoded). The edge guard (`resolveHttpEdgePolicy`) is the ONE
     `Host`/`Origin` check, so never add the SDK's `hostHeaderValidationResponse` or a transport's
     `allowedHosts` next to it.
   - **No module renders another's UI**, and no module imports another (`connectors-are-peers`); a
     view that composes modules goes in a dedicated package, never in the app. A module's texts
     name only its own tools (`scripts/tool-name-refs.test.mjs`).
   - **Writes.** A write registers only through the registrar, whose toolset filter decides it
     (`withToolsetFilter`), never an ad-hoc `toolset === …` compare; a profile's `readOnly` holds
     there too, and its transport refuses a write. In a widget every write runs through ONE
     primitive, `useEngineAction`
     (`packages/connectors/engine/engine-connector/src/widgets/lib/engine-action.ts`): it checks
     the host's `writes`, `engine_widget_actions_data` and the target's state, confirms naming its
     target and invalidates what it changed; controls are hidden, not disabled.
   - **Vendors** are per-engine runtime config (`flavor` → `EngineProvider` in
     `packages/connectors/engine/engine-connector/src/providers/`); the port holds ONLY real
     differences (cockpit routes, branding, client hook), never an SDK mirror.

## Contracts

- **Never aggregate a RATE across engines.** Engines host different process definitions, so a
  rate or duration summed per engine measures the engine's process mix and can even invert the
  per-process truth. Cross-engine views report absolute counts plus the engine-owned backlog
  (`packages/connectors/engine/engine-connector/src/lib/shared/fleet-landscape.ts`); a
  like-for-like comparison holds the process fixed.
- **Pinning is split by dependency stanza.** `dependencies`/`devDependencies` stay EXACT
  (`save-exact=true`); consumer-shared libraries are RANGED `peerDependencies` (React, zod,
  bpmn-js, the official MCP SDK where a module types against it, the Pulse libraries as
  `workspace:^`), each also an exact devDependency. A published package imports only what it
  declares (`scripts/published-imports.test.mjs`) and ships no test (`scripts/pack-contents.mjs`).
  Each template pins what it lists as the workspace does (`scripts/template-pins.mjs`): a bump that
  reaches one directory only goes into the others in the same PR. A bump of a package an artifact
  bundles needs `pnpm third-party-licenses` (after `pnpm build`) in the same PR.
- **The widget `_meta` carries two halves; never hand-write either.** `showToolBinding` stamps
  MCP Apps' and the OpenAI Apps SDK's keys on a view tool, `appOnly` a feed's, `forViews` a model
  tool's; the boot adds the CSP. `apps/mcp-server/test/widget-contract.e2e.test.ts` checks them
  **by name** (`*_show_*` and `engine_open_cockpit` carry the view `_meta`, every `*_data` feed is
  app-only), so the naming convention is load-bearing.
- **The tools/list wire payload is a golden** per toolset and configuration (one Camunda 7 engine,
  one beside a Camunda 8 one, a Camunda 8 one alone;
  `apps/mcp-server/test/tools-list.golden.test.ts`). The ONLY update path is
  `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`; never hand-edit a
  golden. `__golden__/char-budgets.json` pins what the model reads (tools/list plus the server
  instructions), shrink-only: more text needs a `Ratchet-Exception:` trailer.
- **What an engine read gives and how it fails is a golden on every interface**, against
  loopback engines: the MCP server's `apps/mcp-server/test/engine-goldens/`, the CLI's
  `apps/cli/src/cli/goldens/` and one shared list of failure cases in every surface's error-path
  goldens (the C7 and C8 adapters' `test/goldens/`, the server's on a Camunda 8 engine too), held
  equal by `scripts/error-path-goldens.test.mjs`. Each package updates its goldens through its
  `golden:update`, never by hand.
- **Bundles have shrink-only budgets**: the widget bundle (`test/__golden__/bundle-budget.json`,
  every view resource inlines it), the web app's page, the VS Code webview, pulse-ui's browser
  bundle and the CLI's npm dist, each in its package's `test/__golden__/bundle-budget.json`; growth
  needs a `Ratchet-Exception:` trailer that says why.
- **Federation happens in an external MCP gateway IN FRONT of this server** (dropped
  deliberately in #162: no upstream/proxy mechanics). A gateway that terminates auth is invisible
  to the server, which then boots read-only without a caller, so such a deployment names its
  toolsets in `MCP_ACTIVE_MODULES`.
- **An artifact ships the licences of the works of others it holds** (owner decision
  2026-11-12): a generated `THIRD_PARTY_LICENSES.txt` beside its `LICENSE` (the CLI, the c7
  client, the server image, the web app, the .vsix, the Orca plugin, pulse-ui for its browser
  bundle), written from what its bundler really holds by `scripts/third-party-licenses.mjs`; each
  artifact's drift test fails while the file misses a work or lists one no longer held.
- **The server reads no `PULSE_*` variable.** PulseAudio owns `PULSE_*` and `PULSE_CLI_*` is the
  CLI's; a server setting goes into `ENGINE_*`, `ENGINES_*` or `MCP_*`
  (`scripts/server-env-names.test.mjs`).

## Releases

The release workflows hold the publish credentials and no pull request runs them;
`pnpm lint:github` (`scripts/check-github-config.mjs`) pins their security shape.

- **One release-please train.** Conventional commits on `main` drive `release-please.yml`: one
  Release PR bumps every package, app, manifest, template pin and User-Agent in lockstep
  (`extra-files` in `release-please-config.json`), and the pulse-ui version a page without a build
  loads from jsDelivr in the artifact docs (a generic file's marked versions, held to the release
  by `pnpm lint:github`). Merging it creates the release; every publish job waits for approval of
  the `release` environment.
- **npm:** the twelve libraries and `@miragon/pulse-cli` publish with OIDC trusted publishing (no
  token, provenance attached), packed by `pnpm pack`. A package new to npm is published once by
  hand and gets its trusted publisher before the release that first publishes it. The server app,
  the editor hosts and the packages only they bundle stay private. Retired names (the
  `miragon-ai` packages, engine-client) are never reused; `@miragon/pulse-engine-core` names the
  neutral core since 0.28.
- **The starter** reaches customers as `Miragon/pulse-starter`, the read-only mirror of
  `templates/composed-server`, synced after the npm publish; its owners learn of a version from
  the mirror's releases. `templates/claude-artifact` has no mirror: a copy starts from a clone of
  this repository, and the `pulse-artifact` plugin installs from its marketplace.
- **The VS Code extension** ships as a .vsix to the Marketplace and Open VSX by trusted
  publishing, **the Orca plugin** into `Miragon/orca-plugins` (off until that repository lists
  `pulse-cockpit` in its `sources.json`), **the server image** to `ghcr.io/miragon/pulse-server`
  with the web app's page in it, and **the CLI** as single executables, an image and a Homebrew
  formula; none through npm. The jobs that hold a token install nothing.

## Verification: what each check actually covers

- **`pnpm build`**: tsc, the Vite widget bundle, the CLI, the web app, the editor bundles; it does
  not type-check widget `.tsx` in packages.
- **`pnpm typecheck`**: **the only check that type-checks widget code** (`tsconfig.widgets.json`,
  `tsconfig.ui.json` and the per-layer configs).
- **`pnpm test`**: Vitest, the wire contracts and goldens, the editors' architecture tests, the
  coverage floors, then the repo guards in `scripts/*.test.mjs`; **no widget rendering**.
- **`pnpm lint`**: the build-free gates (`lint:naming`, `lint:package-scripts`, `lint:github`,
  `lint:ratchets`, which needs `git fetch origin`), ESLint with the pattern gates,
  dependency-cruiser, knip and `lint:configs`.
- **`test:host`** (`pnpm --filter @miragon/pulse-mcp-server test:host`): the **built** widget bundle
  behind a host shim against a stub engine and a loopback Camunda 8 cluster; run it for changes to
  widget-shell, pulse-ui, `src/ui/` or the ext-apps pin.
- **`test:web`** (`pnpm --filter @miragon/pulse-mcp-server test:web`): the **built** web app on the
  real server under OAuth with fake identity providers (sign-in, sessions, CSRF, the screens,
  German, dark, 320 px, axe); run it for changes to the web app, widget-shell's `src/web` or the
  page root.
- **Template** (`scripts/test-template.sh`): packs the libraries and builds and tests both
  templates against them, `templates/composed-server` once more with the fixture module and
  `templates/claude-artifact` down to the three files of its `dist/`. ESLint, knip and
  dependency-cruiser skip `templates/`: their code rules are review knowledge, and
  `scripts/artifact-tools.test.mjs` holds the tools the artifact calls, each recorded answer to
  its tool's output golden by shape and each call's arguments to its input schema.
- **Engines** (CI `Engines (<flavor>)`): CIB seven and Operaton in Testcontainers running
  `test:engines`; the Camunda 8 suites run locally only until #531.
- **CI scopes**: `scripts/ci-scopes.mjs` runs each job only for the files that concern it. A new
  job gets `needs: changes` and a scope; a test that reads a file outside its package adds it to
  `PATH_RULES` or `ALSO_READ_BY`.
- Further CI jobs (the playground's Gradle build, the starter's engine, the Docker build, the VS
  Code smoke and package, the Orca plugin, the CLI binaries) are named in
  `.github/workflows/ci.yml` and `.github/workflows/docker-build.yml`.
- **Manual**: `pnpm play`, then the MCP Inspector. The default boot is read-only; writes need
  `pnpm play --admin` or `MCP_ACTIVE_MODULES=engine:admin`.

A green `pnpm build && pnpm typecheck && pnpm test && pnpm lint` (`pnpm check`) is the minimum
bar for every change, in that order; widget changes also need `test:host` and a manual render
check in the MCP Inspector.

**Ratchets only move one way** (`pnpm lint:ratchets`, its header lists them): coverage floors and
mutation thresholds rise, the mutated surface grows, the ESLint, char and bundle budgets, knip
ignores and inline suppressions only shrink. The one escape is a `Ratchet-Exception: <reason>`
trailer on every commit that makes the violation; never weaken the checker instead.

**Mutation testing** runs nightly (`.github/workflows/mutation-nightly.yml`, never on a pull
request) over the rules that run on every surface: c7-core, the transport, engine-core's rules,
the profile format, the board and the screens, widget-shell's web and OAuth rules and c8-core's
rules, each package's files in its `stryker.config.json`. A package joins only by an owner
decision, as an entry in `MUTATED_PACKAGES` (`scripts/check-package-scripts.mjs`). Locally:
`pnpm --fail-if-no-match --filter <package> exec stryker run`.
