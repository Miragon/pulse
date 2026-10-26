# @miragon/pulse-widget-shell

[![npm](https://img.shields.io/npm/v/@miragon/pulse-widget-shell?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-widget-shell)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

The base for your own Pulse server: the shared widget kit, the settings page and the server boot
that the Pulse connectors and the [pulse-starter](https://github.com/Miragon/pulse-starter) build on.

## Install

```sh
npm install @miragon/pulse-widget-shell zod bpmn-js@18.31.0 @miragon/mcp-toolkit-core mcp-use@2.7.3
```

The widgets also need `react`, `react-dom`, `@miragon/mcp-toolkit-ui`, `lucide-react` and
`@tanstack/react-query`; the Postgres stores need `postgres`.

To build your own MCP server on it, start from [pulse-starter](https://github.com/Miragon/pulse-starter).

## Overview

Shared widget plumbing for the [Pulse](../../../README.md) MCP App widgets. It is the common base
both widget modules ([`camunda7-connector`](../../connectors/camunda/camunda7-connector), [`analytics-connector`](../../connectors/analytics/analytics-connector)) build on,
so every widget gets the same data-loading, refresh and view-composition behaviour.

Published to the public npm registry as `@miragon/pulse-widget-shell`, the foundation
package customers build their own connectors and composed servers on (see the
`composed-server` template).

## What it provides

- **`adaptDataWidget`** (`./ui`): wraps a presentational React component into a data-aware widget:
  handles the initial structured-content payload, in-widget `callTool()` refresh via the `*_data`
  feeds, and loading / error states. This is what keeps widgets rename-safe and refreshable.
- **View builders** (`./server`): `buildSingleWidgetView`, `buildComposedView` and
  `buildDataFeedResult` (the single implementation of the app-only `*_data` feed result), the
  server-side helpers that assemble a widget tool's result: a summary for the model plus the
  `structuredContent` layout its view renders. The view itself is declared on the tool by
  `showToolBinding` (a `view` binding; mcp-use derives the `_meta.ui` keys from it).
- **BPMN names** (`./server`): `readBpmnNames` / `parseBpmnNames`: the one rule every module
  reads a model's names by, without a DOM (a process's own name, else its Modeler pool's;
  character references such as `&#10;` and `&#38;` decoded, space folded), so two modules never
  name the same process or activity differently.
- **The `shell:*` catalogue** (`./server`): `shellDefinition` + `createShellPlugin` register the
  always-on generic `shell:kpi-grid` / `shell:data-table` widgets, the standard
  `render-view`/builder composition targets fed via `props.dataKey`, and the settings page.
  `createShellPlugin({ profileStore, allowSave })` adds the settings triple: `shell_show_settings`
  (the page: the language section, then every `<module>:settings` section the host bundles),
  `shell_settings_data` (what `ProfileGate` reads the language from) and `shell_save_settings`
  (pass `allowSave: frameworkWritesAllowed(boot)`). Hosts spread `shellWidgets` (`./widgets`)
  into their registry. Apps own no domain UI, so the catalogue lives here.
- **Shared UI primitives** (`./widgets`): what the kit adds on top of `@miragon/mcp-toolkit-ui`
  (`WidgetShell`, tables, `ListTable` + `PagedRows`, the dual-mode data hooks, formatters,
  hand-offs, the BPMN viewer, `useApplyTheme`, …), reused across both widget packages.
  Inline in a chat a view is a card (#396): `HostDocument`'s measured fit (`InlineFitBox`,
  `useInlineRows`) caps a paged list (`usePagedViewData`) and an unpaged `ListTable` to the
  rows that fit the host's height budget, measured on the rendered view, with the count and
  a way to the rest (fullscreen where the host offers it); the BPMN canvas stays at 320 px,
  long text in `TEXT_BLOCK_FRAME`.
  Layout, states and feedback: `ListTable` scrolls inside a named, keyboard-reachable region
  (column priorities via `hideBelow`, the row actions pinned with `sticky`, the sorted
  column marked with `sort`, heads over adjacent columns with `groups`), `IdCell`/`IdText`
  show an id shortened in Geist Mono with a copy button, `NamedId` shows a process or an
  element by its name with the id quiet in mono below, `countTone`/`severityTone` are the one
  severity ladder for incident and job counts, `describeError` turns an engine or
  transport failure into what happened and what you can do (the toolkit's `ErrorState` in
  `ViewDataState`, `QueryFallback`, `useDetailView`, raw text under "Details", retry
  required), `useActionFeedback` raises the toolkit's toasts after a write (an engine
  refusal's own reason quoted, a write whose answer never came flagged), `ConfirmDialog`
  asks before one, `TableEmptyState` has an `empty` and a `done` variant, `KometMark` /
  `AppEmptyState` carry the Miragon signature on app-level surfaces only (hidden by a brand
  that sets `--brand-mark-display: none`), and the BPMN canvas reads one token module
  (`BPMN_TOKENS`, `BPMN_OVERLAY_CSS`) with its height from the diagram's size at the scale
  bpmn-js draws it (`diagramHeight`, read from the XML's DI before the import). The
  toolkit's own components and helpers (`KpiGrid`, `StatusBadge`/`LivePill`/`CountPill`,
  `FilterBar`, `WidgetHeader`, `PagedListFooter`, `SectionHeading`, the `TONE_*` maps,
  `resolveTone`, `MICRO_LABEL`, `cn`, `useDebouncedValue`, …) are imported from the toolkit:
  the kit neither forks nor re-exports them. Status
  is a tone (the toolkit's `TONE_*` maps over the `--<tone>`, `--<tone>-soft` and `--<tone>-ink` roles: a dot,
  edge or icon next to black text, black text on a tint, never a coloured number), function
  icons are Lucide via `Icon`, and numbers, percentages, periods and durations render in the
  view's locale (`formatNumber`, `formatPercent`, `formatPercentPoints`, `formatPeriod`,
  `formatDuration`).
- **Brand gates** (`./testing`): the checks every widget package runs in its own tests:
  `catalogTextFindings` (the voice rules over a message catalog), `scanTypeScale` (text on the
  type scale's five steps, nothing below 13 px), `scanGlyphs` (no Unicode glyphs,
  emoji, lone symbols or sparkle imports as icons), `scanColors` (role names only: no palette
  classes, retired accents or raw colours, with a reasoned allow list), `stylesheetColorFindings`
  (no raw colour or retired accent variable in a stylesheet's rules) and `contrastFindings` with
  `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS` (WCAG AA of every tone and role pair over
  `toolkitThemeStylesheets()` (the toolkit's Miragon theme as installed) plus your overrides,
  light and dark; `:root` and the dark scopes cascade in source order as on
  `<html class="dark" data-theme="dark">`, so override a role under both). Node only;
  `scanGlyphs` and `scanColors` need `typescript`.
- **Theme:** none of its own. The widgets colour through the role variables of the toolkit's
  Miragon theme (`@miragon/mcp-toolkit-ui/theme.css`: the vendored `--cd-*` corporate-design
  tokens and the roles on top, light and dark). Your stylesheet imports it after `tailwindcss`,
  `@source`s the toolkit's `src` (and this package's `dist`), and overrides ROLE variables only.
  The widgets follow the host's theme (then the OS); there is no theme preference.
- **Module composition** (`./server`): `composeModules` is the composition-root machinery every
  server shares: `MCP_ACTIVE_MODULES` selection with `module:toolset` suffixes, the env-typo warner
  and boot warnings. `resolveBoot(env, { authenticated })` resolves ONE concrete toolset per module
  per boot and threads it into the module's `config.toolset`; pass `authenticated: true` only when
  your server actually installed OAuth. `logEffectiveToolsets(boot)` prints the one boot line that
  states each module's toolset and why, and `frameworkWritesAllowed(boot)` decides whether
  framework writes no module toolset filters (the toolkit's dashboard builder) may be registered:
  only with OAuth and no module on its read-only floor.
- **Toolset vocabularies** (`./server`): a module declares its toolsets as
  `toolsets: createToolsetVocabulary(module, names, floor, { authenticatedDefault })` on its
  definition; a module without one has no toolsets (a suffix is ignored with a warning). The rule
  is fail-closed: no suffix →
  `floor` without OAuth, `authenticatedDefault` (default: `floor`) with it; an empty or unknown
  suffix → `floor` with a warning; `resolve(undefined)` → `floor`. Nothing resolves to
  "everything" (a module's widest toolset is reachable only by naming it), and
  `allowsDurableWrites(toolset)` is true for every toolset above the floor.
- **Server boot** (`./server`): `createComposedServer({ label, info, composition, bundle, setup,
oauth? })` is the one boot sequence every composed server shares: env-typo warnings, the HTTP
  edge policy, ONE `resolveBoot` (authenticated exactly when you pass the OAuth provider you
  install; build it with `oauthFromEnv({ env, label })` from `MCP_OAUTH` and spread
  `OAUTH_ENV_VARS` into your known vars; it is the only caller identity), the boot log, your
  `setup(boot)` (plugins + persistence), `createFrameworkApp` with
  `serverInfo`/`instructions`, request context (request logging is mcp-use's own:
  `MCP_USE_LOG_LEVEL`, warned at boot above `info`), `/metrics` (optional
  `MCP_METRICS_TOKEN`), the Host/Origin guard, `/health/*` and the font route
  (`installFontAssets`: Geist + Geist Mono as woff2 under `/fonts/geist-<version>/`, cached
  immutable, any origin, behind the guard). Every view-bound tool advertises `MCP_URL`'s origin
  in its view CSP `resourceDomains` and the Apps SDK `openai/widgetCSP` (`fontAssetsCsp`, applied
  to every plugin by `honorWidgetMetaDefaults`); without `MCP_URL` mcp-use appends the origin
  the host read the view from. `HostDocument` declares the faces from that origin
  (`declareServedFonts`, `font-display: swap`), so a host that blocks it shows its own font, then
  the system's. `mcp-use dev` serves the returned
  `app`; production calls `listen({ handleSignals: true })`: mcp-use's `toNodeHandler` behind a
  request-body cap (`MCP_MAX_BODY_BYTES`, 413 before buffering), an in-flight body budget of 4×
  the cap (503) and a 30 s request timeout, plus a graceful drain (stop accepting, in-flight
  requests finish, readiness 503 `draining`, then your `runtime.shutdown()`). The guard is
  DNS-rebinding protection: `Host` (and a POST's `Origin`) must be localhost-class, `MCP_URL`'s or
  in `MCP_ALLOWED_HOSTS`/`MCP_ALLOWED_ORIGINS` (spread `HTTP_EDGE_ENV_VARS` into your known vars);
  `/health*` and `/metrics` stay reachable by IP for probes and scrapers.
- **Persistence** (`./server`): the user-profile store (in-memory / filesystem / Postgres) and the
  Postgres `DashboardStore` for the toolkit's saved dashboards, plus the `createSql` client and the
  `runMigrations` runner that applies each store's own `Migration[]` (`PROFILE_STORE_MIGRATIONS`,
  `DASHBOARD_STORE_MIGRATIONS`) under an advisory lock. A composed server picks its backends from
  its own env and injects them; it does not reimplement the stores. `postgres` is an **optional**
  peer dependency: the driver is loaded through a dynamic import inside `createSql`, so servers
  persisting to disk or memory never need it installed.

## Exports

| Subpath     | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `./server`  | `buildSingleWidgetView` / `buildComposedView` / `buildDataFeedResult`, `shellDefinition`/`createShellPlugin`, `createBuilderTexts` (the view builder's en/de names from a module's catalogs), `composeModules` / `frameworkWritesAllowed` / `createToolsetVocabulary`, `createComposedServer` and its edge pieces (incl. `installFontAssets`, `fontAssetsCsp`, `honorWidgetMetaDefaults`), `oauthFromEnv`, caller identity (`resolveProfileKey`), the profile + dashboard stores and the Postgres client/migration runner |
| `./ui`      | `adaptDataWidget`, the data-aware widget wrapper                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `./widgets` | Shared widget UI primitives incl. the generic `shell:*` components and the host app shell (`AppShellProviders`: the language as explicit profile > host context > English, the theme as host context > OS)                                                                                                                                                                                                                                                                                                                |
| `./testing` | The brand gates for your widget package's tests: `catalogTextFindings`, `missingDisplayTexts` + `displayTextCatalog` (every widget, step and top-level props field named for the view builder in en and de) + `displayTextsSentToModel` (none of those names reaches the model), `scanGlyphs`, `scanColors`, `stylesheetColorFindings`, `parseThemeVariables` + `contrastFindings` with `toneContrastPairs()` / `ROLE_CONTRAST_PAIRS` over `toolkitThemeStylesheets()`                                                    |

The `@miragon/mcp-toolkit-*`, `react`/`react-dom`, `zod` and `@tanstack/react-query` deps are
**peer dependencies**: they must resolve to a single instance across the host bundle (see the
`dedupe` array in the server app's `vite.config.ts`), otherwise the React contexts diverge and
in-widget queries hang. They are published as ranges (`react`/`react-dom` `^19.2.0`, `zod`
`^4.4.0`, `@miragon/mcp-toolkit-*` `~2.8.1`, `lucide-react` `^0.562.0 || ^1.0.0`) so they dedupe
against your app's copy; add `lucide-react` to your `dedupe` list too. **A host bundle that dedupes
`lucide-react` needs 1.47.0 or newer** (the version `@miragon/mcp-toolkit-ui` 2.8 depends on): the
toolkit's chrome imports `LucideProvider`, which 0.x does not export, so a deduped 0.x copy fails
the bundle build with a missing export. The peer range still admits 0.562 only for this repo's own
test graph; no package manager warns you about it.

`mcp-use` is the exception: it is an **exactly pinned** peer dependency. Pin it to `mcp-use@2.7.3`
in your app. A duplicate `mcp-use` instance breaks the React context and hangs every in-widget query
on "Loading…".

## Where it fits

```
camunda7-connector / analytics-connector widgets
            │  use
            ▼
   @miragon/pulse-widget-shell   ──  adaptDataWidget · view builders · UI primitives
            │  build on
            ▼
   @miragon/mcp-toolkit-ui (React + react-query)
```

See the architecture invariants in [`CLAUDE.md`](../../../CLAUDE.md) for the four-link widget
registration chain.
