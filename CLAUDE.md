# CLAUDE.md

Guidance for AI agents working in this repository. Read the repo skill of your feature path
before you add code: `.claude/skills/add-bpm-feature` (engine tools, queries, widgets) and
`.claude/skills/add-analytics-feature` (analytics).

Each rule below names the gate that enforces it; when a gate fails, its message and source
carry the details. A rule without a gate is review knowledge and keeps its reason.

Docs are held to the code:

- `scripts/docs-refs.test.mjs` reads the tracked Markdown (this file, the
  READMEs, agent files, skills and `docs/`): every backticked tool name is registered, every
  repo path exists, the identifiers of the skills and nested agent files exist, and each docs
  page stays within its line budget.
- `scripts/old-names.test.mjs` fails on a technical name of the retired operate CLI, on the
  unscoped npm packages pulse and pulse-cli (someone else's), on an image off GHCR, on the
  retired OAuth JSON variable, on a package of the retired MCP toolkit and on a name the engine
  module carried up to 0.24 (its `camunda7_` tools, the module name, its packages and app path,
  its `CAMUNDA_` server variables, its metric names); the vendor (`flavor` `camunda7`,
  "Camunda 7") stays.
- `scripts/check-package-scripts.mjs` (`pnpm lint:package-scripts`) fails on a `--filter`
  naming no workspace package and on a pnpm filter without `--fail-if-no-match` on a gate path
  (pnpm 10 exits 0 when a filter matches nothing, so a stale name turns a gate green).

`docs/` holds the Pulse docs, a VitePress site on the Miragon docs kit
(`docs/.vitepress/miragon/`, skill `miragon-brand:docs-site`) that `.github/workflows/docs.yml`
publishes to https://miragon.github.io/pulse/. A user-visible change (env vars, tools, ports,
getting-started steps) updates them in the same PR. Headings get GitHub's anchors, so a
`#anchor` link works on the site and on GitHub. The product page https://miragon.ai/tools/pulse/
lives in Miragon/miragon-ai-docs; a change it shows needs a PR there too.

## What this repo is

Pulse (part of the Miragon AI tool family) is a pnpm + Turbo monorepo that ships an MCP server
(built on `mcp-use`, with its UI on `@miragon/pulse-ui`) for Camunda 7 / CIB seven BPM operations
and Prometheus-backed process analytics, including interactive React widgets (MCP Apps), plus a
command line interface (`apps/cli`) and a VS Code extension (`apps/vscode`) for the same engines.

| Path                                                 | Contents                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp-server/`                                   | The MCP host: composes plugins, bundles the widget UI, serves HTTP on `:8400`                                                                                                                                                                                     |
| `apps/cli/`                                          | The CLI (npm `@miragon/pulse-cli`): every REST operation of the engine as a command, generated from its OpenAPI spec, plus the workflow commands; its rules in `apps/cli/CLAUDE.md`                                                                               |
| `apps/vscode/`                                       | Pulse for VS Code (`pulse-cockpit`, a .vsix): a Preact webview over an engine-neutral contract and core, the C7 adapter; its rules in `apps/vscode/CLAUDE.md`                                                                                                     |
| `packages/connectors/engine/engine-connector/`       | engine module: operations tools, widget tools, widgets                                                                                                                                                                                                            |
| `packages/connectors/analytics/analytics-connector/` | analytics module: Prometheus-backed tools, dashboards, comparison widgets                                                                                                                                                                                         |
| `packages/connectors/engine/engine-client/`          | Generated CIB seven REST SDK (`src/generated/`), `createEngineClient`, `EngineRequestError` and the SDK-bound reads (`src/engine-contract/`); a leaf                                                                                                              |
| `packages/connectors/engine/engine-core/`            | The Camunda 7 REST API family's workflow domain and pure engine REST rules (npm `@miragon/pulse-engine-core`): port, selection, inspect, status triage, root causes, retry/advance plans, dates, filters, variable writes; no runtime dependency                  |
| `packages/connectors/analytics/analytics-client/`    | Prometheus client, PromQL query functions (`src/queries/`) and the metrics contract; a leaf                                                                                                                                                                       |
| `packages/core/ui/`                                  | Pulse's design kit (npm `@miragon/pulse-ui`): primitives, components, tone model, type scale, locale, toasts, formatters and the Miragon theme (`theme.css` over the vendored `--cd-*` tokens) for Pulse views and customer UIs; the brand gates under `/testing` |
| `packages/core/widget-shell/`                        | The view runtime (`/widgets`: `mountViews`, the view host, the query hooks, `TestViewHost`, `ListTable`, hand-offs, BPMN), view + data-feed builders, the tool registrar (`createToolRegistrar`) and the boot (`/server`), the product glossary (`/testing`)      |
| `engine-plugins/`                                    | Kotlin/Gradle: CIB seven OTEL metrics plugin (Java 21)                                                                                                                                                                                                            |
| `playground/`                                        | Demo env: CIB seven showcase engine, Compose stack, Fly.io deploy                                                                                                                                                                                                 |
| `docs/`                                              | Pulse docs, a VitePress site on GitHub Pages (getting started, usage, architecture, developer, operations)                                                                                                                                                        |
| `docs/mcp/`                                          | The MCP server's pages of the docs site (getting started, usage, reference, operations, upgrading, architecture, developer)                                                                                                                                       |
| `docs/cli/`                                          | The CLI's pages of the docs site (install, commands, configuration, authentication, AI agents, development)                                                                                                                                                       |
| `docs/vscode/`                                       | The VS Code extension's pages of the docs site (installation, configuration, usage, architecture)                                                                                                                                                                 |

Three axes decide where code goes, and they stay apart:

- Vendor (CIB seven, Operaton, Camunda 7): runtime config per engine, `flavor` →
  `EngineProvider` (invariant 8), never a package or an app.
- Dialect (an engine API family; one today, the Camunda 7 REST API all three vendors serve):
  one package family under `packages/connectors/<family>/`, named for the API family it speaks
  (the Camunda 7 REST family is `engine`, its MCP server `apps/mcp-server`). A different
  dialect is a new family plus its own MCP server app, both named after that dialect, and
  inherits its gates from the layout.
- Interface (how a person or an agent reaches an engine): an app under `apps/`, today the
  MCP server, the CLI (`apps/cli`, rules in `apps/cli/CLAUDE.md`) and the VS Code extension
  (`apps/vscode`, rules in `apps/vscode/CLAUDE.md`). Another interface (a second editor
  extension, say) is an app of its own. Apps never import each other, and no package imports
  an app.

A family is one source the MCP server reads: a dialect, or another source such as `analytics`
(Prometheus). Its packages are named `<family>-<role>`: `<family>-connector` (the MCP module),
`<family>-client` (the wire: SDK, client, the SDK-bound reads) and, when the family's interfaces
share a pure domain, `<family>-core` (no runtime dependency, one port per family, the home of the
family's pure rules; extracted on its second consumer, like `engine-core`, which the CLI and the
VS Code extension's C7 adapter bundle and the engine connector runs). A family's tool input
schemas live in its connector, next to the tools
(`packages/connectors/engine/engine-connector/src/schemas/`,
`packages/connectors/analytics/analytics-connector/src/schemas/`), so a client carries no zod:
validating tool input is the connector's concern, and the wire takes typed parameters.
Family code stays in its family: `packages/core/` holds what every family builds on (pulse-ui,
widget-shell), never one family's code.

The architecture invariants below are written for the MCP server, its modules and its widgets.
The package rules of invariant 8 (layout, naming, dependency edges) hold for every workspace
package; another interface app keeps its own rules in its own CLAUDE.md.

## Commands

```bash
# From a fresh clone with Node, pnpm and Docker only (no JDK, no .env; scripts/local.mjs):
pnpm play                            # install, playground up, build, MCP server + inspector on :8400
pnpm play:cli -- ping                # the built CLI against the playground engine
pnpm stack:up | stack:down | stack:status   # the playground in Docker (--multi-engine, --auth)
pnpm check                           # the local bar, one log per step in reports/check/
pnpm check:all                       # plus test:host, template, Gradle, docs build, engine suites
# The VS Code extension's own engines: pnpm --fail-if-no-match --filter pulse-cockpit sandbox:up

pnpm install --frozen-lockfile       # all deps are public; no registry credential needed

pnpm build                           # turbo build across the monorepo (runs `generate` first)
pnpm typecheck                       # tsc --noEmit everywhere, incl. widget/UI tsconfigs
pnpm test                            # vitest across the workspace
pnpm lint                            # eslint per package (`pnpm lint:fix` to autofix)
pnpm format:check                    # prettier check (`pnpm format` to write)
pnpm generate                        # regenerate the CIB seven SDK from the OpenAPI spec

# The server with your own settings (a .env file, see .env.example; playground: pnpm stack:up):
pnpm dev                             # MCP server on :8400

# Kotlin engine plugins (Java 21):
cd engine-plugins && ./gradlew build # compile + unit tests + Konsist architecture tests

# Docs site:
pnpm docs:dev                        # local dev server; pnpm docs:build to build

# The CLI (apps/cli; Docker for the engine suites, build first):
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog       # regenerate the command catalog
pnpm --fail-if-no-match --filter @miragon/pulse-cli test:engines  # Testcontainers suites
```

`pnpm play` and `pnpm dev` serve the MCP endpoint at `http://localhost:8400/mcp` and the `mcp-use`
inspector UI at `http://localhost:8400/mcp/inspector` (served by `mcp-use dev` only;
the production entrypoint mounts no inspector). Use the inspector to call tools and
render widgets manually.

If generated SDK files look wrong (e.g. `client.gen.ts` importing `./src/hey-api.js`
instead of `../hey-api.js`), the shared turbo cache replayed a poisoned `generate`
output. Fix it with `pnpm exec turbo run generate --filter=@miragon/pulse-engine-client --force`.

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
heute die Kopie in pulse-ui (`packages/core/ui/src/tokens/manifest.json`), das Doku-Kit und das
Theme der VS-Code-Webview (`apps/vscode/src/webview/theme/manifest.json`). Eine weitere Kopie kommt
mit einem Manifest im Format des Doku-Kits und einem Eintrag dort, nie als Ausnahme im Scan. Der
Drift-Test ist `packages/core/ui/src/theme/token-drift.test.ts` (mit
`packages/core/ui/src/theme/vendored-tokens.test-support.ts`); `test:host` prüft das gebaute
Stylesheet.

UI-Texte gibt es auf Deutsch und Englisch, je nach Host-Locale. Deutsch folgt brand-tone
vollständig: du-Ansprache, AI statt `KI`, „CIB seven“, kein Gedankenstrich als Verbinder,
normale Groß- und Kleinschreibung, Fehlermeldungen sagen, was passiert ist und was du tun
kannst. Englisch übernimmt die übertragbaren Regeln: Sentence case, aktiv, kein Em-Dash als
Verbinder. `.miragon/brand.json` schaltet den brand-lint-Hook für jede geänderte Datei ein;
Strings in `.ts`/`.tsx` prüfen die Gates aus `@miragon/pulse-ui/testing` (Invariante 6); das
Produkt-Glossar liegt in `@miragon/pulse-widget-shell/testing`.

### Abweichungen für eingebettete Chat-Widgets

Die Widgets laufen als MCP Apps im Rahmen eines Chat-Hosts. Dafür gelten diese bewussten
Abweichungen vom Guide (Owner-Entscheidung, nur hier dokumentiert):

- Theme: Die Widgets folgen dem Host-Theme (#339), ohne Umschalter in der App; ohne Host das
  OS. Dunkel entsteht streng aus den Dark-Ground-Regeln der
  CI: Basis `--cd-schwarz`, Flächen als `color-mix`-Aufhellungen davon, Text Weiß, Links und
  Akzenttext `--cd-gruen`, Buttons `--cd-blau` mit Weiß, Fokus `--cd-blau-hell`, Status in den
  `-hell`-Werten ohne getönte Flächen, leiser Text `--cd-kontur`. Der Host setzt nur die
  neutralen Rollen (`HOST_TOKEN_MAP`: Flächen, Text, `--border`), nie `--primary`, `--link`,
  `--focus`, `--ring`, `--input`, `--accent` oder einen Status. BPMN-Papier und seine
  Zoom-Leiste bleiben immer hell.
- Schrift: Geist zuerst, dann die Schrift des Hosts (`adoptHostFontVariables`), dann System.
  Der Server liefert Geist und Geist Mono selbst aus (`installFontAssets`, kein CDN), jede View
  erlaubt den Ursprung über ihre CSP `resourceDomains` (`declareServedFonts`). Blockt ein Host
  den Ursprung, rendert die Host-Schrift, ohne dass etwas wartet.
- Sprache: Deutsch und Englisch nach Host-Locale (Fallback Englisch) statt nur Deutsch.
- Chrome: im Rahmen des Hosts (Kopf mit Titel und Aktionen) statt randlosem Canvas mit
  schwebendem Chrome in den Ecken.
- Seitentitel: h2 mit 28 px statt h1 mit 40 px.
- Dichte Tabellen: 14 px statt 16 px Fließtext.
- Data-Viz: eine einfarbige Rampe von `--cd-info-soft` bis `--cd-blau`; Rot nur für
  Incidents.
- Komet: nur auf App-Ebene (Landing, Erststart, „keine Engines“), nicht in jedem Widget
  (`KometMark`/`AppEmptyState`, die CI-Datei unverändert). Eine Kundenmarke blendet ihn über
  den Theme-Slot `--brand-mark-display: none` aus.
- BPMN-Zoom-Leiste oben rechts statt unten rechts: unten rechts liegt das bpmn.io-Logo
  (Lizenzpflicht).

## Architecture invariants

1. **New operations tools go through the registrar, never raw `server.tool()`.** Add the Zod
   input schema in `packages/connectors/engine/engine-connector/src/schemas/`, then register
   the tool in `packages/connectors/engine/engine-connector/src/tools/<domain>.ts` via the
   `register` callback of `createToolRegistrar` (`@miragon/pulse-widget-shell/server`, wired in
   `src/tools/index.ts`): a `category` matching its domain file (`"analytics"` in the analytics
   module), `...engineParamShape` in the input schema, the handler wrapped in `withEngine(...)`
   (both from `src/lib/engine/with-engine.ts`). Canonical shape: `engine_list_process_instances` in
   `packages/connectors/engine/engine-connector/src/tools/process-instances.ts`. ESLint
   (`no-restricted-syntax` in `eslint.config.mjs`) blocks raw `server.tool()` in every spelling
   outside the widget-path files its `ignores` lists. `no-restricted-syntax` is ONE rule: a
   later flat-config block REPLACES its selectors, so a glob two gates share gets one block with
   the union (`scripts/eslint-gates.test.mjs`).
   - Annotations decide the toolset. A destructive or admin tool goes into `ADMIN_ONLY_TOOLS`
     (`src/lib/mcp/toolsets.ts`); `src/lib/mcp/toolsets.test.ts` checks every registrar tool
     and `src/plugin.test.ts` every tool the module registers, feeds included (the read-only floor
     holds only `readOnlyHint` tools; every write states `destructiveHint`, since MCP reads an
     absent hint as `true`). Fix the annotations, not the test.
   - Toolsets are FAIL-CLOSED: without a suffix a module runs its read-only floor on an
     unauthenticated boot and its standard toolset (engine `operations`) under OAuth;
     `admin` is never implied; an empty or unknown suffix warns and falls back to the floor;
     nothing resolves to "everything" (widget-shell's `toolsets.test.ts` +
     `composition.test.ts`). Analytics declares no toolsets: every analytics tool is a read
     (its `src/module.test.ts`), and a suffix on it is ignored with a warning.
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
   `ENGINE_DEFAULT` (it must name a configured engine, else the boot fails) > the only
   configured engine > `ENGINE_NOT_SELECTED` listing the engines. There is deliberately NO
   per-user or in-memory selection (replica-unsafe; mcp-use 2 issues no session ids). A client
   you construct or cache yourself breaks multi-engine routing; `resolveEngine` already returns
   `baseUrl`/`cockpitUrl`. The BPMN lookup the module hands analytics (`createBpmnXmlFetcher`)
   routes the same way, on the module's own registry and XML cache.

3. **A view is registered in three places**; a view that misses one is silently absent:
   - the module's view map, keyed by its view tool's name (the engine module has ONE view,
     `engine_open_cockpit` → `CockpitApp` in
     `packages/connectors/engine/engine-connector/src/widgets/views.tsx`)
   - `apps/mcp-server/src/ui/view-registry.ts`: every module's views plus the host
     widgets (cross-module widgets by raw id)
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

   A view is picked by its NAME, the view tool's name (`showToolBinding`, primed under
   `ui://views/<name>.html` with a prelude naming it), so
   `apps/mcp-server/test/view-registry.test.ts` holds the view registry to the
   view-bound tools of the tools/list goldens and fails both ways: on a tool without a view
   (the "can't show this view" state) and on a view no tool opens (dead code in every
   view's bundle).

4. **The view bundle's `resolve.dedupe` is load-bearing: never remove or trim it.** It is
   widget-shell's `VIEW_BUNDLE_DEDUPE` (`@miragon/pulse-widget-shell/server`), spread whole in
   `apps/mcp-server/vite.config.ts` and the template's `server/vite.config.ts`. Without it each
   widget package bundles its own React, TanStack Query, mcp-use, pulse-ui or widget-shell
   instance, the React contexts no longer match, a widget finds no view host and no
   `QueryClient`, and every in-widget query hangs on "Loading…". widget-shell's
   `src/view-bundle.test.ts` holds the list to its peers, `test/view-bundle.test.ts` the app's
   config to the list, test:host's in-widget query the built bundle.

5. **There are three render paths; pick deliberately:**
   - Registrar tools (`src/tools/`): plain JSON data _for the model_.
   - Widget tools (`show_*` in analytics, `engine_open_cockpit` in the engine module; spread
     `...showToolBinding(name, title)` from `@miragon/pulse-widget-shell/server`): render a
     view for the user, as `buildViewResult(data, text)`: the `structuredContent` IS the view's
     data and the `content` text is the model-facing result as compact JSON (the analytics
     heatmap: a short English summary). `engine_open_cockpit`'s `view` picks the start
     route, its `structuredContent` carries that route's data (the route's widgets seed their
     feeds with it) and its `content` that route's facts. The view is picked by its name
     (= the tool's name); a composed view (a dashboard, the process detail) is ONE component
     that composes its widgets, never a layout the server sends.
   - `*_data` feeds (spread `...appOnly`, **no** view binding; the engine module's `registerDataFeed`):
     app-only JSON for in-widget refresh and navigation, returned as
     `buildDataFeedResult(data)`. SEP-1865 hosts hide them from the LLM, and a widget-tool
     result would be rendered by the host instead of returned to the in-widget `callTool()`.

   Every tool takes STRICT input (the registrar always, a raw registration through
   `strictToolInput(…)`), with no exemption list: an unknown key is a tool error listing the
   valid keys, never a silently stripped filter
   (`test/strict-input.e2e.test.ts` in the app). Parameter names and descriptions follow the
   guide in the add-bpm-feature skill: a parameter that means the same on every tool is
   explained once in the module instructions, and a tool describes it only where it means more
   there.

6. **MCP App widgets compose from the design kit `@miragon/pulse-ui` and the view runtime of
   `@miragon/pulse-widget-shell/widgets`; never re-inline their primitives.** This covers
   the React views an MCP host renders (pulse-ui's and widget-shell's `src`, the connectors'
   `src/widgets`, the host bundle in `apps/mcp-server/src/ui/`); another interface
   app's own UI follows the design system above.
   - **One kit.** Primitives, components, the tone model (`TONE_*`, `resolveTone`), `cn`, the
     formatters and the kit pieces (`Icon`, `Th`/`Td`, `TableEmptyState`, `NativeSelect` …) come
     from `@miragon/pulse-ui`, a leaf (`ui-is-a-leaf`, invariant 8); widget-shell exports only
     what touches the host and never a pulse-ui name
     (`packages/core/widget-shell/src/pulse-ui-overlap.test.ts`). A form says an invalid
     entry inline next to the control it marks `aria-invalid`, never clamps it silently.
   - **The view runtime is widget-shell's.** The root's call hook (`useMcpUseViewCall` over
     `resolveViewCall`) owns the stripped-result recovery: a host that drops
     `structuredContent` gets ONE re-run of the view's own view tool, so every view-bound tool
     is a read (`apps/mcp-server/test/view-registry.test.ts`). `ViewFrame` renders the
     phases (waiting, error, cancelled, ready); every `ViewStack` row and `HostWidgetSlot` has
     its own error boundary, so one crashing widget never takes its view down. Widgets reach
     the host only through `useViewHost`/`HostModelContext` and the query hooks
     (`useToolQuery`, `useToolMutation`, `useViewData`), test under `TestViewHost`, and never import
     `mcp-use/react` (ESLint `no-restricted-imports`, `scripts/eslint-gates.test.mjs`).
   - **States and feedback** (#322). Loading, error and no data go through `ViewDataState`, or
     `QueryFallback` + `TableSkeleton` in a self-fetching widget (without an `isError` branch
     the skeleton never ends); both take a required `onRetry` and word a failure with
     `describeError`, the raw engine text only under "Details". A write reports through
     `useActionFeedback()` toasts that name the object and confirms through `ConfirmDialog`;
     nothing to show is `TableEmptyState`.
   - **Inline is a card, not a page** (#396). A list under a host shows the rows that FIT the
     host's height budget, measured on the rendered view (`InlineFitBox`), never estimated
     with px constants. A paged list registers ONE list (`PagedRows` + `paged.fit`, its footer
     `labels={paged.footerLabels}`; `inline-fit-wiring.test.ts`); a row that continues the one
     before carries `FIT_CONTINUES_ROW`; ids wrap between their parts (`BreakableId`). Roots
     declare inline + fullscreen only (`SHELL_VIEW_CONFIG`).
   - **Tables never widen the document** (WCAG 1.4.10): `ListTable` scrolls inside a named
     region (`ariaLabel`) and drops columns on narrow regions (`hideBelow`). Ids show through
     `IdCell`/`IdText`, processes and elements through `NamedId`, named by ONE reader
     (`readBpmnNames`/`parseBpmnNames`), so every module shows them alike.
   - **Type, dates and numbers.** Text sits on pulse-ui's `TYPE_SCALE` (13 px floor,
     `scanTypeScale`). Dates and numbers go through the kit's `format*` helpers in the locale
     `LocaleGate` publishes (ESLint's date and number gates over `WIDGET_TREES`, every widget
     tree: the host bundle's `src/ui`, widget-shell's and both connectors' widgets;
     `scripts/eslint-gates.test.mjs`). A count reaches a
     catalog entry already formatted, and the entry puts the noun in the right number
     (`countOf`, `plural(…)`), never a `…One`/`…Other` key pair.
   - **BPMN** renders through `useBpmnViewer` + `BpmnZoomControls` on a forced-light canvas
     whose colours all come from `BPMN_TOKENS` (`packages/core/widget-shell/src/ui/bpmn-tokens.ts`).
   - **Paged lists** compose `usePagedListView` (the feed takes `firstResult`/`maxResults` and
     returns an honest total; counts, filters and model contexts read the payload ON SCREEN,
     never the request) + `ListTable` + `PagedListFooter`. Optimistic local state resets with
     `useResetOnChange(data, reset)`, never in an effect.
   - **A status is a tone, never a coloured word.** `ToneVariant` is
     `danger | warning | success | info | neutral`: an open incident or a failed job without retries
     is `danger`, a failed job with retries left or a degraded engine `warning`, a count without a
     state `neutral`; the ladder is widget-shell's `countTone`/`severityTone`. An engine's own state
     is the tone of its one verdict (`VERDICT_TONE`, the health feed's `status`): the overview's
     badge and the engine's dot on the landing and the fleet view alike. Each tone has three
     roles: `--<tone>` (dot, edge, icon), `--<tone>-soft` (tint, black text) and `--<tone>-ink`
     (text on card or page, never on a tint, never a number). Numbers stay neutral. Components use
     role names only (`scanColors`); `packages/core/ui/src/theme/tone-contrast.test.ts` holds every
     role pair to WCAG AA (a role a brand may override belongs in `ROLE_CONTRAST_PAIRS`). A brand
     override goes under `:root` AND the dark scopes, or a light-only value shows in dark
     (`parseThemeVariables`).
   - **Icons are Lucide**, never glyphs or emoji: `Icon`, 16 or 24 px (`scanIconSizes`), its
     stroke through lucide's own `strokeWidth`, never a CSS `stroke-width` rule, which would
     beat the `LucideProvider` widget-shell's view root sets with pulse-ui's `ICON_STROKE`.
     Every package that imports `lucide-react` and every host bundle pin the SAME exact 1.x
     devDependency (today `1.66.0`): two versions resolve a second mcp-use instance and split
     the React contexts.
   - **Actions and hand-offs.** A view's actions are ONE group in `WidgetHeader` `actions`, all
     `size="sm"`, ordered: deterministic steps, the engine's own web app
     (`OpenInCockpitLink`), then the chat; the meta line under the title holds facts only
     (`action-group.test.tsx`), and a state goes into the header's `badge`, not an icon tile. A row's drill is `DrillButton` (`row-actions.test.ts`), its
     further actions sit in `MoreActions`. A chat hand-off is widget-shell's `HandOffButton`
     (`action` from `HAND_OFF_ACTIONS`: one Lucide icon and one verb naming the chat per
     function), a secondary outline after the action it accompanies; `scanGlyphs` bans sparkle
     icons and an ESLint gate a raw `AskAiButton`, so a new function goes into widget-shell's table.
   - **Brand gates and glossary.** Every widget package runs the gates of
     `@miragon/pulse-ui/testing` (`catalogTextFindings`, `scanGlyphs`, `scanIconSizes`,
     `scanColors`) in its own `brand-gates.test.ts` (the host bundle's `src/ui` runs
     `scanGlyphs`; widget-shell checks its words next to its catalogs, in
     `packages/core/widget-shell/src/ui/kit-words.test.ts`), and its en/de catalogs hold the same
     keys. One term per thing across the product: `PRODUCT_GLOSSARY`
     (`@miragon/pulse-widget-shell/testing`; Incident,
     "Jobs ohne Versuche" / "jobs without retries", "bereitstellen", Geschäftsschlüssel,
     aussetzen, Versuche, alle Engines), checked with each connector's own terms by
     `src/messages/glossary.test.ts` and listed in `src/messages/GLOSSARY.md`.
   - **Locale on the server.** Tool results for the model are English only (the engine module's
     cockpit facts are JSON keys, analytics' heatmap summary goes through its `summaryT`); a
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
     reads the XML from the app-only `engine_bpmn_xml_data` (the heatmap from
     `analytics_bpmn_xml_data`). The ONE XML read is `lib/bpmn/definition-xml.ts`, cached per
     engine client and per caller.
   - Each engine REST rule the client defaults miss has one home, used by `tools/` AND `data/`
     (and by the CLI): the pure rules (`toEngineDate`, `engineSorting`, the filters,
     `toEngineVariable(s)`, `autoTypedValue`, `incidentRecovery`, `RAW_VARIABLES`, root causes,
     the missing-resource rule `isMissing`) in `@miragon/pulse-engine-core`, the
     reads bound to the SDK (text/plain endpoints, raw variable reads, `readBatch`, queued
     batches) in engine-client's `packages/connectors/engine/engine-client/src/engine-contract/`,
     which does not import engine-core. Dates parse in one parser, read in one of two named
     readings (`DateInputReading`: `OFFSET_REQUIRED` for the MCP tools, `UTC_WITHOUT_OFFSET` for
     the CLI). A 404 is "none" only by `isMissing` (a 404 `NotFoundException`, a
     `QueryParamException` or one without an engine answer is a wrong REST root or request and
     fails loud): the client's reads throw every 404 and their callers decide (the connector's
     `isMissingResource`/`noneIfMissing` in `src/lib/core-adapter/engine-port.ts`), the CLI and
     the VS Code adapter call it. Three copies are left, each held equal by a test: in the leaf
     client the raw-variable flag (to `RAW_VARIABLES`, the connector's
     `src/engine-contract.test.ts`) and the wrong-root hint of a 404 in
     `packages/connectors/engine/engine-client/src/engine-error.ts` (wording only, to
     `isUnknownEndpoint`, on which `isMissing` builds; the connector's
     `src/lib/core-adapter/engine-port.test.ts`), and the CLI's endpoint hint in
     `apps/cli/src/http/errors.ts` (its http layer does not import the core;
     `apps/cli/src/http/errors.test.ts`). No client
     follows a redirect: a 3xx fails with a message that names the fix. Every write tool has a
     recording-fake-engine case in `src/tools/*.wire.test.ts`. Analytics periods derive from
     `PERIODS`/`PERIOD_RANGE`.
   - The workflow rules the CLI and the read composites (`engine_inspect_process_instance`,
     `engine_status`, `src/lib/core-adapter/composites.ts`) share live in
     `@miragon/pulse-engine-core`: selection, root cause, the composites' paging and caps, the
     ONE incident mask and cause (`messageSignature`, `causeKeyOf`: the status groups, the
     verdict's largest cause, the cockpit's cluster ids) and the ONE live verdict (`engineVerdict`:
     `engine_status`, `pulse status` and the cockpit's health route, `ok | warning | critical`;
     the MCP server's thresholds from `ENGINE_HEALTH_*`, the CLI's the defaults 50/25), a
     threshold breach a critical `INCIDENTS_CRITICAL` finding; analytics' Prometheus view is
     `metricsState` (`metricsStateRule`), never a `status`; the
     connector's port (`src/lib/core-adapter/engine-port.ts`) maps each operation to an SDK or
     contract read. Deliberate carve-outs: the composites read definitions by id inside inspect (not `data/definition-info.ts`;
     `definitionKeyOf` only as a fallback), send UTC `+0000` dates (`engineFormat`, not
     `toEngineDate`), and count overdue jobs from a capped scan of 1,000 per key, named in
     `truncated` (not a `/count`). The MCP side caps the result lists engine-core leaves uncapped
     for the CLI (wait states, incidents, timeline, variables, definitions, topics) and names each
     cut in `truncated`; engine-core still loads them whole.
   - **Caller identity** is read once per request by the MCP middleware
     (`installMcpRequestContext` → `callerUserId` in `packages/core/widget-shell/src/caller.ts`),
     from the server's own OAuth only: nothing a client chooses (a session id, a header)
     identifies a caller. Code reads it through the ambient request info (`getMcpRequestInfo`):
     per-caller caches key on `callerCacheKey`, passthrough auth forwards the caller's bearer
     token. Without OAuth there is no caller: a request still caches apart by its bearer token,
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
     `@miragon/pulse-<dir>`); the VS Code extension is `pulse-cockpit` (vsce takes no scope).
     Rules key on `@miragon/pulse-`, never on bare `@miragon/`, which other Miragon packages
     share. Gate: `scripts/check-package-naming.mjs` (`pnpm lint:naming`).
   - **Dependency edges** (`.dependency-cruiser.cjs`, `pnpm lint:architecture` +
     `pnpm lint:architecture:cli`; the VS Code extension's own closed-world rules:
     `apps/vscode/CLAUDE.md`): connectors never import each other, a connector imports only its
     own family's client and core, clients and family cores are leaves, core is the foundation
     and pulse-ui its leaf, no package or app imports an app, no cross-package deep imports. The
     interface apps import nothing of the MCP/UI/server stack, zod included, and no workspace
     package except a family core they bundle (`@miragon/pulse-engine-core`: the CLI's, and the
     VS Code extension's in its C7 adapter alone, `apps/vscode/src/adapters/c7`); a family
     core (`family-core-is-a-leaf`) is imported only by its family's connector and the apps (or
     the app part) that bundle it (`family-core-consumers`, `CORE_BUNDLERS`), and no shipped code imports a
     `./testing` entry (`shipped-code-not-to-testing`). The family rules key on the roles, so a
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
     and the lib folders (`src/lib/engine` routing, `src/lib/core-adapter` the engine-core port,
     `src/lib/bpmn` BPMN and task forms, `src/lib/mcp` the tool surface, `src/lib/shared` what the
     widgets share) never import `src/tools`, `src/widget-tools`, `src/widgets` or the
     connector's root (`src/index`, `src/plugin`, `src/module`)
     (`connector-data-and-lib-point-down`). Each rule has planted violations in
     `scripts/dependency-cruiser-gates.test.mjs`; a new app adds its npm name to the config's
     `APP_PACKAGES`. A rule names all three shapes an import reaches it in
     (a relative escape, `<importer>/node_modules/<name>/`, a bare specifier) and never exempts a
     package's own directory in a `pathNot`.
   - **The module port.** Each module exports its definition in `src/module.ts` (config schema,
     `configFromEnv`, `knownEnvVars`, `toolsets`, `bootWarnings`, `instructions`, the rules for
     every tool instead of 60 descriptions; `retired`, the former names and variables the boot
     refuses, naming their replacements; plugin factory), conforming STRUCTURALLY to
     `ComposableModule<TShared>`. Its `createPlugin(config, shared)` returns a `ModulePlugin`,
     `{ name, register(server) }`: `register` puts every tool, prompt and resource of the module
     on the server the boot owns, and `name` is the owner the duplicate guard names. The
     composition machinery (selection with `module:toolset` suffixes in `MCP_ACTIVE_MODULES`,
     `resolveBoot`) lives inside the boot (`@miragon/pulse-widget-shell/server`); a root hands
     it its module list and its `shared` wiring and nothing about auth. The boot installs OAuth
     from one provider's `MCP_USE_OAUTH_*` variables (the table and the failure rules:
     `docs/mcp/operations.md`) and is authenticated exactly when it installed a provider,
     never inferred from an env var.
   - **The app composes, nothing more.** `setup.ts` holds `MODULES` and `sharedResources`, the
     `SharedResources` wiring (`fetchBpmnXml`, the engine module's XML lookup for analytics; `engineIds`,
     the ONLY engines analytics reads, so analytics needs NO engine SDK). Widget components and
     boot plumbing live in packages; the bundle root is
     `mountViews({ views, hostWidgets })` (its `ViewRoot` provider order is load-bearing), the
     stylesheet pulse-ui's `theme.css` after `tailwindcss` (`test/ui-stylesheet.test.ts`).
   - **One boot.** `createComposedServer` owns the boot order and the production listener and
     takes the root's `modules` and `shared`. It constructs the `MCPServer` itself and wraps
     `server.tool` before the first plugin registers: a tool name two registrations share fails
     the boot naming both owners (`server` for one outside a plugin), and every view-bound tool
     gets the server-wide view CSP defaults (the served fonts' origin). Once every plugin has
     registered, it primes the one widget bundle for every view. Each MCP server app owns ONE
     `createApp(env, deps?)` (`src/app.ts`) that `src/index.ts` AND the e2e suites boot, never a
     test-only re-implementation. Readiness never probes engines or Prometheus (it answers 503
     only while the server drains); metric labels stay bounded (tool catalogue + known routes,
     never users or arguments). The HTTP edge guard
     (`resolveHttpEdgePolicy`) is DNS-rebinding protection that exempts `/health*` and
     `/metrics`; never swap it for mcp-use's `allowedHosts`, which guards those too.
   - **Cross-module UI is tiered**: another module's widget only through the host widget map
     by raw id (`useHostWidget`/`HostWidgetSlot`: `analytics:engine-landscape` in the engine
     module's fleet view, `analytics:process-heatmap` and `analytics:process-heatmap-legend` in
     its process flow). The module that owns the data owns the widget and its payload type: the
     widget fetches its own data and reads its props as untyped input. The heatmap's ids and props
     are pinned on both sides (`process-heatmap.test.tsx`, `process-definition-flow.test.tsx`)
     and rendered together by `test:host`; props outside its contract call the caller's
     fallback, never a blank area. A raw tool-name
     string with graceful degradation is left only for the probe; hard-composed views go in a
     dedicated package created with the first real view, never in the app, never as
     module-to-module imports. The host bundle is static, so a surface that needs another module
     probes one of its argument-free feeds once per view (`useAnalyticsActive`; a failed probe,
     or a bundle without the host widget, hides the offers, fail-closed).
     `scripts/tool-name-refs.test.mjs` checks every `<module>_…` literal against the full
     surface of the admin golden; the apps the source guards read are listed in `APP_SCAN`
     (`scripts/source-scan.mjs`), where a new app adds its entry (an app missing there fails).
     Hand-offs and model contexts name no tool of either module (invariant 6), so the only raw
     cross-module names are the probe feed and host widget ids. A module's tool texts and
     instructions name only its own tools (`crossModuleNames` in the app's
     `tools-list.golden.test.ts`): the other module may be off.
   - **A write registers only through the registrar**, whose toolset filter decides it
     (`withToolsetFilter`/`isToolInToolset` in the engine module), never an ad-hoc `toolset === …`
     compare; an in-widget write asks `engine_widget_actions_data` whether it exists.
   - **In-widget engine writes** run through ONE primitive, `useEngineAction`
     (`engine-connector/src/widgets/lib/engine-action.ts`): the gate (`allowed` from
     `engine_widget_actions_data`, AND `available`: no write on an ended, cancelled or
     unconfirmed instance), the confirmation that names its target, the targeted invalidation
     through the view's one `QueryClient` (`useQueryClient`) and the optimistic marks
     (`WRITE_POLICY`); controls are hidden, not disabled (`src/widget-actions.test.ts`,
     `widgets/action-gating.test.tsx`). The cockpit's start route refreshes after a write
     because the tool result seeds its live feed query (`useViewData` always seeds).
   - **Vendors** are per-engine runtime config (`flavor` → `EngineProvider` in
     `packages/connectors/engine/engine-connector/src/providers/`); the port holds ONLY real
     differences (cockpit routes, branding, client hook), never an SDK mirror.

## Contracts

- **`packages/connectors/analytics/analytics-client/metrics-contract.json` is the single source
  of truth for metric names and labels: when changing a metric, change it here first.** The
  Kotlin plugin (`engine-plugins/cibseven-history-metrics/`) emits the Micrometer meters,
  recorded only once the engine command COMMITTED; durations are whole milliseconds with
  explicit buckets, since Micrometer rounds UP to a whole base unit before bucketing. Read a
  counter or histogram only through `increaseIn` (`queries/helpers.ts`): `increase()`/`rate()`
  never count a series' first sample, so the first incident at an activity would read 0; fold
  a gauge over a clustered engine's nodes as `max by (<its contract labels>)`. TS queries (via
  `METRIC_NAMES`), `playground/docker/prometheus/alerts.yml` and the Grafana dashboards are
  checked by `packages/connectors/analytics/analytics-client/src/metrics-contract.test.ts`,
  `src/metrics-contract-labels.test.ts` (a new query export needs a `SCENARIOS` entry) and the
  Gradle `MetricsContractTest.kt`. Attach only model-bounded labels (definition key, activity
  id, engine id …), never instance ids, business keys or variable values.
- **Never aggregate a RATE across engines.** Engines host different process definitions, so a
  rate or duration summed per `engine_id` measures the engine's process mix and can even
  invert the per-process truth. Cross-engine views report absolute counts plus the
  engine-owned backlog gauges (labelled by `engine_id` ONLY): `queries/engine-landscape.ts` +
  `analytics:engine-landscape`. A like-for-like comparison holds the process fixed, which is
  why `analytics_show_engine_compare` REQUIRES a `processDefinitionKey`; keep it required
  (`src/widget-tools/engine-{compare,landscape}.test.ts`).
- **Pinning is split by dependency stanza.** `dependencies`/`devDependencies` stay EXACT
  (`save-exact=true` in `.npmrc`). Consumer-shared libraries are RANGED `peerDependencies`, so
  a downstream app dedupes them (`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `bpmn-js`
  `^18.31.1`, `@miragon/pulse-ui` and `@miragon/pulse-widget-shell` as `workspace:^`, packed to
  `^<version>`), each also an EXACT devDependency. `bpmn-js` is a peer of widget-shell
  (`./widgets` exports the BPMN viewer, so every view bundle imports it) and of the two
  connectors, which draw diagrams. A published package imports only what its `dependencies` or
  `peerDependencies` declare (`scripts/published-imports.test.mjs`), and its tarball ships no
  test and every module its entries reach (`scripts/pack-contents.mjs`, run by
  `scripts/test-template.sh`); a connector ships `dist` and its `src`, the template's reference
  implementation. **`mcp-use` is exactly pinned even as a peer** (`2.12.2`): a duplicate instance
  breaks the React context and hangs every in-widget query (invariant 4). Name the required
  `mcp-use` version in each package README and the release changelog. The template pins what the
  workspace pins (the `@miragon/pulse-*` libraries, `mcp-use`, `react`, `react-dom`, `zod`,
  `lucide-react`, `@tanstack/react-query`; `scripts/template-pins.mjs`, in `pnpm test` and
  `scripts/test-template.sh`), never one package in isolation. Dependabot's one npm entry
  covers the root and the template, so a grouped minor or patch bump moves both; a major or a
  security update can arrive for one directory only and turns `pnpm test` red until the
  template pins the same version: bump both in that pull request.
- **The widget `_meta` contract is split since mcp-use 2; never hand-write the `ui` half.**
  mcp-use emits the MCP-Apps keys from the tool's `view`/`visibility` fields and OVERWRITES
  the `ui` namespace on tools/list; widget-shell's `showToolBinding` stamps only the `openai/*`
  half.
  `apps/mcp-server/test/widget-contract.e2e.test.ts` checks the wire **by name**
  (every `*_show_*` tool and `engine_open_cockpit` carry the widget `_meta`, every `*_data`
  feed is app-only), so the naming convention is load-bearing.
- **The tools/list wire payload is a golden, per toolset**
  (`apps/mcp-server/test/tools-list.golden.test.ts`). The ONLY update path is
  `GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server test` (refused in CI);
  never hand-edit a golden. `__golden__/char-budgets.json` pins each toolset's model-visible
  size, the tools/list text plus the server instructions sent at initialize (text moved into
  the instructions still counts), shrink-only: a change that makes the model read MORE text
  needs a `Ratchet-Exception:` trailer.
- **The widget bundle has a budget.** Every view resource inlines the whole bundle, so its
  size is the cost of every render: `test/__golden__/bundle-budget.json` holds shrink-only gzip
  ceilings that `test-host/bundle-budget.spec.ts` checks; growth needs a `Ratchet-Exception:`
  trailer that says why. Two more shipped bundles have a shrink-only ceiling: the VS Code
  webview's (`apps/vscode/test/__golden__/bundle-budget.json`, gzip) and the CLI's npm dist
  (`apps/cli/test/__golden__/bundle-budget.json`, raw bytes, read by
  `scripts/published-imports.test.mjs`, which also makes it come down once the dist shrinks
  more than 10 % below it). The CLI's standalone bundle (`build/standalone`, the single
  executables and the image) has none.
- **Federation happens in an external MCP gateway (agentgateway) IN FRONT of this server;
  this repo builds one self-contained MCP server including its UI.** Federation was dropped
  deliberately in #162: no upstream/proxy mechanics. A gateway that terminates auth in front is
  invisible to this server: without an OAuth provider (`MCP_USE_OAUTH_*`) it boots read-only
  with no caller identity, so
  such a deployment names its toolsets in `MCP_ACTIVE_MODULES`.
- **The server reads no `PULSE_*` variable.** PulseAudio owns `PULSE_*` and `PULSE_CLI_*` is
  the CLI's; the typo warner watches the prefix of every known variable, so one server name
  under `PULSE_` would make it warn about both in a shared environment. A server setting goes
  into its own family (`ENGINE_*`, `ENGINES_*`, `PROMETHEUS_*`, `ANALYTICS_*`, `MCP_*`;
  `scripts/server-env-names.test.mjs` and the app's `test/setup.test.ts`).

## Releases

The release workflows hold the publish credentials and no pull request runs them;
`scripts/check-github-config.mjs` (`pnpm lint:github`) pins their security shape against the
workspace (its header lists each check).

- **One release-please train.** Conventional commits on `main` drive `release-please.yml`: one
  Release PR (tag `v<version>`) bumps the root, every app, the seven packages, the template's
  pins, the engine-client User-Agent and `engine-plugins/gradle.properties` in lockstep
  (`extra-files` in `release-please-config.json`). Merging it creates the release; every
  publish job then waits for manual approval of the `release` environment gate.
- **npm:** the seven packages and `@miragon/pulse-cli` publish through
  `publish-npm-package.yml` with OIDC trusted publishing (no NPM_TOKEN, provenance attached).
  Each names this repository in its `repository` field, since npm refuses a provenance publish
  from another repository. The pack job runs `pnpm pack`, which rewrites `workspace:*` (npm's
  own pack would ship it verbatim); the one job that holds `id-token: write` runs no package
  manager. Only the server app and the VS Code extension stay private. The `miragon-ai` names
  used up to 0.20.0 are retired; never reuse them. `sync-template-mirror.yml` then mirrors
  `templates/composed-server` to `Miragon/pulse-starter`, the customer-facing composition path.
- **The VS Code extension ships as a .vsix, never through npm**
  (`.github/workflows/publish-vscode-extension.yml`): packaged without credentials, published
  to the Visual Studio Marketplace and Open VSX from one job in the `vscode-marketplace`
  environment that builds nothing; `VSCE_PUBLISH`/`OVSX_PUBLISH` are handed down by name, never
  `secrets: inherit`.
- **Engine plugins** publish to Maven Central via `publish-to-maven.yml` (Vanniktech Maven
  Publish, GPG-signed) under the group `io.miragon.mcp` with the engine in the artifactId
  (`io.miragon.mcp:cibseven-history-metrics`); publishing config lives in each module's own
  `build.gradle.kts`.
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

| Check             | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`      | turbo `build` everywhere: tsc emit of the packages and server code, the server app's Vite widget bundle (`build:ui`), the CLI's tsdown bundle (`apps/cli/dist`) and the VS Code extension's esbuild bundles; excludes widget `.tsx` type errors in packages                                                                                                                                                                                                                                                                              |
| `pnpm typecheck`  | **The only check that type-checks widget code**: `tsc -p tsconfig.widgets.json` in the two connector packages and widget-shell (its view half), `tsc -p tsconfig.ui.json` (and `tsconfig.test.json`) in the server app; the VS Code extension per layer, each with that layer's runtime globals only                                                                                                                                                                                                                                     |
| `pnpm test`       | Vitest unit tests, the server app's wire-contract tests and tools/list goldens (in-process boot, loopback HTTP), the VS Code extension's architecture tests, the per-package coverage floors, then `node --test` over `scripts/*.test.mjs` (repo guards and gate self-tests, below the table); docs-refs, old-names and `lint:package-scripts` also run in Lint + Format; **no widget rendering** (the VS Code webview tests render in Chromium; locally once: `pnpm --filter pulse-cockpit exec playwright install chromium`)           |
| `pnpm lint`       | ESLint per package incl. the pattern gates, then dependency-cruiser (`lint:architecture`, `:cli`, `:vscode`), `lint:naming`, `lint:package-scripts`, `lint:ratchets` (needs `git fetch origin`), knip (`lint:deadcode`: everything but exports and types; `:exports`: exports and types in every workspace but the vendored docs kit) and `lint:github`                                                                                                                                                                                  |
| `pnpm fitness`    | Report: architecture graph, per-package coverage and engine-core's mutation score; locally after `pnpm test` (no CI job on a pull request), else the "Mutation summary" job of `.github/workflows/mutation-nightly.yml`                                                                                                                                                                                                                                                                                                                  |
| `./gradlew build` | Kotlin compile + unit tests + Konsist architecture tests (run in `engine-plugins/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `test:host`       | `pnpm --filter @miragon/pulse-mcp-server test:host`: Playwright host simulation of the **built** widget bundle behind a SEP-1865 host shim, the real `engine_open_cockpit` against a stub engine (`pinned …` scenarios are known defects, flipped when fixed); CI "Widget host simulation (test:host)"; run it for changes to widget-shell, pulse-ui, `src/ui/` or the mcp-use pin                                                                                                                                                       |
| Template          | `scripts/test-template.sh` (in `pnpm check:all`; CI "Composed-server template (Build + Test)"): packs the published libraries (`scripts/workspace-packages.mjs`), checks the tarballs' contents (`scripts/pack-contents.mjs`), points a copy of `templates/composed-server` at them and runs its build, typecheck and tests, its pins checked against the workspace first (`scripts/template-pins.mjs`). ESLint, knip and dependency-cruiser skip `templates/`: the template's composition-root rules (invariant 8) are review knowledge |
| Docker build      | `.github/workflows/docker-build.yml`: plain `docker build` of the root `Dockerfile` (no push) on every PR touching what the build stage copies                                                                                                                                                                                                                                                                                                                                                                                           |
| Engines           | `Engines (<flavor>)` in `.github/workflows/ci.yml`: CIB seven and Operaton in Testcontainers (Camunda 7's image left Docker Hub in November 2026), running the CLI's suites and the VS Code extension's conformance laws (`test:engines`; images pinned in `apps/cli/test/integration/support/engines.ts`); the `Engines` job aggregates the legs                                                                                                                                                                                        |
| VS Code smoke     | activation + every contributed command in VS Code stable under Xvfb, `test:smoke` (`.github/workflows/ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| VS Code package   | `vsce package` dry run of the production build (`.github/workflows/ci.yml`): bundles in, no sources, maps or node_modules; the webview budget is `pnpm test`'s (`apps/vscode/test/architecture/bundle-budget.test.ts`)                                                                                                                                                                                                                                                                                                                   |
| CLI jobs          | `ci.yml` in the `cli` scope: `CLI binary (<target>)` (single executable on Linux x64, macOS arm64, Windows x64), `CLI image (build + smoke)`, `CLI plugin (validate)`, aggregated by `CLI (all checks)`                                                                                                                                                                                                                                                                                                                                  |
| CI scopes         | The `changes` job runs `scripts/ci-scopes.mjs` over a PR's files and every other job runs only in its scope (a skipped job reports success); "Lint + Format" runs on every PR. A new job gets `needs: changes` and a scope; a test that starts reading a file outside its package adds that path to `PATH_RULES` or `ALSO_READ_BY`, unless that path already selects the job that runs the test (a package's code and data files select the TypeScript job)                                                                              |
| Manual            | `pnpm play` (or the playground + `pnpm dev` with a `.env`), then exercise tools/widgets in the inspector. The default boot is read-only; write paths need an explicit suffix: `pnpm play --admin`, or `MCP_ACTIVE_MODULES=engine:admin,analytics` in `.env`                                                                                                                                                                                                                                                                              |

The repo guards `pnpm test` runs over the real tree: docs-refs, old-names, published imports,
tool-name and hand-off references, server env names, the source scan's `APP_SCAN` and the
template pins. Besides the dependency-cruiser and ESLint self-tests (invariants 8 and 1), the
naming, package-scripts, ratchet, GitHub-config, CI-scope and pack-content checks each prove
themselves on planted violations in fixtures; the extension's own gates live in
`apps/vscode/test/architecture`.

A green `pnpm build && pnpm typecheck && pnpm test && pnpm lint` (`pnpm check` runs them) is the minimum bar for
every change, in that order (`scripts/published-imports.test.mjs` reads the built CLI bundle);
widget changes additionally need `test:host` plus a manual render check via the inspector (the
host simulation renders one real view, not every widget's data path).

**Ratchets only move one way.** `scripts/check-ratchets.mjs` (`pnpm lint:ratchets`) compares
each against the merge base with `origin/main`, and its header lists them: coverage floors in
each `vitest.config.ts` rise (raise one when you better a file); a `stryker.config.json`'s
`mutate` allowlist (the tested surface; today engine-core's alone) grows and its
`thresholds.break` rises; the ESLint budgets (complexity 15 and 400 lines; the CLI and the
VS Code extension 10 and 300), knip ignores (each with its reason), the char and bundle
budgets (Contracts) and inline suppressions only shrink; gate commands stay as they are; a
second config that would shadow a ratcheted one fails. The one escape is a
`Ratchet-Exception: <reason>` commit trailer, which turns the failures into warnings for the
reviewer; never weaken the checker instead. The trailer covers the commit that carries it: the
checker replays the range commit by commit and waves a violation only when every commit that
makes it carries one.
`pnpm lint:package-scripts` holds a package's first configs: every package with `src/` has a
`vitest.config.ts`, and a valid `stryker.config.json` sits in each package `MUTATED_PACKAGES`
lists and in no other.

**Mutation testing covers `@miragon/pulse-engine-core` only** (owner decision, 2026-11-04). It
holds the pure engine rules the CLI, the MCP server and the VS Code extension share, so a
surviving mutant there is a wrong rule in all three; in every other package a full run costs
more than it finds. A package joins only by an owner decision, as an entry in
`MUTATED_PACKAGES` (`scripts/check-package-scripts.mjs`). It runs nightly
(`.github/workflows/mutation-nightly.yml`), never on a pull request (owner decision); a pause
flips `scripts/mutation-pause.mjs` and drops the schedule. Locally:
`pnpm --fail-if-no-match --filter @miragon/pulse-engine-core exec stryker run` (`--mutate <file>`
narrows it), with `vitest.stryker.config.ts`: coverage off, since a threshold failure would read
as a killed mutant.
