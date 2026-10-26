# CLAUDE.md

Guidance for AI agents working in this repository. The repo-specific skills
`.claude/skills/add-bpm-feature` and `.claude/skills/add-analytics-feature` contain
step-by-step walkthroughs for the two main feature paths; read them before adding tools,
queries, or widgets; `.claude/skills/add-settings-section` covers the third path,
module-owned user settings (a `profile.modules.<module>` slice + its tool triple + its
section on the settings page). The skills, READMEs, agent files and `docs/` are held to the
code by `apps/mcp-server-camunda7/test/docs-refs.test.ts`, over what git tracks (never an
ignored download or build output): the root README and CLAUDE.md, the docs pages, each
package's README and agent files (CLAUDE.md, AGENTS.md), every Markdown file of an app except
its CHANGELOG, the template's README and CLAUDE.md, and the skills. Every backticked tool name
must be registered, every repo path must exist (resolved from the repo root, in a nested file
too), every identifier a house skill or a nested agent file names must exist in the sources or
the toolkit/mcp-use typings (a nested agent file's may also stand in its package's own
`tsconfig*.json`, such as a compiler option), and each docs page stays within its budget, keyed
by its path under `docs/`. `apps/mcp-server-camunda7/test/old-names.test.ts` fails on a pre-Pulse name (the
old npm scope, repo, docs URL, image, starter, slug or product name; "Miragon AI" as the family
and the Fly app names stay), on a technical name of the retired operate CLI (its npm package,
repo, image, tap, docs and product page, its environment variables, config file and config
directory; the word "operate" and Camunda 8's Operate stay), on the unscoped npm package
pulse-cli (someone else's) and a CLI image off GHCR, on a `--filter` naming no
workspace package (a scoped name or an unscoped `pulse-<name>`), and on a pnpm filter without
`--fail-if-no-match` on a gate path (the root's and every workspace package's scripts, the
Dockerfile, the workflows and their composite actions, the gate shell scripts); its
allowances are shrink-only. The CLI reads operate's released names (its variables, project
file, config directory and, through Homebrew, its command) only through
`apps/cli/src/config/legacy.ts`, until the first release after 2027-01-31; a CHANGELOG guard in
its tests fails the first release after that date.

`docs/` holds the Pulse docs, a VitePress site built
with the Miragon docs kit (`docs/.vitepress/miragon/`, vendored from Miragon/corporate-identity,
skill `miragon-brand:docs-site`) that `.github/workflows/docs.yml` publishes to
https://miragon.github.io/pulse/: a user-visible change (env vars, tools, ports,
getting-started steps) updates them in the same PR. Headings get GitHub's anchors, so a
`#anchor` link works on the site and on GitHub. The website https://miragon.ai lives in
Miragon/miragon-ai-docs; a change its product page https://miragon.ai/tools/pulse/ shows needs a
PR there too.

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
| `apps/vscode/`                                       | Pulse for VS Code (`pulse`, a .vsix): a Preact webview over an engine-neutral contract and core, the C7 adapter; its rules in `apps/vscode/CLAUDE.md`                                                                           |
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
  `packages/connectors/<family>/`: `<name>-client` (the wire: SDK, schemas, engine contract),
  `<name>-connector` (the MCP module) and, once two interfaces share a use case,
  `<name>-domain` (pure use cases with typed results: no MCP, no UI, no zod). A different
  dialect is a new family plus its own MCP server app.
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
pnpm --fail-if-no-match --filter @miragon/pulse-cli catalog       # regenerate the command catalogs
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
Wahrheit ist die Skill `miragon-brand:modeler-tool-design` im Repo Miragon/corporate-identity.
Sie lädt automatisch bei UI-Arbeit, wenn das Plugin installiert ist. Ohne Plugin den Guide
direkt lesen:
https://raw.githubusercontent.com/Miragon/corporate-identity/main/plugins/miragon-brand/skills/modeler-tool-design/assets/modeler-design-system.md
Für jedes Wort in der UI gilt zusätzlich `miragon-brand:brand-tone`.

Die Marken-Tokens kommen aus der Skill (`cd-tokens.generated.css`). Keine HEX-Werte forken.
Das Miragon-Theme ist das Default-Theme des Toolkits (`@miragon/mcp-toolkit-ui/theme.css`):
Es vendort `cd-tokens.generated.css` unverändert und bildet seine Rollen-Variablen in Hell und
Dunkel darauf ab. Die App (`apps/mcp-server-camunda7/src/ui/globals.css`) und das
Starter-Template (`server/src/ui/brand.css`) importieren es nach `tailwindcss` und überschreiben
nur Rollen- und Alias-Variablen (`--primary`, `--link`, `--focus`, `--<ton>`, `--<ton>-soft`,
`--<ton>-ink`, Radien, Schatten), nie `--cd-*`, nie Palettenklassen oder rohe Farben in
Komponenten; widget-shell hat kein eigenes Theme mehr. Die Docs-Site nimmt das Doku-Kit der CI
(Skill `miragon-brand:docs-site`): Konfiguration, Theme, Token-Datei und Logos liegen unverändert
unter `docs/.vitepress/miragon/` und `docs/public/logo/`, bei jedem CI-Release neu vendoren, nie
von Hand ändern; `docs/.vitepress/config.ts` ruft nur `miragonDocs()` auf. Der Drift-Test
(`apps/mcp-server-camunda7/test/ui-stylesheet.test.ts` mit
`apps/mcp-server-camunda7/test/vendored-tokens.ts`) hält das fest: Ein `--cd-*` steht nur in
der Toolkit-Kopie und in vendorten Kopien, deren Manifest der Test in
`SANCTIONED_TOKEN_MANIFESTS` freigibt, heute nur das Kit. Jede freigegebene Kopie liegt im
Ordner ihres Manifests, ist byte-gleich mit ihm und teilt den Ordner mit keiner eigenen Datei.
Sobald die Stylesheets eines Manifests ein `--cd-*` deklarieren, deklarieren ihre `:root`-Blöcke
der obersten Ebene zusammen jedes Token der Toolkit-Kopie mit deren Wert; ein Manifest, das nur
daneben liegt, gibt nichts frei. Das Kit prüft zusätzlich sein `check.mjs`, und `test:host`
prüft, dass das gebaute Stylesheet die vendorten Werte trägt. Eine weitere Kopie, etwa die App- und
Web-Variante aus `miragon-brand:modeler-tool-design`, kommt mit einem Manifest im Format des
Kits (`version`, `dateien` mit `pfad`, `quelle`, `sha256`) und einem Eintrag in
`SANCTIONED_TOKEN_MANIFESTS`, nie als Ausnahme im Scan. Die Website
miragon.ai liegt in Miragon/miragon-ai-docs und prüft ihre Token-Kopie dort.

UI-Texte gibt es auf Deutsch und Englisch, je nach Host-Locale. Deutsch folgt brand-tone
vollständig: du-Ansprache, AI statt `KI`, „CIB seven“, kein Gedankenstrich als Verbinder,
normale Groß- und Kleinschreibung, Fehlermeldungen sagen, was passiert ist und was du tun
kannst. Englisch übernimmt die übertragbaren Regeln: Sentence case, aktiv, kein Em-Dash als
Verbinder. Glossar: Incident (nicht Vorfall), aussetzen/ausgesetzt, läuft, Geschäftsschlüssel,
Versuche. `.miragon/brand.json` schaltet den brand-lint-Hook für jede geänderte Datei ein;
Strings in `.ts`/`.tsx` sieht brand-lint nicht, die prüfen die Gates aus
`@miragon/pulse-widget-shell/testing` (Invariante 6).

### Abweichungen für eingebettete Chat-Widgets

Die Widgets laufen als MCP Apps im Rahmen eines Chat-Hosts. Dafür gelten diese bewussten
Abweichungen vom Guide (Owner-Entscheidung, nur hier dokumentiert):

- Theme: Die Widgets folgen dem Host-Theme (#339), ohne Umschalter in der App und ohne
  Theme-Feld im Profil; ohne Host das OS. Dunkel entsteht streng aus den Dark-Ground-Regeln der
  CI: Basis `--cd-schwarz`, Flächen als `color-mix`-Aufhellungen davon, Text Weiß, Links und
  Akzenttext `--cd-gruen`, Buttons `--cd-blau` mit Weiß, Fokus `--cd-blau-hell`, Status in den
  `-hell`-Werten ohne getönte Flächen, leiser Text `--cd-kontur`. Der Host darf nur die
  neutralen Rollen setzen (`HOST_TOKEN_MAP`: Flächen, Text, `--border`), nie `--primary`,
  `--link`, `--focus`, `--ring`, `--input`, `--accent` oder einen Status. BPMN-Papier und seine
  Zoom-Leiste bleiben immer hell.
- Schrift: Geist zuerst, dann die Schrift des Hosts (`adoptHostFontVariables` in
  `HostDocument`), dann System. Geist und Geist Mono liefert der Server selbst aus, als woff2
  (latin, variabel) unter `/fonts/geist-<version>/` (`installFontAssets`, kein CDN, `immutable`
  gecacht); jede View erlaubt den Ursprung über ihre CSP `resourceDomains` (`MCP_URL`, sonst der
  Ursprung, von dem der Host die View gelesen hat) und lädt die Schnitte mit `font-display: swap`
  (`declareServedFonts`). Blockt ein Host den Ursprung oder erreicht der Browser den Server nicht,
  rendert die Host-Schrift, ohne dass etwas wartet.
- Sprache: Deutsch und Englisch nach Host-Locale (Fallback Englisch) statt nur Deutsch.
- Chrome: im Rahmen des Hosts (Kopf mit Titel und Aktionen) statt randlosem Canvas mit
  schwebendem Chrome in den Ecken.
- Seitentitel: h2 mit 28 px statt h1 mit 40 px.
- Dichte Tabellen: 14 px statt 16 px Fließtext.
- Data-Viz: eine einfarbige Rampe von `--cd-info-soft` bis `--cd-blau`; Rot nur für
  Incidents.
- Komet: nur auf App-Ebene (Landing, Erststart, „keine Engines“), nicht in jedem Widget
  (`KometMark`/`AppEmptyState` aus widget-shell, die CI-Datei unverändert). Eine Kundenmarke
  blendet ihn über den Theme-Slot `--brand-mark-display: none` aus.
- BPMN-Zoom-Leiste oben rechts statt unten rechts: unten rechts liegt das bpmn.io-Logo
  (Lizenzpflicht).

## Architecture invariants

1. **New operations tools go through the registrar, never raw `server.tool()`.** Add the
   Zod input schema in `packages/connectors/camunda/camunda7-client/src/schemas/`, then register the tool in
   `packages/connectors/camunda/camunda7-connector/src/tools/<domain>.ts` via the `register` callback created by
   `createToolRegistrar` (wired in `src/tools/index.ts`). Every registrar tool carries a
   `category` matching its domain file (e.g. `"process-instances"`, `"tasks"`;
   `"analytics"` for the analytics module). Spread `...engineParamShape` into the input
   schema and wrap the handler in `withEngine(...)` (both from `src/lib/with-engine.ts`).
   See `camunda7_list_process_instances` in
   `packages/connectors/camunda/camunda7-connector/src/tools/process-instances.ts` for the canonical shape.
   Destructive/admin tools must also be listed in `src/lib/toolsets.ts` (`ADMIN_ONLY_TOOLS`)
   so the `camunda7:read-only|operations|admin` toolset filtering stays correct;
   `src/lib/toolsets.test.ts` enforces the rule structurally over every registered tool
   (`destructiveHint` ⇒ admin-only, read-only ⇒ `readOnlyHint`, every write states
   `destructiveHint` explicitly, since MCP reads an absent hint as `true`), so get the annotations
   right rather than editing the test. Toolsets are FAIL-CLOSED: without a suffix a module
   runs its read-only floor on an unauthenticated boot and its standard toolset (camunda7
   `operations`, analytics `standard`) under OAuth; `admin` is never implied, and an
   empty/unknown suffix warns and falls back to the floor; nothing ever resolves to
   "everything" (pinned by widget-shell's `toolsets.test.ts` + `composition.test.ts`).
   Admin-only by decision, each with `destructiveHint: true`: the engine-wide
   `camunda7_throw_signal` and the external-task worker protocol (`fetch_and_lock`,
   `complete_external_task`, `handle_external_task_failure`; the read path is
   `camunda7_list_external_tasks`, recovery in `operations` is
   `camunda7_set_external_task_retries`). `camunda7_create_deployment` (`destructiveHint: true`)
   is additionally registered only with `CAMUNDA_ALLOW_DEPLOYMENTS=true`: deploying
   BPMN/DMN is code execution inside the engine JVM (JUEL, scripts). Never relax that
   gate or fold it into a toolset. Tools registered outside the registrar (the
   widget-tools path) that perform durable writes must honor the toolset themselves
   (pattern: `camunda7_save_settings` in `src/tools/user-profile.ts`). An ESLint gate
   (`no-restricted-syntax` in `eslint.config.mjs`) blocks raw `server.tool()`, also via a
   computed key, `.call`/`.bind`/`.apply`, destructuring (declaration or assignment, incl.
   string keys) and `Reflect.get` (string or template key), `.ts` and `.tsx`; an inline
   `eslint-disable` of it fails `pnpm lint:ratchets`, outside exactly the widget-path files (in camunda7: `widget-tools.ts` + the
   `widget-tools/` domain registrars + `tools/user-profile.ts`). `no-restricted-syntax` is
   one rule: a later flat-config block REPLACES its selectors, so a glob two gates share
   gets one block with the union; `scripts/eslint-gates.test.mjs` pins that per path.

2. **Never talk to an engine directly.** All engine access goes through
   `resolveEngine`/`withEngine` (`packages/connectors/camunda/camunda7-connector/src/lib/`), which implements the
   multi-engine routing precedence: per-call `engine` override > the caller's saved default
   engine (`profile.modules.camunda7.defaultEngineId`, written by `camunda7_select_engine`
   and the settings page; resolution is single-sourced in
   `lib/engine-preferences.ts`) > the single configured default. There is deliberately NO
   in-memory session selection (replica-unsafe; mcp-use 2 issues no session ids). Constructing
   or caching a client yourself breaks multi-engine routing. `resolveEngine` (async) already
   returns `baseUrl`/`cockpitUrl`; never fish them out of `registry.engines` yourself.

3. **Widget registration is a four-link chain**: a widget that misses a link is silently
   absent somewhere:
   - `packages/connectors/camunda/camunda7-connector/src/widgets/registry.ts`: component → dataType via `adaptDataWidget`
   - `packages/connectors/camunda/camunda7-connector/src/definition.ts`: widget metadata (`id`, `requires`, `size`, `propsSchema`;
     the view builder's `title`/`summary` and each field's `x-display` for people, from the
     `builder.*` entries of the module's catalogs via `createBuilderTexts`; `description` stays
     the model's text; each connector's `src/builder-texts.test.ts` runs `missingDisplayTexts`)
   - `apps/mcp-server-camunda7/src/ui/widget-registry.ts`: the host bundle map (spreads
     `camunda7Widgets`/`analyticsWidgets`)
   - `packages/connectors/camunda/camunda7-connector/src/tool-names.ts`: the tool-name constant for every
     `show_*`/`*_data` tool, so in-widget navigation stays rename-safe

   Links 1↔2 are guarded by `src/widgets/catalogue-sync.test.ts` (both modules have
   one), link 3 by `apps/mcp-server-camunda7/test/widget-registry.test.ts` (every
   catalogued widget id must have a host-bundle entry).

4. **The `dedupe` array in `apps/mcp-server-camunda7/vite.config.ts` is load-bearing: never
   remove or trim it.** Without it each widget package bundles its own React/toolkit
   instance, the React contexts no longer match, `useCallTool()` is undefined, and every
   in-widget query hangs on "Loading…".

5. **There are three render paths; pick deliberately:**
   - Registrar tools (`src/tools/`): plain JSON data _for the model_
   - Widget tools (`widget-tools.ts`, `show_*`, spread `...showToolBinding(name, title)`
     from `@miragon/pulse-widget-shell/server`: a `view` binding named after the tool +
     `outputSchema` + the Apps-SDK `_meta` half): render a widget for the user +
     return a summary for the model
   - `*_data` feeds (also in `widget-tools.ts`, spread `...appOnly`: the native
     `visibility: "app"` field + `openai/widgetAccessible`, **no** view binding):
     app-only JSON for in-widget refresh/navigation. SEP-1865
     hosts hide them from the LLM, and a widget-tool result would be rendered by the
     host instead of returned to the in-widget `callTool()`. Feeds return
     `buildDataFeedResult(data)` from `@miragon/pulse-widget-shell/server`, the single
     implementation of this invariant

   All three take STRICT input: the registrars run with `strictInput: true`, raw
   `server.tool()` registrations declare `strictToolInput(…)`
   (`@miragon/pulse-widget-shell/server`): an unknown key is a tool error listing the valid
   keys, never a silently stripped filter (`test/strict-input.e2e.test.ts` in the app).
   Parameter names follow the guide in the add-bpm-feature skill.

6. **MCP App widgets compose from the shared kit (`@miragon/pulse-widget-shell/widgets`) and
   the toolkit (`@miragon/mcp-toolkit-ui`); never re-inline their primitives.** This
   invariant covers the React views an MCP host renders (widget-shell's `src/ui`, the
   connectors' `src/widgets`, the host bundle in `apps/mcp-server-camunda7/src/ui/`), not a
   UI another interface app draws itself, which follows the design system above. ONE kit: the
   toolkit's components (`KpiGrid`/`KpiGridSkeleton`, `StatusBadge`/`LivePill`/`CountPill`,
   `FilterBar`, `WidgetHeader` with `as`, `SectionHeading`, `GroupCard`, `DrillButton`,
   `ListFooter`, `PagedListFooter`), its tone model (`TONE_*`, `resolveTone`, `MICRO_LABEL`)
   and its `cn` (tailwind-merge that knows the type scale) are imported from the toolkit;
   widget-shell exports only what it adds, never a fork or a re-export of the toolkit's
   (`src/ui/toolkit-overlap.test.ts`: no `/widgets` export, value or type, shares a toolkit
   name; `/ui`'s `adaptDataWidget` is the one listed pass-through).
   `ViewDataState` for the loading/error/no-data guard;
   `QueryFallback` + `TableSkeleton` for self-fetching widgets (a missing `isError`
   branch means an eternal skeleton). **States and feedback are the kit's (#322 U1, U9, U10,
   U22):** both guards take a required `onRetry` (a failed load is never a dead end) and
   render the toolkit's `ErrorState` from `describeError(error, locale)`: an engine or
   transport failure (502/503/unreachable, a timeout, a tool the server lacks, 401/403, 404,
   an engine exception; source and engine id read from the text the wire carries) as what
   happened and what you can do in en/de ("Die Engine prod ist nicht erreichbar (HTTP 503)",
   "Prüf, ob die Engine läuft …"), the raw "[503 ProcessEngineException] …" only collapsed
   under "Details"; a caller's `errorTitle` heads only a failure it cannot classify, and
   no raw engine text is ever a headline. Loading is a `skeleton` slot under a
   polite sr-only status ("Ansicht wird geladen…" / "Loading view…" unless `loadingText`),
   no data the toolkit's `EmptyState`. `useDetailView`'s stale notice is an inline warning
   `ErrorState`; `LocalizedAppView` passes the same words to the toolkit's view as
   `describeError`, its next step only where it promises no retry (`hintNeedsNoRetry`: the
   view offers Retry only where the host named the tool, so a "try again" hint stays the
   toolkit's retry-aware one). A write says how it went: `useActionFeedback()` (`succeeded(title)`,
   `failed(title, error)`) raises the toolkit's toasts (the polite live region `McpAppView`
   mounts), each naming the object; a toast has no "Details", so `failureLine` quotes an
   engine refusal's own reason without its code („Cannot resolve incident“) and says a
   write whose answer never came may have gone through (check before retrying), never "see
   Details"; camunda7's `useEngineAction` requires a `feedback` per
   `run` (`widgets/lib/write-feedback.ts`, `feedback.*` keys) and leaves a confirmed
   write's failure to its dialog. `ConfirmDialog` (kit, `ConfirmTarget` lines) is the one
   confirmation: an `alertdialog` on the toolkit `Dialog` (scrim, md radius, `shadow-3`),
   verb + object on both buttons, the destructive confirm in the danger role, closed to
   dismissal while the write runs; inline it opens beside its opener, not in the middle of a
   frame taller than the chat shows (`anchoredTop`, #344 K45). Nothing to show is `TableEmptyState`: `variant="done"`
   (`CircleCheck`, success tone) for "nothing left to do", the quiet `Inbox` default for no
   data, `description` and `action` as the toolkit's `EmptyState` takes them; the Komet
   (`KometMark`, the CI's `miragon-komet-blau.svg` inlined unchanged and sha-pinned, ≥ 24 px;
   `AppEmptyState`) belongs to APP-level surfaces only (landing, first start, "no engines")
   and hangs on the theme slot `--brand-mark-display` a customer brand sets to `none`.
   **Inline is a card, not a page** (#396): under a host, every list shows the rows that
   FIT the host's height budget (`containerDimensions.maxHeight`, else 600 px with the
   document uncapped; none in fullscreen or outside a host), MEASURED on the rendered view,
   never estimated with px constants: `HostDocument`'s `InlineFitBox` measures the content
   and each list's row bottoms before the first paint, the pure `solveInlineFit` cuts rows
   (the longest list first, 3 before any list goes lower, 1 at the least, never 0; a view
   that cannot fit keeps 3 and scrolls inside the budget, the safety net), a cap only
   shrinks within an epoch (budget, width, display mode), late growth refits only until the
   user's first pointer or key, and rows revealed in place stay until the search changes. A
   paged list (`usePagedViewData`: `items` are the head, `loadMore` opens fullscreen where
   the host offers it, else shows the next rows in place) registers ONE list: its table
   sits in `PagedRows` (or `RowsBudgeted`), hands its body to `paged.fit`, and never caps
   twice; a list of its own rows passes `paged.fit.attachRows`, and its `PagedListFooter`
   passes `labels={paged.footerLabels}` ("Show all" where the click opens fullscreen;
   `inline-fit-wiring.test.ts` checks both). An unpaged `ListTable` is a list of its own (a
   `<tfoot>` line "3 of 6 shown" + Show all/Show more). Rows stay short in a chat's column:
   an id wraps between its parts first (`BreakableId`, `NamedId`), inside a part only where
   that part alone is wider than the column; a quiet fact joins the id line (`detail`)
   instead of a column or line of its own; a row that belongs to the row before it (an
   incident's error line) carries `FIT_CONTINUES_ROW`, so the fit counts items as the cap
   does. The host simulation pins it on real-sized data (`test-host/realistic-engine.ts`,
   `inline-fit.spec.ts`). The inline BPMN canvas stays ≤ 320 px and unbounded text (a log,
   a stack trace) scrolls in `TEXT_BLOCK_FRAME`. The roots declare inline + fullscreen
   only (`SHELL_VIEW_CONFIG`, no pip); a client-side router renders its
   views in ONE `NavigationFocus` frame (focus moves to the new view, its name announced
   politely); a surface that hides the view's toolbar (the standalone drill) brings
   `DisplayModeToggle`.
   **Tables never widen the document** (U2, WCAG 1.4.10; the host simulation checks 760 px):
   `ListTable` scrolls inside a named region (`role="region"`, `tabIndex=0`, `ariaLabel`
   required; its focus ring an outline drawn INSIDE the region's box by a sibling layered
   above the pinned column, `REGION_FOCUS_RING`, since it fills clipping cards edge to
   edge); `hideBelow: "sm" | "md" | "lg"` hides a column (header and every row's cell
   in that position, rows one cell per column) while the REGION is narrower than
   640/768/1024 px; `sticky: true` on the last column pins the row actions; `sort` on the
   column the rows are ordered by sets `aria-sort` and a direction arrow; `groups` heads
   adjacent columns in a row above theirs (`scope="col"` + `colSpan`, never `colgroup`
   without a `<colgroup>` to anchor it; a column under a group of
   several never hides, `listTableCss` throws on it); `IdCell` /
   `IdText` show an id in Geist Mono, shortened ("5f0ce78e…", whole for screen readers and
   in `title`), with a copy button and its toast (a failed copy leaves the whole id selected
   in a read-only field, to copy by hand); `NamedId` shows a process or an element by its
   name first (dense, 600) and its id as a quiet Geist Mono line under it (`detail` appends
   its type or process, `lead` a state dot): ONE look in every module, never a connector's
   own copy. Those names come from ONE reader: `readBpmnNames` / `parseBpmnNames`
   (`@miragon/pulse-widget-shell/server`, server and browser alike: a process's own name, else
   its Modeler pool's; `&#10;` and every other character reference decoded, space folded), so
   camunda7, analytics and the heatmap never name the same process or activity two ways; a
   view that shows the engine's definition name names an unnamed one from its diagram
   (camunda7's `nameUnnamedDefinitions`). `WidgetShell` pads 24 px (16 px below
   640 px) and lets its children shrink (`min-w-0`). **Type on the scale**: kit components
   sit on the toolkit's `TYPE_SCALE`: a widget's page title 28/700 (`WidgetHeader`, an h2
   inside a view), a section `text-section` (21/600), running text `text-body` (16), dense
   tables and form controls `text-dense` (14), captions and meta `text-small` (13, the
   floor); `scanTypeScale` (`/testing`) fails a Tailwind size or anything below 13 px in
   widget-shell's `src/ui` (a connector adopts it with `rules: ["below-floor"]` first).
   `formatTimestamp`/`formatDate`/`formatTime` for dates
   and `formatNumber`/`formatPercent`/`formatPercentPoints`/`formatPeriod`/`formatDuration`/
   `truncate` for everything else (canonical duration style "3m 7s" in English, "3 Min. 7 s"
   in German; "3,7 %" / "3.7%", "+0,2 Pp." / "+0.2 pp", "7 Tage" / "7 days"). Dates and
   numbers render in the shell's effective locale (+ the host's time zone), published by
   `ProfileGate`; an ESLint gate bans `Intl.DateTimeFormat`/`toLocaleDateString`/`toLocaleTimeString`
   in widget code, and a second one bans `toFixed`, a `toLocaleString()` without a locale (no
   argument, `undefined`, `null`, `[]`) and a hand-built `Intl.NumberFormat` (exempt: the
   kit's own `format.ts`; on for widget-shell's `src/ui` and both connectors' `src/widgets`,
   each connector in its own union block in `eslint.config.mjs`, pinned by
   `scripts/eslint-gates.test.mjs`; a new connector's widgets join it in a block of their own
   once their raw calls moved to the kit). A count reaches a catalog entry already formatted
   (`formatNumber`), and the entry puts the noun in the right number (`countOf` in camunda7's
   `messages/plural.ts`, `plural(…)` in analytics'), never a `…One`/`…Other` key pair;
   `ViewMeta` (`formatLookback`, `formatViewMeta`) for the quiet reference line under a data
   view's title, "Letzte 7 Tage · 6 Engines (3 ohne Metriken) · Stand 14:32", every part left
   out when unknown;
   `Section`, `Th`/`Td`/`TableEmptyState`, the toolkit's `WidgetHeader` + `VersionChip`, its
   `KpiGrid`, `WidgetShell` for structure; `SettingsCard`/`SettingsField`/`SettingsInput` for
   settings sections (form controls on the `--input` edge, `FIELD_CONTROL`; an entry that is
   not valid is said to be wrong inline, `SettingsField`'s `error`: a danger-ink line under
   the control, `aria-invalid` and `aria-describedby`, never a silent clamp; a section that
   cannot save says why ABOVE its disabled fields); `useBpmnViewer`
   (it owns the fixed light canvas: the container is a forced-light island,
   `data-theme-mode="light"`, on the paper token; its `height` is the diagram's height at
   the scale bpmn-js draws it, never past 1:1, 240–560 px, known on the first paint from the
   XML's DI (`diagramBoundsFromXml`); every fit is centred on a fresh viewbox, since
   diagram-js caches the container size) + `BpmnZoomControls` (light in every theme,
   Lucide, 32 px buttons) for BPMN. Every canvas colour is ONE TS token module,
   `widget-shell/src/ui/bpmn-tokens.ts` (`BPMN_TOKENS`: `--cd-*` names only, incident
   danger + danger-soft, running and open task blue + info-soft, count badges white on blue
   or danger; `BPMN_OVERLAY_CSS` refers to them as `var(--cd-*)`, `injectBpmnOverlayCss()`
   adds it once; no pulse, an open user task is a heavier dashed stroke).
   `bpmn-tokens.test.ts` is its drift test (every name's `CD_TOKENS` value equals the
   vendored `cd-tokens.generated.css`) and contrast test (strokes ≥ 3:1 on the paper and
   their tint, badge text ≥ 4.5:1). camunda7's `HIGHLIGHT_COLORS`
   (`packages/connectors/camunda/camunda7-connector/src/widgets/bpmn-highlights.ts`) and its
   legend (`markerSwatch`/`badgeSwatch`) read it. The heatmap's ramp is the one-hue data-viz
   ramp `--cd-info-soft` → `--cd-blau` (never red), the smallest value above zero at a
   visible minimum and the range mapped linearly onto the ramp (`heatIntensity`), so the
   legend's two values are what its ends encode, and the values per element as a
   table (`HeatValuesTable`). Paged lists compose
   `usePagedListView` (search + debounce + paging scaffold; feed must accept
   `firstResult`/`maxResults` and return an honest total; a new page 0 keeps the
   previous rows of the same list mounted until it lands (TanStack's `placeholderData` on
   the toolkit's seeded `useViewData`, bridged past a search that failed for good:
   `paged.stale`), so counts, filters and
   model contexts read the payload ON SCREEN, never the request) + `ListTable` (the table
   frame; rows stay hand-composed `<tr>` + `Td`) inside `PagedRows` (marks stale rows) + the toolkit's
   `PagedListFooter` (a page-0 failure over rows on screen and a load-more failure, each an
   inline `ErrorState` with its own retry and the raw reason under Details; its count line
   is the list's ONE polite live region, kept mounted at zero rows; its words are the
   toolkit's en/de catalog; rendered under an empty result too). Optimistic
   local state (resolved marks, variable shadows, form baselines) is dropped with
   `useResetOnChange(data, reset)`, React's render-phase "adjust state when a prop
   changes"; `useEffect(reset, [data])` is the shape `react-hooks/set-state-in-effect`
   rejects, and it commits the stale shadow once before correcting it. Refs are never
   written during render (`react-hooks/refs`): a discarded render still mutates them,
   so anything a guard reads belongs in state (see `usePagedViewData`'s generation).
   **A status is a tone, never a coloured word** (the toolkit's `TONE_*` maps, see
   "Design-System"): `ToneVariant` is `danger | warning | success | info | neutral`. There is
   no `critical` (a retired name from the wire resolves through `resolveTone`): an open incident or a failed job without retries is `danger`, a failed job
   with retries left or a degraded engine is `warning`, a count without a state is `neutral`.
   The ladder for incident and job counts is the kit's, ONE for every module (`countTone` /
   `severityTone`, `@miragon/pulse-widget-shell/widgets`): camunda7's engine tiles and the
   analytics landscape they embed edge the same "jobs without retries" alike.
   Each tone has three roles, theme variables of the toolkit's Miragon theme
   (`@miragon/mcp-toolkit-ui/theme.css`, light + dark): `--<tone>` is the fill, dot, edge or icon
   (`TONE_DOT`, `TONE_BORDER`, `TONE_ICON`), `--<tone>-soft` the tint (`TONE_TINT`, or
   `TONE_SOFT` = tint + black text, paired with `TONE_BORDER`) and `--<tone>-ink` the text of
   a tone directly on the card or page (`TONE_INK`, an inline error line; never on a tint,
   never a number). Numbers stay neutral: `StatusBadge` (tone and words required)/`CountPill`/
   `LivePill` put black text on the tint with the edge and dot in the tone, `KpiGrid` shows a
   cell's `tone` as a dot next to the label (strip) or as tint + edge (soft) and its trend as a
   Lucide direction icon or dot beside neutral words, never as a coloured digit; a clickable
   cell is named by its visible label and value and says what the click does in
   `actionHint` (WCAG 2.5.3, never `ariaLabel`), and `PagedRows` marks stale rows
   with a bar instead of dimming them. A selection (`FilterBar` chip, `SegmentedControl`) is
   the info tint and contour around black text. Components use role names only
   (`text-danger-ink`, `bg-info-soft`, `text-link`, `ring-focus` …), never Tailwind palette
   classes, raw colours or the retired `--m-*`/`critical` accents, as a class or a `var()`
   reference (`scanColors`, below; a selected nav item is `bg-accent text-accent-foreground`,
   a link `text-link`). `src/ui/tone-contrast.test.ts` holds every `TONE_*` and role pair
   (`ROLE_CONTRAST_PAIRS`: text on every surface, each `-foreground` on its fill, the link,
   `--focus` and `--ring`, the input edge; a role a brand may override belongs in it) to
   WCAG AA in light and dark over the shipped theme
   (`toolkitThemeStylesheets()` from `/testing`); the one exemption is the CI's own (§3.3:
   success green and amber as a dot, edge or icon on light reach 1.67:1 / 1.83:1, so a status
   never stands alone), a shrink-only list. The app's `test/ui-stylesheet.test.ts` does the
   same over the app's and the template's stack (`globals.css`, the template's `brand.css`),
   pins that no consumer stylesheet names a raw colour (`stylesheetColorFindings`) or a
   `--cd-*`/`--m-*`/`--critical` variable, and is the token DRIFT test (the shipped theme
   imports the toolkit's vendored copy; besides it a `--cd-*` is declared only in a vendored
   copy whose manifest the test lists in `SANCTIONED_TOKEN_MANIFESTS`, today only the docs
   kit's: inside its manifest's folder, byte-equal to the manifest, and once the manifest's
   stylesheets declare a `--cd-*`, their top-level `:root` blocks together declare every token
   of the toolkit's copy with its value (`apps/mcp-server-camunda7/test/vendored-tokens.ts`);
   `test:host` checks the built stylesheet's `--cd-*` values); the template
   runs `server/test/brand.test.ts` over its own `brand.css`, the override example included.
   `parseThemeVariables` reads a stylesheet stack the way
   `<html class="dark" data-theme="dark">` sees it: `:root` and the dark scopes (`.dark`,
   `[data-theme="dark"]`, `[data-theme-mode="dark"]`) in source order, later wins, so a brand
   override goes under BOTH (a light-only `:root` value shows in dark); a theme rule it cannot
   model (`html.dark`, `[data-theme="light"]`, a media query or layer around `:root`) throws.
   **Function icons are Lucide, never glyphs or emoji:** `Icon` (`currentColor`, 16 px, stroke
   2.5 set on the icon, `dense` → 2 for tight bars and rows: lucide-react's own `strokeWidth`,
   the mechanism the toolkit's `LucideProvider` uses for its chrome (2.5, its toolbar 2), never
   a CSS `stroke-width` rule, which would beat the provider; 16 px in chrome and 24 px
   previews are the only sizes, `scanIconSizes` below). `lucide-react` is a
   widget-shell peer, deduped in the bundle (invariant 4); every workspace package that imports it
   and every host bundle pin the SAME exact 1.x devDependency (today `1.61.0`): two versions
   resolve a second mcp-use/toolkit instance and split the React contexts
   between it and widget-shell in tests. A host BUNDLE (the app, the template.s server) needs
   1.x: it dedupes the toolkit's icons onto its copy, and the toolkit (2.7
   and later) imports `LucideProvider`, which 0.x lacks. A chat hand-off is the kit's `HandOffButton`
   (`action` from `HAND_OFF_ACTIONS`, `widget-shell/src/ui/hand-off-button.tsx`): ONE
   vocabulary for the product, each function with one Lucide icon and one verb that names the
   chat (`kitLabels().handOff`, de + en: "Ursache im Chat klären" / "Find cause in chat",
   "Fehler im Chat erklären", "Im Chat bewerten" …), the same in every module, no icon for two
   functions; a row's icon button names its subject in `title`. It renders the kit's
   `AskAiButton` (`icon` + `label`; without them `MessageSquare` + "Im Chat analysieren"),
   every button variant a secondary outline (the deterministic next step is the view's primary
   action) and `variant="menuitem"` (on `OpenInCockpitLink` too) a plain entry of a row's
   menu (`MoreActions`: portaled out of the row, whose pinned cell would paint over it;
   `role="menu"`, arrow keys, Escape), never ✦ or Sparkles (an ESLint `no-restricted-imports` gate bans lucide-react's
   sparkle icons in every widget tree; a `no-restricted-syntax` gate bans `AskAiButton` in
   both connectors' widgets, import, renamed import and element alike, so a new function goes
   into the kit's table with its icon and both labels). `OpenInCockpitLink` takes `vendor`
   (`provider.branding.displayName`) and reads "In CIB seven öffnen" / "Open in CIB seven",
   with "öffnet in neuem Tab" in its accessible name. `WidgetHeader` has no icon tile; a state
   goes into `badge` (a `StatusBadge`). **A view's actions are ONE group in its head**
   (`WidgetHeader` `actions`), all of one size (the toolkit's `Button` `size="sm"`, 32 px /
   14 px / 600; `OpenInCockpitLink` renders with `buttonVariants` too), in one order: the
   deterministic steps, the engine's own web app, then the chat. The meta line under the
   title holds facts only, never a link or an action; a section with actions of its own
   (the incident's failure) keeps them in one row the same way (`action-group.test.tsx`).
   Rows use the same size: a drill is the toolkit's `DrillButton`, the outline `Button` at
   that scale since toolkit 2.8.1 (Miragon/mcp-toolkit#194), level with the icon buttons
   beside it, and never a `Button` dressed up with a trailing arrow
   (`row-actions.test.ts`).
   **Every widget package runs the brand gates** from `@miragon/pulse-widget-shell/testing` in
   its own tests (brand-lint cannot read strings in `.ts`/`.tsx`):
   `catalogTextFindings(catalog, { language })` over each en/de message catalog (no dash as a
   connector, AI not `KI`, "CIB seven", du not `Sie`/`Ihr`/`Ihnen`/`man`, also at the start of
   an entry or sentence, no "1 incidents"; pass `params` for entries that need real shapes, and
   `allow` with a reason for a sentence-initial she/its that refers to an instance, not to
   the reader), `scanGlyphs(dir)` over widget code and catalogs (no ✦ ⊡ ▦ ↗ › ⚠ ⚙ ⏱ ⤧ ▶ ✓ ✕ ▤
   ⊞ ↻ × and no emoji in JSX or strings, no lone symbol such as → − ‹ as an element's whole
   content, no Lucide sparkle import), `scanIconSizes(dir)` over widget code (a literal icon
   `size` only 16 or 24; the toolkit `Badge` forces its icons to 12 px, so an icon chip is a
   plain outlined span) and `scanColors(dir, { allow })` over widget code (no
   palette class such as `text-red-600`/`bg-black/50`, no hex, `rgb()`/`oklch()` …; `allow`
   names a file with its reason, shrink-only). widget-shell runs all four in
   `src/ui/brand-gates.test.ts`; camunda7 in `src/brand-gates.test.ts` (glyphs over all of
   `src`, icon sizes, colours and the type scale with both rules over `src/widgets`) and
   `src/messages/catalog-text.test.ts`
   (every catalog, plus en/de holding the same keys, so no English fallback leaks into a German
   view); analytics in `src/brand-gates.test.ts` (widget texts, Ask-AI intents and model
   summaries in de and en, glyphs over `src/widgets` + `src/messages`, icon sizes and colours
   over `src/widgets`). **One term per thing across the product:** the terms the modules' views
   show side by side (camunda7's cross-engine cockpit embeds analytics' landscape) are the
   kit's `PRODUCT_GLOSSARY` (`/testing`): "Incident" (never "Vorfall"), "Jobs ohne Versuche" /
   "jobs without retries" for the engine's `failedJobs` and `camunda_jobs_failed` (never
   "Fehlgeschlagene Jobs", "tote Jobs"), "bereitstellen, bereitgestellt" (never "deployt";
   the noun stays "Deployment"), Geschäftsschlüssel, aussetzen, Versuche, alle Engines. Each
   connector runs `glossaryFindings` with it plus its own rules over every catalog in
   `src/messages/glossary.test.ts` and lists both in `src/messages/GLOSSARY.md` (the shared
   table and the hand-off table identical in both; `unnamedGlossaryTerms` keeps the document
   and the gate together): camunda7's own (aktivieren, läuft, als gelöst markieren …),
   analytics' own ("nicht belastbar", "Zeitraum", "Kennzahl" …, en/de holding the same keys).
   Hand-offs are placed after the deterministic action they accompany. A verdict travels as
   data and the widget words it in the view's locale (the engine overview's line,
   `widgets/lib/health-verdict.ts`); every show tool of every module titles its view only in a
   language the profile names (the kit's `createLocalizeViewFor`, bound as `localizeViewFor`
   in each module's `server-locale.ts`): with "system", no caller or a store outage it sets no
   title, and the widget's own heading names the view in the host's language
   (`view-title.test.ts` in each connector sweeps every show tool). `setFormatLocale` from
   `/testing` renders a widget's numbers in a language in a test.
   **Everything a widget tells the model is built by `askAiPrompt`/`modelContextText`**
   (`widget-shell/src/ui/ask-ai-prompt.ts`): an Ask-AI hand-off is posted as the
   USER's message. A spec is a short catalogue intent (`askAi.*` in the module's
   en/de messages; static text, no tool names) or a static view `summary`, plus
   `ids` (non-id-shaped values are fenced), `toolIds` (arguments only one tool
   takes, inlined only while it is named), `facts`, `untrusted` (engine text:
   messages, names, business keys, length-capped in a fence the text cannot
   close) and `tools`, filtered by the live surface: camunda7's `useHandOff` reads
   `modelTools` of `camunda7_widget_actions_data` (recorded at registration) +
   `useAnalyticsActive`; analytics' reads the same feed by raw name. The surface is
   three-state: a prompt whose tools are all absent (or not answered yet) is
   `null` and `AskAiButton` renders nothing; a feed that cannot answer (failed, no
   in-widget tools/call) still builds it, naming no tool. Generic playbooks and
   the engine-pinning rule (hand-offs AND model contexts) live in the module
   `instructions`, gated by toolset. `apps/mcp-server-camunda7/test/hand-off-surface.test.ts`
   (over the packages and the MCP server apps, see `APP_SCAN` in invariant 8)
   fails on a raw `askAi`/`sendFollowup`, a model context (`HostModelContext` or
   `adaptDataWidget`'s description) not built by `modelContextText`, a non-static
   summary, a tool named outside `tools`, an app-only or unknown tool, an id no
   tool still named on some toolset takes, and a surface that differs from
   tools/list per toolset.

7. **Shared server data paths are single-sourced.** Definition name/version/instance
   lookups come from `packages/connectors/camunda/camunda7-connector/src/data/definition-info.ts`;
   `data/bpmn-viewer-data.ts` feeds BOTH the widget tool and the pipeline step; never
   fork them. No view payload carries BPMN XML (a show tool's `structuredContent` reaches
   the model on some hosts): a view names the version it draws (`diagramDefinitionId`)
   and `BpmnDiagram` reads the XML by id from the app-only `camunda7_bpmn_xml_data`
   (kept for good: a definition's XML never changes); the analytics heatmap reads its
   diagram from `analytics_bpmn_xml_data`. The ONE XML read is `lib/definition-xml.ts`,
   cached per engine client and per caller (`callerCacheKey`, so passthrough engines keep
   deciding per token). Every camunda7 view has ONE builder in `src/data/` behind its show tool,
   `*_data` feed and pipeline step (`steps/steps.test.ts` holds them equal), and every
   builder follows the honest-numbers rule (`data/engine-reads.ts`): **primary rows/counts
   propagate errors; enrichment degrades to `null` (rendered "—"), never 0**; totals come
   from `/count` or statistics, never a capped page or scan; a definition view spans every
   version of its key (`data/honest-numbers.test.ts` breaks every read a builder makes;
   only its declared enrichment may survive).
   Every engine REST rule the client defaults miss (engine dates
   (`toEngineDate`), paired sorting (`engineSorting`), serialized variable writes
   (`toEngineVariable(s)`), text/plain endpoints, raw variable reads, incident recovery,
   queued batches) lives in the engine contract,
   `packages/connectors/camunda/camunda7-client/src/engine-contract/`, used by `tools/` AND
   `data/` (guards: `src/engine-contract.test.ts`, `src/tools/*.wire.test.ts`: every write
   tool has a recording-fake-engine wire case). Analytics periods derive from
   `PERIODS`/`PERIOD_RANGE` (analytics-client), no hardcoded enum copies. The profile STORE (record schema, in-memory/
   filesystem/postgres implementations, migrations) is core:
   `packages/core/widget-shell/src/profile-{record,store,store-postgres,migrations}.ts`
   (`@miragon/pulse-widget-shell/server`); the record is connector-free (language,
   `modules.<module>` slices + metadata; no theme: a `theme` an earlier build stored stays an
   inert raw key; camunda7's engine/dashboard
   preferences live in ITS slice, `modules.camunda7`, projected to a flat
   `UserProfile` view in `camunda7-connector/src/lib/profile-schema.ts`).
   Records migrate on read through `parseStoredProfile` (shared by every store;
   per-FIELD fail-soft); a `PROFILE_SCHEMA_VERSION` bump without a matching
   `PROFILE_MIGRATIONS` entry leaves stored preferences un-migrated (the history starts at
   `PROFILE_MIGRATION_BASELINE`; older records are adopted, not upgraded). Saves merge over
   the RAW stored document (`mergeStoredProfile`, inside each store's per-key lock),
   never over the parsed view, so keys a newer build wrote survive. **Whose** profile a request touches is
   decided in exactly one place for ALL modules: `resolveProfileKey`/`resolveAuthUserId`
   - `ANONYMOUS_PROFILE_KEY` + the narrow `ProfileSource` port, in
     `packages/core/widget-shell/src/profile.ts` (`@miragon/pulse-widget-shell/server`). A
     module-local copy of that precedence would silently split one user's settings across
     two records; the app's `module-contract.ts` carries a compile-time assertion that
     camunda7's `ProfileStore` still satisfies the port. The only identity is the OAuth
     caller (`resolveCaller` over the handler `ctx`; always pass it, ctx-less paths such
     as pipeline steps read the ambient request info): nothing a client chooses (a session
     id, a header) is a key, and a request without OAuth (or without any request context)
     has NO identity (saves refuse), never the `anonymous` record, which only an explicitly
     declared local caller (`anonymousCaller`) reaches.
     The whole PERSISTENCE layer follows the same rule: the postgres.js client
     (`createSql`), the migration runner (`runMigrations` + the `Migration` shape) and the
     Postgres dashboard store (`createPostgresDashboardStore`, implementing the toolkit's
     `DashboardStore`) live in `packages/core/widget-shell/src/{postgres,dashboard-store-postgres}.ts`
     next to the profile store; a composed server imports them from
     `@miragon/pulse-widget-shell/server` instead of reimplementing them, and the app's
     `src/persistence/index.ts` shrinks to the env→backend SELECTION (`DATABASE_URL` beats
     `MCP_PROFILE_DIR`/`MCP_DASHBOARD_DIR` beats in-memory). Migration `name`s are the keys
     recorded in `schema_migrations`: append-only, never renamed (a rename re-runs the DDL
     on every existing database), and each store owns its own array. Writes that first-create
     a row take a per-key `pg_advisory_xact_lock`: `SELECT … FOR UPDATE` cannot lock a row
     that does not exist yet, so without it two concurrent first saves both take the create
     branch and the second silently overwrites the first, ownership check included.

8. **Modules are self-contained peers; an MCP server app is a thin composition root.**
   Its package rules (layout, naming, dependency edges) hold for every workspace package;
   its composition-root rules hold for MCP server apps (this repo's and the template's).
   Connector packages never import each other. Layout + naming carry the layer
   semantics and are load-bearing for the guardrails: connector modules live at
   `packages/connectors/<family>/<name>-connector` (npm `@miragon/pulse-<name>-connector`),
   their SDK leaves at `packages/connectors/<family>/<name>-client`
   (npm `@miragon/pulse-<name>-client`), a family's interface-neutral use cases at
   `packages/connectors/<family>/<name>-domain` (npm `@miragon/pulse-<name>-domain`),
   foundation packages under `packages/core/` (npm `@miragon/pulse-<name>`, no role suffix)
   and apps at `apps/<dir>` (npm `@miragon/pulse-<dir>`). An app whose package.json declares
   `engines.vscode` is a VS Code extension: vsce takes no scope, so it is named after the
   product, `pulse` (Marketplace id `miragon-gmbh.pulse`; the root package is `pulse-monorepo`,
   so `--filter pulse` names the extension alone; it need not be private), and the lowest `@types/vscode` it allows never exceeds the
   major.minor of the lowest VS Code its `engines.vscode` admits (vsce refuses the package
   otherwise); `engines.vscode` outside `apps/*` fails. A package directory is lowercase
   kebab-case and never repeats the `pulse-` prefix. The rules and the gate key on
   `@miragon/pulse-`, never on bare `@miragon/`, which the toolkit shares. A new package that
   follows the convention is covered by the dependency rules without touching them; one that
   breaks it would silently fall OUT of the rules, which is why the convention itself is
   gated: `scripts/check-package-naming.mjs` (`pnpm lint:naming`, part of `pnpm lint`) fails
   on any workspace package whose directory or npm name breaks the pattern, on a
   `pnpm-workspace.yaml` glob outside these layouts or a package directory no glob includes,
   on a `package.json`, lockfile or `pnpm-workspace.yaml` nested anywhere else under `apps/*`
   or `packages/*`, on a `.js`, `.mjs`, `.cjs`, `.jsx`, `.mts` or `.cts` file under a
   package's `src/` (the ESLint complexity/max-lines budgets and pattern gates, globbed
   `*.{ts,tsx}`, and widget-shell's brand-gate scans read `.ts` and `.tsx` only), on a
   `generated/` directory its `GENERATED_DIRS` map does not list with a reason (such a
   directory is exempt from ESLint, prettier and the app's source scans; it lists the CIB
   seven SDK and the CLI's command catalogs; dependency-cruiser excludes only the SDK), and
   on a `package.json` that declares an app in `dependencies`, `devDependencies`,
   `peerDependencies` or `optionalDependencies` (by name, by an `npm:`/`workspace:` alias or
   by a path into its directory; the root `package.json` and an app's own included). The app
   names are those of every `apps/*/package.json` plus its `RESERVED_APP_NAMES` (empty
   today, kept equal to the extra names of the dependency-cruiser config's
   `APP_PACKAGES`): under pnpm another package reaches a workspace app (an import,
   `require.resolve`, its bin, a spawned process) only through such a declaration, which no
   dependency rule reads. The dependency edges of this invariant (connector
   peer-isolation, connector→own-client and connector→own-domain only, leaf clients, pure
   leaf domains, foundation core, no package importing an app, no app importing an app,
   interface apps reaching only a -domain package, no cross-package deep imports) are
   machine-enforced by `.dependency-cruiser.cjs` via the root `pnpm lint:architecture` and
   `pnpm lint:architecture:cli` (the CLI's `scripts/` and `test/`; both part of `pnpm lint`).
   A -domain package imports no other workspace package (its own client's wire subpaths are
   opened when they exist), no zod, no @hey-api, nothing of the MCP/UI stack, no vscode and
   no commander, and no Node built-in outside its tests; its Node
   globals (`process`, `Buffer`, `__dirname` …) are banned by a literal `no-restricted-globals`
   block in `eslint.config.mjs`, since dependency rules see only imports. The interface apps
   (the CLI, npm `@miragon/pulse-cli`; the extension, `pulse`) import from the
   workspace only -domain packages and nothing of the MCP/UI/server stack, zod included;
   no module imports them (dependency-cruiser), and no `package.json` declares them (the
   naming gate). An import reaches a rule in three shapes (a relative escape,
   `<importer>/node_modules/<name>/` for a declared dependency imported at its root, a bare
   specifier for a subpath or an undeclared dependency), and the rules name all three: never
   exempt a package's own directory in a `pathNot`, its node_modules holds exactly the
   declared imports a rule is about. Every rule has planted violations in
   `scripts/dependency-cruiser-gates.test.mjs` (a pnpm-shaped fixture with the future apps
   and -domain packages, cruised with the real config), and a new app adds its npm name to
   the config's `APP_PACKAGES` or the self-test's sync case fails. Each module exports its definition in
   `src/module.ts` (config schema, `configFromEnv`, `knownEnvVars`, `toolsets`,
   `bootWarnings`, `instructions` (its slice of the MCP server instructions, where rules
   that hold for every tool, camunda7's engine routing, live instead of 60 descriptions),
   plugin factory) conforming STRUCTURALLY (no import) to the port. The
   port SHAPE (`ComposableModule<TShared>`) and the whole composition-root machinery
   (`composeModules`: `MCP_ACTIVE_MODULES` parsing incl. `module:toolset` suffix;
   `resolveBoot(env, { authenticated })`, which resolves ONE concrete toolset per module
   per boot from the module's declared `toolsets` vocabulary (`createToolsetVocabulary`;
   a module without one has no toolsets) and threads it into `config.toolset`;
   `logEffectiveToolsets`, the one boot line stating each module's toolset and why;
   env-typo warner with prefixes derived from every known var, boot warnings,
   AppConfig/plugin assembly) live in `@miragon/pulse-widget-shell/server`. The root passes
   `authenticated` only when it actually INSTALLED OAuth, never inferred from an env var;
   every root builds that provider with the shared `oauthFromEnv` (`MCP_OAUTH`).
   Framework durable writes no module toolset filters (the toolkit builder's
   `get-builder-catalogue` + `save/list/load/delete-dashboard`, the shell's
   `shell_save_settings`) are registered only when `frameworkWritesAllowed(boot)` holds:
   OAuth installed AND no active module on its read-only floor;
   `render-view`/`refresh-view`/`get-framework-manifest` and the shell's
   `shell_show_settings`/`shell_settings_data` stay always. The
   app's `module-contract.ts` instantiates it with ITS `SharedResources` and its `setup.ts`
   only declares the module list and wires `SharedResources` (profile store +
   `fetchBpmnXml`, the camunda7 BPMN-XML lookup injected into the analytics heatmap and
   the names in its views, per engine id: `null` means not deployed there, a failed read
   rejects; and
   `engineIds`, camunda7's configured engines: the ONLY engines analytics reads, else
   `ANALYTICS_ENGINE_IDS`, else every analytics tool refuses; analytics has NO
   engine-SDK dependency). An MCP server app owns no domain UI: widget catalogues and
   components live in packages, and no boot plumbing either. The bundle root's provider
   stack (`AppShellProviders`: host context + display mode → host document → host
   bridge → `ProfileGate` → host widget registry; order is load-bearing; the language
   resolves explicit profile (the shell's own `shell_settings_data`, no host names a
   feed) > host context > English, the theme host context > OS (no
   in-app switch), applied to `.dark`, `data-theme` and `color-scheme` alike; `HostDocument`
   applies the host's style variables, then the toolkit's `adoptHostFontVariables`) plus
   `LocalizedAppView` (the toolkit's `McpAppView` with its own en/de chrome catalog and
   fullscreen gate; `titleMode` "hide" over a module view, whose widget heading is the one
   title, "show" over a composed `render-view`) live in `@miragon/pulse-widget-shell/widgets`;
   the stylesheet is the toolkit's `@miragon/mcp-toolkit-ui/theme.css` after `tailwindcss`
   (never its `globals.css`, a second Tailwind entry, nor `fonts.css`, base64 Geist per view;
   Geist arrives by URL from the server's font route, `declareServedFonts` in `HostDocument`;
   no height floor on html/body/#root; `test/ui-stylesheet.test.ts`), and the whole server
   boot lives in `/server`:
   `createComposedServer` owns the ORDER (env-typo warnings + HTTP edge policy + the
   OAuth/`MCP_URL` check → ONE `resolveBoot`, authenticated exactly when the root hands
   in an OAuth provider → boot log → the root's `setup(boot)` (plugins, persistence) →
   `createFrameworkApp` with `serverInfo` (version from the root's `package.json`, title,
   `instructions`) and the view CSP (`fontAssetsCsp`: `MCP_URL`'s origin in `resourceDomains`,
   carried onto every plugin's view-bound tools and their `openai/widgetCSP` by
   `honorWidgetMetaDefaults`) → request context (request logging is mcp-use's own,
   `MCP_USE_LOG_LEVEL`; debug/trace warn at boot) → `swallowDevCliViewsPrime` →
   `installMetrics` (labels bounded by construction: tool
   catalogue + known routes, never users/sessions/arguments; optional
   `MCP_METRICS_TOKEN` bearer) → `installHttpEdgeGuard` → `installHealthEndpoints`
   (readiness probes the server's OWN dependencies only, never engines or Prometheus;
   503 `draining` during shutdown) → `installFontAssets` (Geist + Geist Mono under the
   versioned `SERVED_FONT_PATH`, immutable, CORS `*`, behind the guard: a font GET passes
   the Origin half, never a foreign Host); metrics first, hono only counts routes registered
   after its middleware) and its `listen()` serves production through
   `createBodyLimitedListener` (mcp-use's public `toNodeHandler` behind the
   `MCP_MAX_BODY_BYTES` cap (413 before buffering), an in-flight body budget of 4× the
   cap (503) and a 30 s request timeout; a request the guard refuses is never read,
   both decide by the one `edgeRejection`) with the graceful drain (stop accepting →
   in-flight finish, bounded, readiness 503 `draining` → `app.close()` → the root's
   `runtime.shutdown()`). The edge (`resolveHttpEdgePolicy`) is DNS-rebinding protection:
   Host on every request, Origin on non-GET requests that carry one, admitted only when
   localhost-class, `MCP_URL`'s or in `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS`;
   `/health*` and `/metrics` are exempt (probes and scrapers address a container by IP);
   never swap it for mcp-use's `allowedHosts`, which guards those too. Each MCP server app owns ONE
   `createApp(env, deps?)` (`src/app.ts`: its OAuth decision, persistence, plugins) that
   `src/index.ts` (production and `mcp-use dev`, which owns the socket (no cap, no drain)
   and the Host check: the guard defers that half to the CLI, which admits its tunnel host)
   AND the e2e suites boot (never a test-only re-implementation of the boot), so
   `src/ui/main.tsx` and `src/index.ts` stay composition (registry, profile-feed name,
   app-specific layers like `Camunda7StandaloneShell`) and a toolkit/mcp-use migration
   lands once instead of in every composed-server fork.
   Cross-module UI is tiered: `shell:*` widgets via
   `props.dataKey`; raw tool-name strings with graceful degradation (reference:
   `process-incidents/flow.tsx` → `analytics_bpmn_heatmap_data`); hard-composed views go in a
   dedicated package created with the first real view, never in the app, never as
   module-to-module imports. The host bundle is static (`MCP_ACTIVE_MODULES` changes only
   the server's tool surface), so a widget-registry lookup cannot tell a runtime-INACTIVE
   module; a surface that only makes sense with another module probes one of its cheap
   feeds (reference: `useAnalyticsActive` → `analytics_settings_data`, gating camunda7's
   cross-engine view) and appears once confirmed. Graceful degradation hides a stale raw
   name at runtime, so `apps/mcp-server-camunda7/test/tool-name-refs.test.ts` checks every
   `<module>_…` string literal in app and package sources (the shell's `shell_…` tools
   included) against the full booted tool surface. Which apps the source guards read is
   single-sourced in `apps/mcp-server-camunda7/test/source-scan.ts` (`APP_SCAN`): every scan
   fails on an app the map does not classify, on an entry that names no app and on a
   classified app without `src/`. An MCP server app ("mcp-host") is read by every guard; an
   interface app ("interface": a CLI, an editor extension, always an app that declares
   `engines.vscode`) only by the tool-name checks: each `<module>_…` literal it holds must
   name a registered tool, each parameter it quotes for a tool must be one that tool takes,
   and none of its prose (a string with whitespace) may name an app-only feed. Of these
   guards only the widget rules of invariant 6 and the helper resolution of tool-name-refs
   read just the packages and the MCP server apps (scope "mcp" of `scanSources`), and so does
   the server's `PULSE_*` guard (Contracts). An interface app resolves no helper: its own
   helper names never make a server check opaque, and a helper call inside the parameters it
   quotes reads as opaque and fails. `apps/mcp-server-camunda7/test/source-scan.test.ts` pins
   each guard's scope at its call site. A new app's import PR adds its entry.
   The settings page is the SHELL's (#346): `createShellPlugin({ profileStore, allowSave })`
   registers `shell_show_settings` (the page, `shell:settings-page`, also the cockpit's
   settings tab), `shell_settings_data` (its language section, `shell:settings`, and what
   `ProfileGate` reads) and `shell_save_settings` (the record-level `language`, gated by
   `frameworkWritesAllowed(boot)`); no connector owns the language or the page, and every
   host bundle spreads widget-shell's `shellWidgets`. It follows the same tiers: each module
   owns its settings section (widget + `*_data` feed + save tool; reference:
   `analytics:settings` + `analytics-connector/src/settings-tools.ts`; the save tool honors
   `analytics:read-only`), its slice persists under `profile.modules.<module>`
   (validated fail-soft by the owning module; camunda7's save tool deliberately
   excludes `modules`), and composed views reference foreign section widgets by raw
   id, resolved through `HostWidgetsProvider` (host root) and dropped by
   `filterLayoutToWidgets` when unresolvable, so a missing module's section disappears
   instead of erroring (a bundled section whose module is inactive hides itself once its
   feed's tool answers "not found", `classifyError(…).kind === "notOnServer"`). The
   settings LAYOUT is not hand-maintained: `settingsLayout` (`@miragon/pulse-widget-shell/widgets`)
   assembles the page from the HOST's widget registry: the shell's `shell:settings`
   section first, then one row per `<module>:settings` id in registration order (camunda7's
   is `camunda7:settings`: engines and dashboards), so a custom module in a composed
   server contributes its section without an edit in any package.
   The convention (`<module>:settings`) is therefore load-bearing, and the failure mode
   stays silent (a section whose widget never reaches the host registry is simply
   absent), so `apps/mcp-server-camunda7/test/widget-registry.test.ts` asserts the
   assembled layout against both module catalogues and the shell's (the template test
   does the same for its modules). Save-input schemas at tool
   boundaries must be default-FREE (zod 4 re-applies `.default()`s through `.partial()`,
   materializing omitted fields into silent resets; derive them with `withoutDefaults`
   from `@miragon/pulse-widget-shell/server`; see
   `userProfileToolSaveInput`/`analyticsSettingsSaveInput`). A durable write registered
   outside the tool registrar gates itself against the module's declared toolset names
   (`allowsDurableWrites` in `analytics-connector/src/toolsets.ts`, `isToolInToolset` in
   camunda7), never an ad-hoc `toolset === "read-only"` compare, which fails open for
   every other name, and never a `toolset === undefined` shortcut either: an absent
   toolset no longer means "everything", the vocabulary resolves it to the read-only
   floor. The write carries that same decision into its view as `canSave`, so the
   section renders disabled fields instead of a Save button whose click would resolve to
   an unknown tool. In-widget engine writes follow the same rule, through ONE
   primitive: every widget write runs via `useEngineAction`
   (`camunda7-connector/src/widgets/lib/engine-action.ts`), which bundles the gate
   (`allowed`, from `camunda7_widget_actions_data` → `allowedWidgetActions` for the tools
   in `CAMUNDA7_WIDGET_ACTIONS`; the profile save passes its view's `canSave`; AND the
   subject's current state, `available`: no write on an ended, cancelled or
   unconfirmed instance, i.e. one whose refetch failed even once), the
   confirmation that NAMES its target, the targeted invalidation and the optimistic
   marks (`WRITE_POLICY` in `widgets/lib/write-policy.ts` says what each write changes
   and whether it asks first); controls are hidden, not disabled.
   `src/widget-actions.test.ts` scans the widget sources structurally (no raw
   `useToolMutation`/`useCanRun` outside the primitive, no `callTool` of a write tool
   (renamed or aliased callers included), every write listed, every invalidated
   namespace a real query key), and `widgets/action-gating.test.tsx` renders every call site
   against a feed that excludes its write. Standalone views refresh after a write
   because their tool result is the SEED of a live feed query (the toolkit's `useViewData`
   in `initialDataMode: "seed"`, also under widget-shell's `useDetailView`/`usePagedViewData`;
   `viewRefreshState` says when shown data is unconfirmed), scoped to the seed's own echoed
   engine and target. Engine _vendors_ (CIB seven, Operaton, Camunda 7) are
   per-engine runtime config (`flavor` → `EngineProvider` in
   `packages/connectors/camunda/camunda7-connector/src/providers/`; the port holds ONLY real differences:
   cockpit routes, branding, client hook; never an SDK mirror), never separate packages or apps; a different
   _dialect_ (Flowable) would be a new package family (client, connector, a domain once two
   interfaces share a use case) plus its own MCP server app (the axes under "What this repo
   is"). Extract shared packages on the second concrete
   consumer, never speculatively.

## Contracts

- **`packages/connectors/analytics/analytics-client/metrics-contract.json` is the single source of truth for
  metric names and labels: when changing a metric, change it here first.** The Kotlin
  plugin (`engine-plugins/cibseven-history-metrics/.../ProcessMetrics.kt`,
  `EngineStateMetrics.kt`) emits Micrometer meters whose dotted names (`otelName`,
  also the OTLP wire name on the push path) surface in Prometheus as `camunda_*`
  series (`promName`, e.g. `camunda.activity.ended` →
  `camunda_activity_ended_total`; durations are whole milliseconds with base unit
  `milliseconds`, spelled out so every export path appends the same `_milliseconds`
  suffix, and explicit `buckets` from 10 ms to 30 days, since Micrometer rounds an observation
  UP to a whole base unit before bucketing, so seconds emptied every sub-second bucket).
  History-event meters are recorded only once the engine command COMMITTED (a rolled-back
  job attempt counts nothing; `CommitBoundaryTest.kt` runs a real in-memory engine).
  The contract's `$comment` also fixes how every consumer READS a series: a counter or
  histogram only through the born-series count `increaseIn` (`queries/helpers.ts`;
  `increase()`/`rate()` never count a series' first sample, so the first incident at an
  activity would read 0), a gauge only folded over a clustered engine's nodes as
  `max by (<its contract labels>)` (`engineState`); `promql-reading-rules.test-support.ts`
  checks every query, alert rule and dashboard panel against both. Its consumers, the TS queries (via `METRIC_NAMES` in
  `packages/connectors/analytics/analytics-client/src/metric-names.ts`, never raw strings), the alert rules
  (`playground/docker/prometheus/alerts.yml`) and the Grafana dashboards
  (`playground/docker/grafana/dashboards/*.json`), are checked against the contract by tests on
  both sides: `packages/connectors/analytics/analytics-client/src/metrics-contract.test.ts` (vitest, also
  covers the Grafana dashboards incl. regex matchers, per-metric `sum by (…)` grouping
  labels, and a dead-entry check with a documented allowlist; its behavioural twin
  `src/metrics-contract-labels.test.ts` runs EVERY exported query function through a
  recording client and checks every matcher/`by`/`on` label against the contract, alert
  rules and dashboards included; its `SCENARIOS` map is total over `queries`, so a new
  export needs an entry, and new PromQL shapes extend the `*.test-support.ts` checker
  rather than bypass it) and
  `engine-plugins/cibseven-history-metrics/.../MetricsContractTest.kt` (Gradle, also
  checks the label keys each instrument attaches and each histogram's bucket bounds). A rename that skips the contract or
  a consumer fails one of them; don't weaken these guards to make a change pass. Only
  attach model-bounded labels (definition key, activity id, engine id …), never
  instance ids, business keys, or variable values.
- **Never aggregate a RATE across engines.** Engines host different process definitions,
  so a failure rate, incident rate or duration summed per `engine_id` measures that
  engine's process mix, not the engine; the aggregate can even invert the per-process
  truth. Cross-engine views therefore report absolute counts plus the engine-owned
  backlog gauges (`jobs_executable`, `jobs_suspended`, `jobs_due_future`,
  `external_tasks_open`, the family whose contract labels are `engine_id` ONLY, so no
  mix can confound them): `queries/engine-landscape.ts` + `analytics:engine-landscape`,
  surfaced in camunda7's cross-engine cockpit mode by raw widget id (tier-2). A
  like-for-like engine KPI comparison exists only with the process held fixed, which is
  why `engineCompare`/`analytics_engine_compare` REQUIRE a `processDefinitionKey`
  (`sharedProcessKeys` from the landscape are its valid inputs); don't make it optional
  again. The tool descriptions carry this rule to the model and are asserted in
  `src/tools/engine-{compare,landscape}.test.ts`.
- **Pinning is split by dependency stanza.** `dependencies`/`devDependencies` stay
  EXACT (`save-exact=true` in `.npmrc`; the `Miragon/pin-npm-dependencies` CI action
  enforces it and deliberately ignores `peerDependencies`). The genuinely
  consumer-shared libraries are published as RANGED `peerDependencies` so a downstream
  React + zod app dedupes them against its own copy instead of getting a second
  instance: `react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/mcp-toolkit-*`
  `~2.8.1` (2.8.x patches only, tracking the exact `mcp-use` pin). Each ranged peer also
  appears as an EXACT `devDependency` so the in-repo build/tests resolve a concrete
  version. A package published to npm (every workspace package, apps included, that is not
  `"private": true` and declares no `engines.vscode`; an extension ships as a .vsix) imports
  from its src only what its `dependencies` or `peerDependencies` declare
  (`apps/mcp-server-camunda7/test/published-imports.test.ts`, over the globs of
  `pnpm-workspace.yaml`, reading every import form through the TypeScript AST: either quote
  style, re-exports, `import()`, `require`, type imports; a computed specifier is a finding;
  knip counts a devDependency as listed, so it cannot see this). An app that bundles
  workspace packages it lists only as devDependencies fails that scan by design: the PR that
  starts bundling replaces its src scan with a test over the built bundle plus a size
  budget. **`mcp-use` is the exception: exactly pinned even as a peer** (`2.7.3`): a
  duplicate `mcp-use` instance breaks the React context and hangs every in-widget query
  on "Loading…" (invariant #4), so its exact pin is load-bearing. Name the required
  `mcp-use` version in each package README and the release changelog. Toolkit updates are
  still deliberate version bumps across all packages; never bump a single package in
  isolation; the toolkit peers `mcp-use` exactly (toolkit `2.8.1` → `mcp-use@2.7.3`;
  `zod`/`react` it peers as ranges), so a toolkit MAJOR/MINOR bump is a joint toolkit + `mcp-use` bump across
  every package incl. `templates/composed-server`; `scripts/test-template.sh` fails if
  the template is left behind.
- **The widget `_meta` contract is split since mcp-use 2; never hand-write the
  `ui` half.** mcp-use emits the MCP-Apps keys (`_meta.ui.resourceUri`, flat
  `ui/resourceUri`, `_meta.ui.visibility`, the view resources `ui://views/<tool>.html`)
  natively from the tool's first-class `view`/`visibility` fields and OVERWRITES the
  `ui` namespace on tools/list; the toolkit's `appsSdkMeta({ resourceUri:
viewResourceUri(name), title })` stamps only the `openai/*` half
  (`openai/outputTemplate`, `openai/toolInvocation/*`, `openai/widgetAccessible`,
  `openai/resultCanProduceWidget`). App-only `*_data` feeds stay free of the rendering
  keys on purpose. Guarded by
  `apps/mcp-server-camunda7/test/widget-meta.test.ts` (unit) and
  `apps/mcp-server-camunda7/test/widget-contract.e2e.test.ts` (on the wire, **by name**: every
  `*_show_*` tool must carry the widget `_meta`, every `*_data` feed must be app-only;
  the naming convention is load-bearing, don't weaken the name checks).
- **The tools/list wire payload is a golden, per toolset.**
  `apps/mcp-server-camunda7/test/tools-list.golden.test.ts` boots `createApp` for
  read-only (unauthenticated default), operations (default under OAuth) and admin (full
  surface) and compares the complete sorted tools/list (descriptions, titles, annotations,
  `_meta` incl. `ui.visibility`, input/output schemas) against
  `test/__golden__/tools-*.json`. The ONLY update path is
  `GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server-camunda7 test` (refused in CI);
  never hand-edit a golden. `__golden__/char-budgets.json` pins each surface's
  model-visible size (name + title + description + inputSchema of non-app-only tools):
  the test pins it exactly and `pnpm lint` makes it shrink-only, so a tool change that
  makes the model read MORE text needs a `Ratchet-Exception:` trailer (see Verification).
  The name lists in `test/expected-tools.ts` stay the reviewable per-toolset summary.
- **The widget bundle has a budget.** Every view resource inlines the whole bundle, so its
  size is the cost of every render: `test/__golden__/bundle-budget.json` holds gzip ceilings
  for `mcp-app.js`/`.css`, `test-host/bundle-budget.spec.ts` checks the BUILT dist against
  them (over a ceiling fails, and so does a bundle more than 10 % under it, so the
  headroom never piles up), and `pnpm lint:ratchets` keeps the ceilings shrink-only; growth
  needs a `Ratchet-Exception:` trailer that says why. Every view also names itself (the
  tool title as the resource `description`) and asks the host for a border
  (`prefersBorder`, `showToolBinding`).
- **Federation/aggregation happens in an external MCP gateway (agentgateway) IN FRONT of
  this server; this repo builds one self-contained MCP server including its UI.** No
  upstream/proxy mechanics in the code; don't reintroduce a proxies/upstream option
  (federation was deliberately dropped in #162). A gateway that terminates auth in front
  is invisible to this server: without `MCP_OAUTH` it boots read-only and has no caller
  identity (no saved settings), so such a deployment must name its toolsets in
  `MCP_ACTIVE_MODULES`. The generic
  `shell:kpi-grid`/`shell:data-table` widgets (catalogue + components in
  `@miragon/pulse-widget-shell`) are always registered: they are the standard
  `render-view`/builder composition targets for KPI rows/tables, fed via `props.dataKey`.
- **The server reads no `PULSE_*` variable.** PulseAudio owns `PULSE_*` (`PULSE_SERVER`,
  `PULSE_COOKIE`), and `PULSE_CLI_*` is reserved for the CLI. The typo warner watches the
  prefix of every known variable, so one server name under `PULSE_` would make the server warn
  about both in a shared environment (a devcontainer, a Compose file). A server setting goes
  into its own family (`CAMUNDA_*`, `PROMETHEUS_*`, `ANALYTICS_*`, `MCP_*`, `DATABASE_URL`).
  `apps/mcp-server-camunda7/test/setup-env.test.ts` fails on a known variable under
  `PULSE_`, on a server source (every package and every MCP server app's `src`, per `APP_SCAN`;
  an interface app keeps its own `PULSE_CLI_*` names) or an `.env.example` that names one, and
  on a warner that flags `PULSE_SERVER` or `PULSE_CLI_*`.

## Releases & toolkit contributions

- **Everything releases through one release-please train.** Conventional commits on
  `main` drive `release-please.yml`, which opens/updates a single Release PR (root
  component, tag `v<version>`); release-please bumps the root, every app under `apps/` (the
  CLI also its Claude Code plugin manifest
  `apps/cli/skills/pulse-cli/.claude-plugin/plugin.json`, which the `CLI plugin (validate)` job
  holds equal), all five `packages/` `package.json`s, the template's `@miragon/pulse-*` pins,
  the camunda7-client User-Agent line in
  `packages/connectors/camunda/camunda7-client/src/hey-api.ts` (`x-release-please-version`,
  held equal to its `package.json` by `client.test.ts`) plus
  `engine-plugins/gradle.properties` in lockstep (`extra-files` in
  `release-please-config.json`). Merging the PR creates the release; the publish
  workflows then wait for manual approval of the `release` environment gate.
- **The five packages and the CLI publish to the public npm registry.** The release train's
  `publish-npm` matrix calls `publish-npm-package.yml` (OIDC trusted publishing, no
  NPM_TOKEN; provenance attached) for `@miragon/pulse-{widget-shell,camunda7-connector,
camunda7-client,analytics-connector,analytics-client}` and `@miragon/pulse-cli` (`apps/cli`); matrix entries are repo-relative
  package directories (`packages/core/widget-shell`) and list exactly the workspace packages npm
  receives: every one that is neither `"private": true` nor a VS Code extension (an app whose
  `package.json` declares `engines.vscode` ships as a .vsix through vsce/ovsx, never through the
  matrix); the npm name is read from each `package.json`, and each of them names this repository
  in its `repository` field (`type` git, `url` `git+https://github.com/Miragon/pulse.git`,
  `directory` its own directory): npm refuses a provenance publish whose repository is not the
  one that built it. Its pack job installs, builds and `pnpm pack`s without `id-token` and
  without a dependency cache (pnpm rewrites `workspace:*` to the release version, `npm pack`
  would ship it verbatim); its publish job, the only job that holds `id-token` in any form,
  holds exactly `id-token: write` in the `npm` environment, uses only `actions/setup-node` and
  `actions/download-artifact` at the repo's pins, runs no package manager (only `npm --version`,
  `npm view`, `npm publish`), refuses a tarball whose version is not the release tag and runs
  `npm publish <tgz> --provenance`. A version already on npm passes only when its provenance
  names this repository (a re-run); otherwise the job fails. A `workflow_dispatch` dry run packs
  every package and publishes none. `scripts/check-github-config.mjs` (`pnpm lint:github`) pins
  that shape, the matrix, the `repository` fields and the `extra-files` (the root, every
  workspace package under `apps/` and `packages/`, and every Claude Code plugin manifest an app
  ships) against the workspace, that every job of `release-please.yml` past the approval waits
  for `gate`, that it calls `publish-cli.yml` and `publish-homebrew.yml`, their triggers and
  token shape, and with them the Dependabot groups, the ruleset's required checks as job names of pull request workflows, the
  report artifacts, the nightly run over every package form (incremental, forced only by a manual dispatch, its fingerprinted cache key) and the `incremental`/`incrementalFile` of every
  `stryker.config.json`.
  Afterwards `sync-template-mirror.yml` waits until the versions are visible on npm and
  mirrors `templates/composed-server` to the `Miragon/pulse-starter` repo, the
  customer-facing composition path (own server + own connector on the published
  packages), drift-gated by `scripts/test-template.sh`. Only the server app and the VS Code
  extension stay `"private": true`.
  Up to 0.20.0 the packages, image and starter shipped under `miragon-ai`
  names (the root README's rename note maps each); those names are retired, never reuse them.
- **The VS Code extension ships as a .vsix, never through npm.** release-please bumps
  `apps/vscode/package.json` with the train (`extra-files`). After the `release` gate, the
  `publish-vscode` job of `release-please.yml` calls
  `.github/workflows/publish-vscode-extension.yml`: its package job (`contents: read`, no
  credentials) builds and `vsce package`s the extension on every release and dry run and
  refuses a version that is not the tag or carries a prerelease suffix; its publish job, the
  only job with store credentials, runs in the `vscode-marketplace` environment (`main` only),
  installs the lockfile's vsce and ovsx with `--ignore-scripts`, builds nothing and publishes
  the same file to the Visual Studio Marketplace and Open VSX (`--skip-duplicate`; the
  organization secrets `VSCE_PUBLISH`/`OVSX_PUBLISH` every Miragon extension publishes with, which
  the caller hands down by name, never `secrets: inherit`; unset, trusted publishing over
  `id-token: write`); a third job attaches it to the release. It publishes only when the
  repository variable `VSCODE_PUBLISH` is `pre-release` or `release`; unset or `off` the
  release only packages, any other value fails the job. `pnpm lint:github` pins that path.
- **Engine plugins publish to Maven Central via `publish-to-maven.yml`** (called from the
  release train): the Vanniktech Maven Publish plugin runs
  `publishAndReleaseToMavenCentral` against the Sonatype Central Portal (thin jar +
  sources + javadoc, GPG-signed; signing gated on `-PsignArtifacts=true`). Credentials
  are `ORG_GRADLE_PROJECT_*` env vars (`mavenCentral{Username,Password}` +
  `signingInMemoryKey{,Id,Password}`) from the `MIRAGON_SONATYPE_*` / `SIGNING_*` secrets.
  All engine plugins share the umbrella group `io.miragon.mcp` (reusing the org's verified
  `io.miragon` Central namespace) with the engine carried in the artifactId
  (`<engine>-<artifact>`); the cibseven metrics plugin publishes as
  `io.miragon.mcp:cibseven-history-metrics`. Per-module publishing config lives in the
  module's own `build.gradle.kts` (`mavenPublishing { ... }`), not the root convention.
- **The server image publishes via `publish-to-docker.yml`** (same train, the file name
  kept): builds the root `Dockerfile` multi-arch and pushes
  `ghcr.io/miragon/pulse-server:<version>` and `:latest` to the GitHub Container Registry
  (version = release tag without the `v` prefix, falling back to
  `apps/mcp-server-camunda7/package.json`). It logs in with the run's `GITHUB_TOKEN`, no
  registry secret; a reusable workflow gets no more than its caller grants, so the
  `publish-docker` job in `release-please.yml` grants `packages: write` itself. Nothing
  publishes to Docker Hub.
- **The CLI's binaries, image and Homebrew formula publish via `publish-cli.yml` and
  `publish-homebrew.yml`** (same train, behind the same gate). One standalone bundle becomes
  five Node.js 24 single executable applications, each built and smoke-tested on its native
  runner (Linux x64 and arm64, macOS Intel and Apple silicon, Windows x64) and attached to the
  release of the tag with their `.tar.xz` archives, `pulse-cli-SHA256SUMS` and a build
  provenance attestation. `apps/cli/Dockerfile` (distroless Node.js 24) becomes
  `ghcr.io/miragon/pulse-cli` (`<version>`, `<major>.<minor>`, `latest`) with SBOM, provenance
  and an attestation, pushed with the run's `GITHUB_TOKEN`. For a stable release the formula
  `miragon/tap/pulse-cli` (`apps/cli/scripts/homebrew-formula.sh`, verified on macOS and Linux;
  it links `operate` to `pulse-cli`, which warns, until the first release after 2027-01-31)
  lands in Miragon/homebrew-tap as a squash-merged pull request with a token of the
  release-please app. The build jobs hold `contents: read` only; the jobs that hold a token
  install nothing. A new GHCR package starts private, and an organization owner makes it public
  once.
- **`@miragon/mcp-toolkit-*` lives in a separate repository.** In `devDependencies` it is
  exactly pinned (`save-exact`, currently `2.8.1`); in the published surface it is a
  ranged `peerDependency` (`~2.8.1`) so consumers dedupe it. Toolkit changes arrive here
  as a deliberate, repo-wide version bump; since 1.0 the toolkit follows semver
  (breaking changes arrive as major bumps).
- **Validating unreleased toolkit changes:** build + `pnpm pack` the toolkit packages,
  point temporary `overrides` in `pnpm-workspace.yaml` at the `file:` tarballs (park any
  `patchedDependencies` entry for the same package while doing so), run the full bar plus
  `test:host`, then revert the workspace yaml + lockfile. Never commit the overrides.

## Verification: what each check actually covers

| Check                | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`         | tsc emit of server code + the server app's Vite widget bundle (`build:ui`); excludes widget `.tsx` type errors in packages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm typecheck`     | **The only check that type-checks widget code**: `tsc -p tsconfig.widgets.json` in the two connector packages, `tsc -p tsconfig.ui.json` in the server app; the VS Code extension runs `tsc -p tsconfig.<layer>.json` per layer, each with that layer's runtime globals only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test`          | Vitest unit tests (lib + query logic) **plus** the server app e2e smoke + widget wire-contract tests + per-toolset tools/list goldens (in-process boot, loopback HTTP) + the repo-wide doc-reference and old-name guards (`docs-refs.test.ts`, `old-names.test.ts`); **no widget rendering** (the VS Code extension's webview tests render in Chromium, vitest browser mode; locally once: `pnpm --filter pulse exec playwright install chromium`); enforces the per-package coverage ratchet (frozen thresholds in each `vitest.config.ts`); then `test:scripts`, `node --test` over `scripts/*.test.mjs` (the gate scripts' own tests + the ESLint pattern-gate self-test)                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm lint`          | ESLint over each package's `src` (the server app also `test`/`test-host`) incl. the pattern gates (registrar-only tools, widget-shell date formatting), then `lint:architecture` and `lint:architecture:cli` (dependency-cruiser), `lint:architecture:vscode` (the VS Code extension's closed-world rules over its src, test, dev and scripts, `apps/vscode/.dependency-cruiser.cjs`), `lint:naming`, `lint:package-scripts` (each `src/` package runs the canonical `eslint src` (+ a final `*.config.ts`) / `tsc --noEmit` (+ `tsc -p` per extra tsconfig) / `vitest run` (+ `stryker run`); turbo skips a missing script, a flag can switch one off), `lint:ratchets` (`scripts/check-ratchets.mjs`, below; needs `git fetch origin`), `lint:deadcode` (knip over files/dependencies/unlisted; unused exports only in `pnpm exec knip`), `lint:deadcode:cli` and `lint:deadcode:vscode` (knip over `apps/cli` and over `apps/vscode` with every issue type, unused exports and types included), `lint:github` (`scripts/check-github-config.mjs`, see Releases) |
| `pnpm test:mutation` | Diff-scoped Stryker run, local and on demand (`scripts/mutation-diff.mjs`): changed files inside a package's `mutate` allowlist must keep the mutation score above the package's `thresholds.break` (`stryker.config.json`). It bypasses the package's incremental cache. More than 25 in-scope files in one package FAIL it unless the branch carries a reviewed `Mutation-Cap-Exception: <reason>` trailer, which only this local run reads. A pull request runs no mutation check (owner decision): CI mutates only nightly, in `.github/workflows/mutation-nightly.yml` (every package's whole allowlist on its incremental cache, forced only by a manual dispatch, no required check)                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm fitness`       | Aggregated fitness report: architecture graph, ratchet debt, per-package coverage + mutation scores (the file count next to each score says over what): on a pull request the "Fitness report" job over the test job's coverage artifact, its mutation column "(no run)"; nightly the "Mutation summary" job of `.github/workflows/mutation-nightly.yml` over every package's whole allowlist (no coverage)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `./gradlew build`    | Kotlin compile + unit tests + Konsist architecture tests (run in `engine-plugins/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `test:host`          | `pnpm --filter @miragon/pulse-mcp-server-camunda7 test:host`: Playwright host simulation of the **built** widget bundle: the view document `createApp` serves (`resources/read`), sandboxed behind a SEP-1865 host shim, rendering a real camunda7 show tool against a stub engine (keep/strip, slow tool, `isError`, cancel, host theme, display modes, served fonts: Geist drawn when allowed, the host's font when the host ignores `resourceDomains` or the route is unreachable; `pinned …` scenarios = known defects, flipped when fixed); runs in CI as "Widget host simulation (test:host)"; run it locally for changes to the widget shell, `src/ui/`, or the toolkit pin                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test:pg`       | The database slice: reruns the suites with `TEST_DATABASE_URL` pointed at the compose stack's test database, which un-skips the Postgres store + migration-runner tests (`describe.skipIf`). **The only check that executes the Postgres adapters**; runs in CI as "Postgres adapters (test:pg)" against a `postgres:` service container; run it locally for changes to `postgres.ts` or any `*-store-postgres.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Docker build         | `.github/workflows/docker-build.yml`: plain `docker build` of the root `Dockerfile` (no push) on every PR touching it, `apps/`, `packages/` or a root file the build stage copies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Engines              | `Engines (<flavor>)` in `.github/workflows/ci.yml`: one leg per flavor (Camunda 7, CIB seven, Operaton) against the real engine image in Testcontainers on Node 22, running the CLI's suites (the operaton leg also installs the packed tarball; each leg's image is held equal to the one `apps/cli/test/integration/support/engines.ts` pins) and the VS Code extension's conformance laws (both `test:engines`); the `Engines` job aggregates the legs and is the one check of the matrix a ruleset can require (not required yet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| VS Code smoke        | activation + every contributed command in VS Code stable under Xvfb, `test:smoke` (`.github/workflows/ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| VS Code package      | `vsce package` dry run of the production build (`.github/workflows/ci.yml`): bundles and bundled CLI in, no sources, maps or node_modules; the webview budget is `pnpm test`'s (`apps/vscode/test/architecture/bundle-budget.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLI jobs             | `ci.yml` on every PR: `CLI binary (<target>)` builds and smoke-tests the Node 24 single executable on Linux x64, macOS arm64 and Windows x64 (Linux and macOS also start it as `operate`; Linux also runs the Operaton suites against it and renders the Homebrew formula); `CLI image (build + smoke)` builds both platforms and checks `docker stop`; `CLI plugin (validate)` runs `claude plugin validate --strict` and compares the plugin's version; `CLI (all checks)` is the one check of these a ruleset can require (not required yet)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Manual               | `docker compose -f playground/docker/docker-compose.yml up -d` + `pnpm dev`, then exercise tools/widgets via the inspector at `http://localhost:8400/mcp/inspector` (`pnpm dev` only). The default boot is read-only; write paths need an explicit suffix, e.g. `MCP_ACTIVE_MODULES=camunda7:admin,analytics:standard` in `.env`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

A green `pnpm build && pnpm typecheck && pnpm test && pnpm lint` is the minimum bar for
every change; widget changes additionally need `test:host` plus a manual render check via
the inspector (the host simulation renders one real view, not every widget's data path).

Ratchet rules are shrink-only: the complexity/max-lines offender lists in
`eslint.config.mjs` (global budgets: complexity 15, 400 effective lines; the two imported
apps are stricter, complexity 10 and 300 lines: the CLI for its shipped code and scripts, with
400 for every CLI test, also under `apps/cli/test/`, and the VS Code extension, apps/vscode only)
and the coverage thresholds in each `vitest.config.ts` may only improve: delete a list entry or
raise a threshold when you better a file, never the reverse, and never add new entries. The
mutation ratchet works the same way inverted: each package's `mutate` allowlist in
`stryker.config.json` is the TESTED surface and may only GROW (add files when you add
tests), and `thresholds.break` may only rise. A package's FIRST configs are held by
`pnpm lint:package-scripts` (`scripts/check-package-scripts.mjs`) instead: every package
with `src/` carries a `vitest.config.ts` and a `stryker.config.json` with a numeric
`thresholds.break` above 0, a `mutate` list that selects files and its json report at
`reports/mutation-report.json` (the one path the nightly run and `scripts/fitness-report.mjs`
read); only an app listed with its reason in `NO_MUTATION_APPS` goes without one (today the
server app, whose logic lives in the packages), and a stale entry fails. The local diff run
(`pnpm test:mutation`, `scripts/mutation-diff.mjs`) knows the package roots
`scripts/check-ratchets.mjs` knows, apps included, fails on a config without `mutate` and runs
every pnpm filter with `--fail-if-no-match`. Mutation runs use
`vitest.stryker.config.ts` (coverage off: a coverage-threshold failure would read as a
killed mutant); the Stryker vitest runner disables per-file isolation, so DOM widget
suites stay out of the mutation test set (see the camunda7 connector's config). The
Postgres adapters (`src/postgres.ts`, `src/*-store-postgres.ts`) are out of BOTH sets
(the shared `coverage.exclude` in `vitest.shared.ts` and widget-shell's `mutate` negatives),
because their suites only run under `pnpm test:pg`: counted in, the same commit would
measure ten points apart depending on whether a database happened to be reachable, and
every mutant would survive by construction. That exclusion is scoped to those two
patterns and is not a precedent for excluding code that the default run CAN execute. The knip ignore
lists in `knip.jsonc` follow the same convention: every entry carries its reason and
the lists may only shrink; gating the unused-exports report is the next expansion.

These directions are machine-checked, not review-only: `scripts/check-ratchets.mjs`
(`pnpm lint:ratchets`, part of `pnpm lint`) compares every ratchet against the MERGE BASE
with `origin/main` (in CI always `origin/$GITHUB_BASE_REF`: a positional base ref is
ignored there, a PR whose merge base is HEAD fails, and the job checks out with
`fetch-depth: 0`), never against the PR's own files, and fails on a lowered/removed
coverage threshold (the global metrics and every glob key's metrics, the `100` shorthand
expanded as vitest expands it; a renamed glob counts as removed, since a glob that matches
no file passes vacuously; a new glob only adds, because vitest 4 still holds every file to
the global floors; `perFile` never switched off; a negative count floor never traded for a
percentage below 100), a coverage floor in `vitest.shared.ts` (a package key would override
it unseen), coverage switched off, an inline `test.projects` entry removed, a project's
`include` narrowed or `exclude` grown, the projects list appearing or disappearing, a new
coverage or test `exclude`, a coverage
`include` that appears or a narrowed `include`, a lowered `thresholds.break`, a shrunk
`mutate` list (unless `break` rises in the same diff or the entry's file is gone), any
other changed Stryker option that decides which mutants exist or count (`ignoreStatic`,
`ignorers`, `timeoutMS`, the runner…), a new or raised ESLint debt entry, a raised global
budget, any new complexity/max-lines override or gate rule switched off/to warn, a new
ESLint ignore (keyed by the block it exempts from) or knip ignore/exclude/`entry`, a knip
`include`/`project`, a grown tools/list char budget, a gate dropped from the root
`lint`/`test` chain or a chain gaining anything but a plain `pnpm <script>`, and ANY change
to a gate command: the chained root scripts plus `build`/`typecheck`/`format:check`/
`test:pg`/`test:mutation`, and each package's `lint`/`typecheck`/`test`/`test:mutation`
(only an `--exclude` list may shrink) and the scripts a CI or release job runs by name
(`test:engines`, `test:smoke`, `package`, `marketplace:publish`, `open-vsx:publish`). It
fails closed on what it cannot read: a non-literal `rules`, a spread, a local import or
`Object.entries(…)` in `eslint.config.mjs` is frozen, and so is a spread, shorthand,
accessor, non-literal threshold or computed key in a vitest config. A vitest config the
diff INTRODUCES is not free: it must be readable by the
ratchet, measure (merge sharedConfig or set `coverage.enabled: true`) and carry a non-zero
floor for each of the four metrics; one unreadable on both sides fails. On top of the AST reading `scripts/eslint-effective-config.mjs` asks ESLint
itself for the effective complexity/max-lines/`no-restricted-syntax` settings of every
source file (plus a sample path per glob) under the base and the new config. A shadowing
config fails whenever it exists (any `eslint.config.*` besides the root `.mjs`, a
`knip.json`/`.knip.json(c)`/`knip.{ts,js}`/`knip.config.*` or `package.json#knip` besides
`knip.jsonc`, a `stryker.conf.*`/`.stryker.*` besides `stryker.config.json`, a
`vitest.config.*` besides a package's `vitest.config.ts`, any prettier config besides the
root `.prettierrc.json` and any `.editorconfig` besides the root one, in every directory of
the repo (`docs/` and `templates/` as much as `apps/` and `packages/`), a `prettier` key in
any workspace `package.json`), because each tool would load it INSTEAD of the ratcheted file
(prettier takes the NEAREST config, so per-directory style goes into the root `overrides`);
deleting `knip.jsonc` fails too. Inline
suppressions are shrink-only: an `eslint-disable` naming complexity, max-lines or
`no-restricted-syntax` (or no rule), inline gate-rule config, `v8|c8|istanbul ignore` or
`Stryker disable` in `apps/`/`packages/` sources. The working tree is the new side, so
uncommitted loosening fails locally too. The single escape is a commit trailer
`Ratchet-Exception: <reason>` in the branch range; it turns the failures into loud
warnings for the reviewer; never weaken the checker instead.
