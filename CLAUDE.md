# CLAUDE.md

Guidance for AI agents working in this repository. Read the repo skill of your feature path
before you add code: `.claude/skills/add-bpm-feature` (camunda7 tools, queries, widgets),
`.claude/skills/add-analytics-feature` (analytics) and `.claude/skills/add-settings-section`
(a module's user settings: a `profile.modules.<module>` slice, its tool triple and its section
on the settings page).

Each rule below names the gate that enforces it; when a gate fails, its message and source
carry the details. A rule without a gate is review knowledge and keeps its reason.

Docs are held to the code:

- `apps/mcp-server-camunda7/test/docs-refs.test.ts` reads the tracked Markdown (this file, the
  READMEs, agent files, skills and `docs/`): every backticked tool name is registered, every
  repo path exists, the identifiers of the skills and nested agent files exist, and each docs
  page stays within its line budget.
- `apps/mcp-server-camunda7/test/old-names.test.ts` fails on a technical name of the retired
  operate CLI, on the unscoped npm package pulse-cli (someone else's) and on an image off GHCR.
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
(built on `mcp-use` plus the `@miragon/mcp-toolkit-*` packages) for Camunda 7 / CIB seven BPM
operations and Prometheus-backed process analytics, including interactive React widgets
(MCP Apps), plus a command line interface (`apps/cli`) and a VS Code extension (`apps/vscode`)
for the same engines.

| Path                                                 | Contents                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mcp-server-camunda7/`                          | The MCP host: composes plugins, bundles the widget UI, serves HTTP on `:8400`                                                                                                                                                   |
| `apps/cli/`                                          | The CLI (npm `@miragon/pulse-cli`): every REST operation of the engine as a command, generated from its OpenAPI spec, plus the workflow commands; its rules in `apps/cli/CLAUDE.md`                                             |
| `apps/vscode/`                                       | Pulse for VS Code (`pulse-cockpit`, a .vsix): a Preact webview over an engine-neutral contract and core, the C7 adapter; its rules in `apps/vscode/CLAUDE.md`                                                                   |
| `packages/connectors/camunda/camunda7-connector/`    | camunda7 module: operations tools, widget tools, widgets, pipeline steps                                                                                                                                                        |
| `packages/connectors/analytics/analytics-connector/` | analytics module: Prometheus-backed tools, dashboards, comparison widgets                                                                                                                                                       |
| `packages/connectors/camunda/camunda7-client/`       | Generated CIB seven REST SDK (`src/generated/`) + Zod input schemas (`src/schemas/`)                                                                                                                                            |
| `packages/connectors/analytics/analytics-client/`    | Prometheus client + PromQL query functions (`src/queries/`) + Zod schemas                                                                                                                                                       |
| `packages/core/widget-shell/`                        | Shared widget kit: UI primitives incl. `useApplyTheme` + the host app shell `AppShellProviders` (`/widgets`), `adaptDataWidget` (`/ui`), view + data-feed builders, the `shell:*` catalogue + the host-boot helpers (`/server`) |
| `engine-plugins/`                                    | Kotlin/Gradle: CIB seven OTEL metrics plugin (Java 21)                                                                                                                                                                          |
| `playground/`                                        | Demo env: CIB seven showcase engine, Compose stack, Fly.io deploy                                                                                                                                                               |
| `docs/`                                              | Pulse docs, a VitePress site on GitHub Pages (getting started, usage, architecture, developer, operations)                                                                                                                      |
| `docs/mcp/`                                          | The MCP server's pages of the docs site (getting started, usage, reference, operations, architecture, developer)                                                                                                                |
| `docs/cli/`                                          | The CLI's pages of the docs site (install, commands, configuration, authentication, AI agents, development)                                                                                                                     |
| `docs/vscode/`                                       | The VS Code extension's pages of the docs site (installation, configuration, usage, architecture)                                                                                                                               |

Three axes decide where code goes, and they stay apart:

- Vendor (CIB seven, Operaton, Camunda 7): runtime config per engine, `flavor` →
  `EngineProvider` (invariant 8), never a package or an app.
- Dialect (an engine API family; Camunda 7 today): one package family under
  `packages/connectors/<family>/`: `<name>-client` (the wire: SDK, schemas, engine contract)
  and `<name>-connector` (the MCP module); a package two interfaces share is extracted on its
  second consumer. A different dialect is a new family plus its own MCP server app.
- Interface (how a person or an agent reaches an engine): an app under `apps/`, today the
  MCP server, the CLI (`apps/cli`, rules in `apps/cli/CLAUDE.md`) and the VS Code extension
  (`apps/vscode`, rules in `apps/vscode/CLAUDE.md`). Another interface (a second editor
  extension, say) is an app of its own. Apps never import each other, and no package imports
  an app.

The architecture invariants below are written for the MCP server, its modules and its widgets.
The package rules of invariant 8 (layout, naming, dependency edges) hold for every workspace
package; another interface app keeps its own rules in its own CLAUDE.md.

## Commands

```bash
pnpm install --frozen-lockfile       # all deps are public; no registry credential needed

pnpm build                           # turbo build across the monorepo (runs `generate` first)
pnpm typecheck                       # tsc --noEmit everywhere, incl. widget/UI tsconfigs
pnpm test                            # vitest across the workspace
pnpm lint                            # eslint per package (`pnpm lint:fix` to autofix)
pnpm format:check                    # prettier check (`pnpm format` to write)
pnpm generate                        # regenerate the CIB seven SDK from the OpenAPI spec

# Run the server locally (needs the Docker infra + a .env file, see .env.example):
docker compose -f playground/docker/docker-compose.yml up -d
pnpm dev                             # MCP server on :8400

# Kotlin engine plugins (Java 21):
cd engine-plugins && ./gradlew build # compile + unit tests + Konsist architecture tests

# Docs site:
pnpm docs:dev                        # local dev server; pnpm docs:build to build

# The CLI (apps/cli; Docker for the engine suites, build first):
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog       # regenerate the command catalog
pnpm --fail-if-no-match --filter @miragon/pulse-cli test:engines  # Testcontainers suites
```

`pnpm dev` serves the MCP endpoint at `http://localhost:8400/mcp` and the `mcp-use`
inspector UI at `http://localhost:8400/mcp/inspector` (served by `mcp-use dev` only;
the production entrypoint mounts no inspector). Use the inspector to call tools and
render widgets manually.

If generated SDK files look wrong (e.g. `client.gen.ts` importing `./src/hey-api.js`
instead of `../hey-api.js`), the shared turbo cache replayed a poisoned `generate`
output. Fix it with `pnpm exec turbo run generate --filter=@miragon/pulse-camunda7-client --force`.

## Design-System (verbindlich)

Alle UI- und Gestaltungsarbeit folgt dem Miragon-Design-System für Produkte. Quelle der
Wahrheit ist die Skill `miragon-brand:modeler-tool-design` im Repo Miragon/corporate-identity;
sie lädt bei UI-Arbeit, wenn das Plugin installiert ist. Ohne Plugin den Guide direkt lesen:
https://raw.githubusercontent.com/Miragon/corporate-identity/main/plugins/miragon-brand/skills/modeler-tool-design/assets/modeler-design-system.md
Für jedes Wort in der UI gilt zusätzlich `miragon-brand:brand-tone`.

Die Marken-Tokens kommen aus der Skill (`cd-tokens.generated.css`); keine HEX-Werte forken. Das
Default-Theme des Toolkits (`@miragon/mcp-toolkit-ui/theme.css`) vendort sie unverändert und
bildet seine Rollen-Variablen in Hell und Dunkel darauf ab. Die App
(`apps/mcp-server-camunda7/src/ui/globals.css`) und das Starter-Template
(`server/src/ui/brand.css`) importieren es nach `tailwindcss` und überschreiben nur Rollen- und
Alias-Variablen (`--primary`, `--link`, `--focus`, `--<ton>`, `--<ton>-soft`, `--<ton>-ink`,
Radien, Schatten), nie `--cd-*`; Komponenten nutzen nie Palettenklassen oder rohe Farben. Die
Docs-Site nimmt das Doku-Kit der CI unverändert (`docs/.vitepress/miragon/`,
`docs/public/logo/`; bei jedem CI-Release neu vendoren, nie von Hand ändern).

Ein `--cd-*` steht nur in der Toolkit-Kopie und in vendorten Kopien, deren Manifest
`SANCTIONED_TOKEN_MANIFESTS` freigibt: heute das Doku-Kit und das Theme der VS-Code-Webview
(`apps/vscode/src/webview/theme/manifest.json`). Eine weitere Kopie kommt mit einem Manifest im
Format des Kits und einem Eintrag dort, nie als Ausnahme im Scan. Der Drift-Test ist
`apps/mcp-server-camunda7/test/ui-stylesheet.test.ts` (mit
`apps/mcp-server-camunda7/test/vendored-tokens.ts`); `test:host` prüft das gebaute Stylesheet.

UI-Texte gibt es auf Deutsch und Englisch, je nach Host-Locale. Deutsch folgt brand-tone
vollständig: du-Ansprache, AI statt `KI`, „CIB seven“, kein Gedankenstrich als Verbinder,
normale Groß- und Kleinschreibung, Fehlermeldungen sagen, was passiert ist und was du tun
kannst. Englisch übernimmt die übertragbaren Regeln: Sentence case, aktiv, kein Em-Dash als
Verbinder. `.miragon/brand.json` schaltet den brand-lint-Hook für jede geänderte Datei ein;
Strings in `.ts`/`.tsx` prüfen die Gates aus `@miragon/pulse-widget-shell/testing`
(Invariante 6, dort auch das Glossar).

### Abweichungen für eingebettete Chat-Widgets

Die Widgets laufen als MCP Apps im Rahmen eines Chat-Hosts. Dafür gelten diese bewussten
Abweichungen vom Guide (Owner-Entscheidung, nur hier dokumentiert):

- Theme: Die Widgets folgen dem Host-Theme (#339), ohne Umschalter in der App und ohne
  Theme-Feld im Profil; ohne Host das OS. Dunkel entsteht streng aus den Dark-Ground-Regeln der
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
   input schema in `packages/connectors/camunda/camunda7-client/src/schemas/`, then register
   the tool in `packages/connectors/camunda/camunda7-connector/src/tools/<domain>.ts` via the
   `register` callback of `createToolRegistrar` (wired in `src/tools/index.ts`): a `category`
   matching its domain file (`"analytics"` in the analytics module), `...engineParamShape` in
   the input schema, the handler wrapped in `withEngine(...)` (both from
   `src/lib/with-engine.ts`). Canonical shape: `camunda7_list_process_instances` in
   `packages/connectors/camunda/camunda7-connector/src/tools/process-instances.ts`. ESLint
   (`no-restricted-syntax` in `eslint.config.mjs`) blocks raw `server.tool()` in every spelling
   outside the widget-path files its `ignores` lists. `no-restricted-syntax` is ONE rule: a
   later flat-config block REPLACES its selectors, so a glob two gates share gets one block with
   the union (`scripts/eslint-gates.test.mjs`).
   - Annotations decide the toolset. A destructive or admin tool goes into `ADMIN_ONLY_TOOLS`
     (`src/lib/toolsets.ts`); `src/lib/toolsets.test.ts` checks every registered tool (every
     write states `destructiveHint`, since MCP reads an absent hint as `true`). Fix the
     annotations, not the test.
   - Toolsets are FAIL-CLOSED: without a suffix a module runs its read-only floor on an
     unauthenticated boot and its standard toolset (camunda7 `operations`, analytics
     `standard`) under OAuth; `admin` is never implied; an empty or unknown suffix warns and
     falls back to the floor; nothing resolves to "everything" (widget-shell's
     `toolsets.test.ts` + `composition.test.ts`).
   - Admin-only by decision, each with `destructiveHint: true`: the engine-wide
     `camunda7_throw_signal` and the external-task worker protocol (`camunda7_fetch_and_lock`,
     `camunda7_complete_external_task`, `camunda7_handle_external_task_failure`); the read path
     `camunda7_list_external_tasks` and the recovery `camunda7_set_external_task_retries` stay
     in `operations`.
   - `camunda7_create_deployment` registers only with `CAMUNDA_ALLOW_DEPLOYMENTS=true`:
     deploying BPMN/DMN is code execution inside the engine JVM (JUEL, scripts). Never relax
     that gate or fold it into a toolset.

2. **Never talk to an engine directly.** All engine access goes through
   `resolveEngine`/`withEngine` (`packages/connectors/camunda/camunda7-connector/src/lib/`),
   which routes by precedence: per-call `engine` override > the caller's saved default engine
   (`profile.modules.camunda7.defaultEngineId`, written by `camunda7_select_engine` and the
   settings page; resolved only in `lib/engine-preferences.ts`) > the single configured
   default. There is deliberately NO in-memory session selection (replica-unsafe; mcp-use 2
   issues no session ids). A client you construct or cache yourself breaks multi-engine
   routing; `resolveEngine` (async) already returns `baseUrl`/`cockpitUrl`.

3. **Widget registration is a four-link chain**; a widget that misses a link is silently
   absent somewhere:
   - `packages/connectors/camunda/camunda7-connector/src/widgets/registry.ts`: component →
     dataType via `adaptDataWidget`
   - `packages/connectors/camunda/camunda7-connector/src/definition.ts`: widget metadata (`id`,
     `requires`, `size`, `propsSchema`); people's texts come from the catalogs' `builder.*`
     entries via `createBuilderTexts`, `description` stays the model's
     (`src/builder-texts.test.ts`)
   - `apps/mcp-server-camunda7/src/ui/widget-registry.ts`: the host bundle map
   - `packages/connectors/camunda/camunda7-connector/src/tool-names.ts`: the tool-name constant
     for every `show_*`/`*_data` tool, so in-widget navigation stays rename-safe

   Links 1↔2: `src/widgets/catalogue-sync.test.ts` in both modules; link 3:
   `apps/mcp-server-camunda7/test/widget-registry.test.ts`.

4. **The `dedupe` array in `apps/mcp-server-camunda7/vite.config.ts` is load-bearing: never
   remove or trim it.** Without it each widget package bundles its own React/toolkit
   instance, the React contexts no longer match, `useCallTool()` is undefined, and every
   in-widget query hangs on "Loading…".

5. **There are three render paths; pick deliberately:**
   - Registrar tools (`src/tools/`): plain JSON data _for the model_.
   - Widget tools (`show_*`, spread `...showToolBinding(name, title)` from
     `@miragon/pulse-widget-shell/server`; camunda7's `registerShowTool` does it): render a
     widget for the user and return a summary for the model.
   - `*_data` feeds (spread `...appOnly`, **no** view binding; camunda7's `registerDataFeed`):
     app-only JSON for in-widget refresh and navigation, returned as
     `buildDataFeedResult(data)`. SEP-1865 hosts hide them from the LLM, and a widget-tool
     result would be rendered by the host instead of returned to the in-widget `callTool()`.

   All three take STRICT input (`strictInput: true`, `strictToolInput(…)`): an unknown key is
   a tool error listing the valid keys, never a silently stripped filter
   (`test/strict-input.e2e.test.ts` in the app). Parameter names follow the guide in the
   add-bpm-feature skill.

6. **MCP App widgets compose from the shared kit (`@miragon/pulse-widget-shell/widgets`) and
   the toolkit (`@miragon/mcp-toolkit-ui`); never re-inline their primitives.** This covers
   the React views an MCP host renders (widget-shell's `src/ui`, the connectors'
   `src/widgets`, the host bundle in `apps/mcp-server-camunda7/src/ui/`); another interface
   app's own UI follows the design system above.
   - **One kit.** The toolkit's components, its tone model (`TONE_*`, `resolveTone`) and its
     `cn` come from the toolkit; widget-shell exports only what it adds
     (`src/ui/toolkit-overlap.test.ts`). Settings sections use `SettingsCard`/`SettingsField`/
     `SettingsInput`: an invalid entry is said inline (`error`), never clamped silently, and a
     section that cannot save says why above its disabled fields.
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
   - **Type, dates and numbers.** Text sits on the toolkit's `TYPE_SCALE` (13 px floor,
     `scanTypeScale`). Dates and numbers go through the kit's `format*` helpers in the locale
     `ProfileGate` publishes (ESLint gates, `scripts/eslint-gates.test.mjs`). A count reaches a
     catalog entry already formatted, and the entry puts the noun in the right number
     (`countOf`, `plural(…)`), never a `…One`/`…Other` key pair.
   - **BPMN** renders through `useBpmnViewer` + `BpmnZoomControls` on a forced-light canvas
     whose colours all come from `BPMN_TOKENS` (`packages/core/widget-shell/src/ui/bpmn-tokens.ts`).
   - **Paged lists** compose `usePagedListView` (the feed takes `firstResult`/`maxResults` and
     returns an honest total; counts, filters and model contexts read the payload ON SCREEN,
     never the request) + `ListTable` + `PagedListFooter`. Optimistic local state resets with
     `useResetOnChange(data, reset)`, never in an effect.
   - **A status is a tone, never a coloured word.** `ToneVariant` is
     `danger | warning | success | info | neutral`: an open incident or a failed job without
     retries is `danger`, a failed job with retries left or a degraded engine `warning`, a
     count without a state `neutral`; the ladder is the kit's `countTone`/`severityTone`. Each
     tone has three roles: `--<tone>` (dot, edge, icon), `--<tone>-soft` (tint, black text) and
     `--<tone>-ink` (text on card or page, never on a tint, never a number). Numbers stay
     neutral. Components use role names only (`scanColors`); `src/ui/tone-contrast.test.ts`
     holds every role pair to WCAG AA (a role a brand may override belongs in
     `ROLE_CONTRAST_PAIRS`). A brand override goes under `:root` AND the dark scopes, or a
     light-only value shows in dark (`parseThemeVariables`).
   - **Icons are Lucide**, never glyphs or emoji: `Icon`, 16 or 24 px (`scanIconSizes`), its
     stroke through lucide's own `strokeWidth`, never a CSS `stroke-width` rule, which would
     beat the toolkit's `LucideProvider`. Every package that imports `lucide-react` and every
     host bundle pin the SAME exact 1.x devDependency (today `1.61.0`): two versions resolve a
     second mcp-use/toolkit instance and split the React contexts.
   - **Actions and hand-offs.** A view's actions are ONE group in `WidgetHeader` `actions`, all
     `size="sm"`, ordered: deterministic steps, the engine's own web app
     (`OpenInCockpitLink`), then the chat; the meta line under the title holds facts only
     (`action-group.test.tsx`), and a state goes into the header's `badge`, not an icon tile. A row's drill is `DrillButton` (`row-actions.test.ts`), its
     further actions sit in `MoreActions`. A chat hand-off is the kit's `HandOffButton`
     (`action` from `HAND_OFF_ACTIONS`: one Lucide icon and one verb naming the chat per
     function), a secondary outline after the action it accompanies; ESLint gates ban sparkle
     icons and a raw `AskAiButton`, so a new function goes into the kit's table.
   - **Brand gates and glossary.** Every widget package runs the gates of
     `@miragon/pulse-widget-shell/testing` (`catalogTextFindings`, `scanGlyphs`,
     `scanIconSizes`, `scanColors`) in its own `brand-gates.test.ts`, and its en/de catalogs
     hold the same keys. One term per thing across the product: `PRODUCT_GLOSSARY` (Incident,
     "Jobs ohne Versuche" / "jobs without retries", "bereitstellen", Geschäftsschlüssel,
     aussetzen, Versuche, alle Engines), checked with each connector's own terms by
     `src/messages/glossary.test.ts` and listed in `src/messages/GLOSSARY.md`.
   - **Locale on the server.** A verdict travels as data and the widget words it. A show tool
     titles its view only in a language the profile names (`createLocalizeViewFor`;
     `view-title.test.ts`); otherwise the widget's heading names it in the host's language.
   - **Everything a widget tells the model is built by `askAiPrompt`/`modelContextText`**
     (`packages/core/widget-shell/src/ui/ask-ai-prompt.ts`). A hand-off is posted as the
     USER's message, so engine text (messages, names, business keys) goes into `untrusted`,
     fenced and length-capped; intents and summaries are static catalogue text without tool
     names, and the `tools` a prompt names are filtered by the live surface (a prompt whose
     tools are all absent renders nothing). Playbooks and the engine-pinning rule live in the
     module `instructions`. `apps/mcp-server-camunda7/test/hand-off-surface.test.ts` checks it
     against tools/list per toolset.

7. **Shared server data paths are single-sourced.**
   - Definition name/version/instance lookups come from
     `packages/connectors/camunda/camunda7-connector/src/data/definition-info.ts`. Every
     camunda7 view has ONE builder in `src/data/` behind its show tool, `*_data` feed and
     pipeline step (`steps/steps.test.ts`).
   - Honest numbers (`data/engine-reads.ts`): **primary rows/counts propagate errors;
     enrichment degrades to `null` (rendered "—"), never 0**; totals come from `/count` or
     statistics, never a capped page or scan; a definition view spans every version of its key
     (`data/honest-numbers.test.ts`).
   - No view payload carries BPMN XML (a show tool's `structuredContent` reaches the model on
     some hosts): a view names the version it draws (`diagramDefinitionId`) and `BpmnDiagram`
     reads the XML from the app-only `camunda7_bpmn_xml_data` (the heatmap from
     `analytics_bpmn_xml_data`). The ONE XML read is `lib/definition-xml.ts`, cached per engine
     client and per caller.
   - Every engine REST rule the client defaults miss (`toEngineDate`, `engineSorting`,
     `toEngineVariable(s)`, text/plain endpoints, incident recovery, queued batches) lives in
     the engine contract, `packages/connectors/camunda/camunda7-client/src/engine-contract/`,
     used by `tools/` AND `data/`; every write tool has a recording-fake-engine case in
     `src/tools/*.wire.test.ts`. Analytics periods derive from `PERIODS`/`PERIOD_RANGE`.
   - The profile store is core
     (`packages/core/widget-shell/src/profile-{record,store,store-postgres,migrations}.ts`); the
     record is connector-free (language + `modules.<module>` slices). Records migrate on read
     (`parseStoredProfile`); a `PROFILE_SCHEMA_VERSION` bump needs its `PROFILE_MIGRATIONS`
     entry. Saves merge over the RAW stored document (`mergeStoredProfile`), so keys a newer
     build wrote survive.
   - **Whose** profile a request touches is decided in one place for all modules
     (`resolveProfileKey` in `packages/core/widget-shell/src/profile.ts`); a module-local copy
     would split one user's settings across two records. The only identity is the OAuth caller
     (`resolveCaller` over the handler `ctx`; always pass it): nothing a client chooses (a
     session id, a header) is a key, and a request without OAuth has NO identity (saves
     refuse), never the `anonymous` record, which only a declared local caller reaches.
   - Persistence (`createSql`, `runMigrations`, `createPostgresDashboardStore`) lives in
     widget-shell next to the profile store; the app's `src/persistence/index.ts` only selects
     the backend (`DATABASE_URL` beats `MCP_PROFILE_DIR`/`MCP_DASHBOARD_DIR` beats in-memory).
     Migration `name`s are the keys in `schema_migrations`: append-only, never renamed (a
     rename re-runs the DDL on every database). A write that first-creates a row takes a
     per-key `pg_advisory_xact_lock`: `SELECT … FOR UPDATE` cannot lock a row that does not
     exist yet, so two concurrent first saves would both create and the second would win.

8. **Modules are self-contained peers; an MCP server app is a thin composition root.** The
   package rules hold for every workspace package, the composition-root rules for MCP server
   apps (this repo's and the template's).
   - **Layout and naming** are load-bearing: the gates key on them, and a package that breaks
     the convention silently falls out of them. Connector modules live at
     `packages/connectors/<family>/<name>-connector` (npm `@miragon/pulse-<name>-connector`),
     their SDK leaves at `packages/connectors/<family>/<name>-client`, foundation packages
     under `packages/core/` (npm `@miragon/pulse-<name>`), apps at `apps/<dir>` (npm
     `@miragon/pulse-<dir>`); the VS Code extension is `pulse-cockpit` (vsce takes no scope).
     Rules key on `@miragon/pulse-`, never on bare `@miragon/`, which the toolkit shares. Gate:
     `scripts/check-package-naming.mjs` (`pnpm lint:naming`).
   - **Dependency edges** (`.dependency-cruiser.cjs`, `pnpm lint:architecture` +
     `pnpm lint:architecture:cli`): connectors never import each other, a connector imports
     only its own client, clients are leaves, core is the foundation, no package or app imports
     an app, no cross-package deep imports. The interface apps import no workspace package and
     nothing of the MCP/UI/server stack, zod included. Each rule has planted violations in
     `scripts/dependency-cruiser-gates.test.mjs`; a new app adds its npm name to the config's
     `APP_PACKAGES`. A rule names all three shapes an import reaches it in (a relative escape,
     `<importer>/node_modules/<name>/`, a bare specifier) and never exempts a package's own
     directory in a `pathNot`.
   - **The module port.** Each module exports its definition in `src/module.ts` (config
     schema, `configFromEnv`, `knownEnvVars`, `toolsets`, `bootWarnings`, `instructions`, the
     rules for every tool instead of 60 descriptions; plugin factory), conforming STRUCTURALLY
     to `ComposableModule<TShared>`. The composition machinery (`composeModules`,
     `MCP_ACTIVE_MODULES` with `module:toolset` suffixes, `resolveBoot`) lives in
     `@miragon/pulse-widget-shell/server`. A root passes `authenticated` only when it actually
     INSTALLED OAuth (`oauthFromEnv`), never inferred from an env var. Framework durable writes
     (the toolkit builder's dashboard tools, `shell_save_settings`) register only when
     `frameworkWritesAllowed(boot)` holds: OAuth installed AND no module on its read-only floor.
   - **The app composes, nothing more.** `setup.ts` declares the module list and wires
     `SharedResources` (profile store; `fetchBpmnXml`, camunda7's XML lookup for analytics;
     `engineIds`, the ONLY engines analytics reads, so analytics needs NO engine SDK). Widget
     catalogues, components and boot plumbing live in packages; the bundle root is
     `AppShellProviders` + `LocalizedAppView` (provider order load-bearing), the stylesheet the
     toolkit's `theme.css` after `tailwindcss` (`test/ui-stylesheet.test.ts`).
   - **One boot.** `createComposedServer` owns the boot order and the production listener.
     Each MCP server app owns ONE `createApp(env, deps?)` (`src/app.ts`) that `src/index.ts`
     AND the e2e suites boot, never a test-only re-implementation. Readiness probes the
     server's OWN dependencies only, never engines or Prometheus; metric labels stay bounded
     (tool catalogue + known routes, never users or arguments). The HTTP edge guard
     (`resolveHttpEdgePolicy`) is DNS-rebinding protection that exempts `/health*` and
     `/metrics`; never swap it for mcp-use's `allowedHosts`, which guards those too.
   - **Cross-module UI is tiered**: `shell:*` widgets via `props.dataKey`; raw tool-name
     strings with graceful degradation (`process-incidents/flow.tsx` →
     `analytics_bpmn_heatmap_data`); hard-composed views go in a dedicated package created with
     the first real view, never in the app, never as module-to-module imports. The host bundle
     is static, so a surface that needs another module probes one of its cheap feeds
     (`useAnalyticsActive`). `apps/mcp-server-camunda7/test/tool-name-refs.test.ts` checks every
     `<module>_…` literal against the booted tools; the apps the source guards read are listed
     in `APP_SCAN` (`apps/mcp-server-camunda7/test/source-scan.ts`), where a new app adds its
     entry.
   - **Settings.** The page is the shell's (#346, `createShellPlugin`). Each module owns its
     section (widget + `*_data` feed + save tool via `registerSettingsSection`; reference
     `analytics-connector/src/settings-tools.ts`) and persists under
     `profile.modules.<module>`. `settingsLayout` assembles the page from every
     `<module>:settings` id, so that convention is load-bearing
     (`apps/mcp-server-camunda7/test/widget-registry.test.ts`). Save-input schemas are
     default-FREE (`withoutDefaults`): zod 4 re-applies `.default()`s through `.partial()` and
     turns omitted fields into silent resets.
   - **Writes outside the registrar** gate themselves against the module's declared toolset
     names (`allowsDurableWrites` in analytics, `isToolInToolset` in camunda7), never an
     ad-hoc `toolset === "read-only"` or `toolset === undefined` compare, and carry that
     decision into the view as `canSave`, so a section shows disabled fields instead of a Save
     button whose call would fail.
   - **In-widget engine writes** run through ONE primitive, `useEngineAction`
     (`camunda7-connector/src/widgets/lib/engine-action.ts`): the gate (`allowed` from
     `camunda7_widget_actions_data`, AND `available`: no write on an ended, cancelled or
     unconfirmed instance), the confirmation that names its target, the targeted invalidation
     and the optimistic marks (`WRITE_POLICY`); controls are hidden, not disabled
     (`src/widget-actions.test.ts`, `widgets/action-gating.test.tsx`). A standalone view
     refreshes after a write because its tool result seeds a live feed query.
   - **Vendors** are per-engine runtime config (`flavor` → `EngineProvider` in
     `packages/connectors/camunda/camunda7-connector/src/providers/`); the port holds ONLY real
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
  why `analytics_engine_compare` REQUIRES a `processDefinitionKey`; keep it required
  (`src/tools/engine-{compare,landscape}.test.ts`).
- **Pinning is split by dependency stanza.** `dependencies`/`devDependencies` stay EXACT
  (`save-exact=true` in `.npmrc`). Consumer-shared libraries are RANGED `peerDependencies`, so
  a downstream app dedupes them (`react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`,
  `@miragon/mcp-toolkit-*` `~2.8.1`), each also an EXACT devDependency. A published package
  imports only what its `dependencies` or `peerDependencies` declare
  (`apps/mcp-server-camunda7/test/published-imports.test.ts`). **`mcp-use` is exactly pinned
  even as a peer** (`2.7.3`): a duplicate instance breaks the React context and hangs every
  in-widget query (invariant 4). Name the required `mcp-use` version in each package README and
  the release changelog. The toolkit peers `mcp-use` exactly, so a toolkit minor or major bump
  is a joint toolkit + `mcp-use` bump across every package incl. `templates/composed-server`
  (`scripts/test-template.sh`), never one package in isolation.
- **The widget `_meta` contract is split since mcp-use 2; never hand-write the `ui` half.**
  mcp-use emits the MCP-Apps keys from the tool's `view`/`visibility` fields and OVERWRITES
  the `ui` namespace on tools/list; the toolkit's `appsSdkMeta` stamps only the `openai/*`
  half. `apps/mcp-server-camunda7/test/widget-contract.e2e.test.ts` checks the wire **by
  name** (every `*_show_*` tool carries the widget `_meta`, every `*_data` feed is app-only),
  so the naming convention is load-bearing.
- **The tools/list wire payload is a golden, per toolset**
  (`apps/mcp-server-camunda7/test/tools-list.golden.test.ts`). The ONLY update path is
  `GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server-camunda7 test` (refused in CI);
  never hand-edit a golden. `__golden__/char-budgets.json` pins each surface's model-visible
  size, shrink-only: a change that makes the model read MORE text needs a `Ratchet-Exception:`
  trailer.
- **The widget bundle has a budget.** Every view resource inlines the whole bundle, so its
  size is the cost of every render: `test/__golden__/bundle-budget.json` holds shrink-only gzip
  ceilings that `test-host/bundle-budget.spec.ts` checks; growth needs a `Ratchet-Exception:`
  trailer that says why.
- **Federation happens in an external MCP gateway (agentgateway) IN FRONT of this server;
  this repo builds one self-contained MCP server including its UI.** Federation was dropped
  deliberately in #162: no upstream/proxy mechanics. A gateway that terminates auth in front is
  invisible to this server: without `MCP_OAUTH` it boots read-only with no caller identity, so
  such a deployment names its toolsets in `MCP_ACTIVE_MODULES`.
- **The server reads no `PULSE_*` variable.** PulseAudio owns `PULSE_*` and `PULSE_CLI_*` is
  the CLI's; the typo warner watches the prefix of every known variable, so one server name
  under `PULSE_` would make it warn about both in a shared environment. A server setting goes
  into its own family (`CAMUNDA_*`, `PROMETHEUS_*`, `ANALYTICS_*`, `MCP_*`, `DATABASE_URL`;
  `apps/mcp-server-camunda7/test/setup-env.test.ts`).

## Releases & toolkit contributions

The release workflows hold the publish credentials and no pull request runs them;
`scripts/check-github-config.mjs` (`pnpm lint:github`) pins their security shape against the
workspace (its header lists each check).

- **One release-please train.** Conventional commits on `main` drive `release-please.yml`: one
  Release PR (tag `v<version>`) bumps the root, every app, the five packages, the template's
  pins, the camunda7-client User-Agent and `engine-plugins/gradle.properties` in lockstep
  (`extra-files` in `release-please-config.json`). Merging it creates the release; every
  publish job then waits for manual approval of the `release` environment gate.
- **npm:** the five packages and `@miragon/pulse-cli` publish through
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
  for a stable release, the formula `miragon/tap/pulse-cli` as a pull request to
  Miragon/homebrew-tap. The jobs that hold a token install nothing. A new GHCR package starts
  private; an organization owner makes it public once.
- **`@miragon/mcp-toolkit-*` lives in a separate repository** (semver): exact in
  `devDependencies` (`2.8.1`), ranged as a peer (`~2.8.1`), bumped deliberately and repo-wide.
  To validate unreleased toolkit changes, `pnpm pack` the toolkit packages, point temporary
  `overrides` in `pnpm-workspace.yaml` at the `file:` tarballs (park any `patchedDependencies`
  entry for the same package), run the full bar plus `test:host`, then revert the workspace
  yaml and lockfile. Never commit the overrides.

## Verification: what each check actually covers

| Check             | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm build`      | tsc emit of server code + the server app's Vite widget bundle (`build:ui`); excludes widget `.tsx` type errors in packages                                                                                                                                                                                                                                                                                                 |
| `pnpm typecheck`  | **The only check that type-checks widget code**: `tsc -p tsconfig.widgets.json` in the two connector packages, `tsc -p tsconfig.ui.json` in the server app; the VS Code extension per layer, each with that layer's runtime globals only                                                                                                                                                                                   |
| `pnpm test`       | Vitest unit tests, the server app's e2e smoke, wire-contract tests and tools/list goldens (in-process boot, loopback HTTP), the repo-wide `docs-refs.test.ts` and `old-names.test.ts`, the per-package coverage floors, then `node --test` over `scripts/*.test.mjs`; **no widget rendering** (the VS Code webview tests render in Chromium; locally once: `pnpm --filter pulse-cockpit exec playwright install chromium`) |
| `pnpm lint`       | ESLint per package incl. the pattern gates, then dependency-cruiser (`lint:architecture`, `:cli`, `:vscode`), `lint:naming`, `lint:package-scripts`, `lint:ratchets` (needs `git fetch origin`), knip (`lint:deadcode`, `:cli`, `:vscode`) and `lint:github`                                                                                                                                                               |
| `pnpm fitness`    | Report: architecture graph, per-package coverage and mutation scores; on a pull request the "Fitness report" job (mutation "(no run)"), nightly the "Mutation summary" job of `.github/workflows/mutation-nightly.yml`                                                                                                                                                                                                     |
| `./gradlew build` | Kotlin compile + unit tests + Konsist architecture tests (run in `engine-plugins/`)                                                                                                                                                                                                                                                                                                                                        |
| `test:host`       | `pnpm --filter @miragon/pulse-mcp-server-camunda7 test:host`: Playwright host simulation of the **built** widget bundle behind a SEP-1865 host shim, a real camunda7 show tool against a stub engine (`pinned …` scenarios are known defects, flipped when fixed); CI "Widget host simulation (test:host)"; run it for changes to the widget shell, `src/ui/` or the toolkit pin                                           |
| `pnpm test:pg`    | Reruns the suites with `TEST_DATABASE_URL` set, which un-skips the Postgres tests: **the only check that executes the Postgres adapters**; CI "Postgres adapters (test:pg)"; run it for changes to `postgres.ts` or any `*-store-postgres.ts`                                                                                                                                                                              |
| Docker build      | `.github/workflows/docker-build.yml`: plain `docker build` of the root `Dockerfile` (no push) on every PR touching what the build stage copies                                                                                                                                                                                                                                                                             |
| Engines           | `Engines (<flavor>)` in `.github/workflows/ci.yml`: Camunda 7, CIB seven and Operaton in Testcontainers, running the CLI's suites and the VS Code extension's conformance laws (`test:engines`; images pinned in `apps/cli/test/integration/support/engines.ts`); the `Engines` job aggregates the legs                                                                                                                    |
| VS Code smoke     | activation + every contributed command in VS Code stable under Xvfb, `test:smoke` (`.github/workflows/ci.yml`)                                                                                                                                                                                                                                                                                                             |
| VS Code package   | `vsce package` dry run of the production build (`.github/workflows/ci.yml`): bundles in, no sources, maps or node_modules; the webview budget is `pnpm test`'s (`apps/vscode/test/architecture/bundle-budget.test.ts`)                                                                                                                                                                                                     |
| CLI jobs          | `ci.yml` in the `cli` scope: `CLI binary (<target>)` (single executable on Linux x64, macOS arm64, Windows x64), `CLI image (build + smoke)`, `CLI plugin (validate)`, aggregated by `CLI (all checks)`                                                                                                                                                                                                                    |
| CI scopes         | The `changes` job runs `scripts/ci-scopes.mjs` over a PR's files and every other job runs only in its scope (a skipped job reports success); "Lint + Format" runs on every PR. A new job gets `needs: changes` and a scope; a test that starts reading a file outside its package adds that path to `PATH_RULES` or `ALSO_READ_BY`                                                                                         |
| Manual            | `docker compose -f playground/docker/docker-compose.yml up -d` + `pnpm dev`, then exercise tools/widgets in the inspector. The default boot is read-only; write paths need an explicit suffix, e.g. `MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard` in `.env`                                                                                                                                                       |

A green `pnpm build && pnpm typecheck && pnpm test && pnpm lint` is the minimum bar for
every change; widget changes additionally need `test:host` plus a manual render check via
the inspector (the host simulation renders one real view, not every widget's data path).

**Ratchets only move one way.** `scripts/check-ratchets.mjs` (`pnpm lint:ratchets`) compares
each against the merge base with `origin/main`, and its header lists them: coverage floors in
each `vitest.config.ts` rise (raise one when you better a file); each `stryker.config.json`'s
`mutate` allowlist (the tested surface) grows and its `thresholds.break` rises; the ESLint
budgets (complexity 15 and 400 lines; the CLI and the VS Code extension 10 and 300), knip
ignores (each with its reason), the char and bundle budgets and inline suppressions only
shrink; gate commands stay as they are; a second config that would shadow a ratcheted one
fails. The one escape is a `Ratchet-Exception: <reason>` commit trailer in the branch range,
which turns the failures into warnings for the reviewer; never weaken the checker instead.
`pnpm lint:package-scripts` holds a package's first configs: every package with `src/` has a
`vitest.config.ts` and a `stryker.config.json` (except the apps `NO_MUTATION_APPS` exempts).

Mutation testing runs nightly (`.github/workflows/mutation-nightly.yml`), never on a pull
request (owner decision); locally `pnpm --fail-if-no-match --filter <package> exec stryker run`
(`--mutate <file>` narrows it). Runs use `vitest.stryker.config.ts` with coverage off (a
threshold failure would read as a killed mutant), and DOM widget suites stay out, since the
Stryker runner disables per-file isolation. The Postgres adapters (`src/postgres.ts`,
`src/*-store-postgres.ts`) are out of coverage and mutation alike because their suites run
only under `pnpm test:pg`; that exclusion is no precedent for code the default run can
execute.
