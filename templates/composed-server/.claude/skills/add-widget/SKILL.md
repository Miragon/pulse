---
name: add-widget
description: Step-by-step house pattern for adding an interactive widget to a module (the React component built from the widget-shell kit, the `show_*` widget tool, the app-only `*_data` feed, and the three-link registration chain). Use whenever adding or changing widgets, `show_*` tools, `*_data` feeds, in-widget data fetching, or when debugging a widget that renders empty, unstyled, or hangs on "Loading…".
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-widget: an interactive widget in your module

**Reference implementation: the notes widget.** `modules/mcp-notes/src/widgets/notes-list.tsx`
(component), `widgets/index.ts` (component map), `widget-tools.ts` (show tool
and data feed), `tool-names.ts` (rename safety). Richer patterns (paged lists,
KPI grids, BPMN viewers, settings cards) live in
`node_modules/@miragon/pulse-{camunda7,analytics}-connector/src/widgets/`.

## Step 0: pick the render path

| You need…                                | Path                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| JSON data for the model                  | Plain registrar tool in `src/tools.ts`; no widget, stop here |
| A widget rendered for the user + summary | `<module>_show_<thing>` widget tool in `src/widget-tools.ts` |
| App-only JSON for in-widget refresh/nav  | `<module>_<thing>_data` feed in `src/widget-tools.ts`        |

A widget almost always means **both** widget-path tools: the `show_*` tool
renders it, the `*_data` feed powers its self-fetch. The `_show_`/`_data`
**naming is load-bearing**: `server/test/widget-contract.e2e.test.ts` asserts
the widget `_meta` contract by name across all composed modules.

## Step 1: the component

Widgets live in `src/widgets/` and receive their payload as a `data` prop.
Compose them from the shared kit `@miragon/pulse-widget-shell/widgets` and the
toolkit `@miragon/mcp-toolkit-ui`, never re-inline their primitives. The
toolkit's own components, tone maps and `cn` come from the toolkit itself; the
kit neither forks nor re-exports them:

- `WidgetShell` (container) and `Section` from the kit; `WidgetHeader`
  (title/sub/badge, no icon tile, `as` for the heading level) from the toolkit
- Tables: `ListTable` (the frame: a named, keyboard-reachable scroll region so
  a wide table never widens the view; `hideBelow` on a column a narrow view
  can do without; `sticky` on the last column, the row actions; `sort` on the
  column the rows are ordered by; `groups` to head adjacent columns) with
  hand-composed `<tr>` + `Td` rows; `IdCell` for an id column (Geist Mono,
  shortened, a copy button); `TableEmptyState` instead of an empty frame
  (`variant="done"` for "nothing left to do"); KPI strips: the toolkit's
  `KpiGrid`
- Self-fetch fallback: `QueryFallback` + `TableSkeleton`. A missing `isError`
  branch means an eternal skeleton. Its `onRetry` is required, and the error
  speaks for itself: the kit's `describeError` turns an engine or transport
  failure into what happened and what you can do, the raw text under
  "Details"; `errorTitle` heads only a failure it cannot classify
- Writes: confirm with the toast (`useActionFeedback().succeeded/failed`,
  naming the object), ask first with the kit's `ConfirmDialog` (verb + object
  on both buttons)
- Formatting: `formatTimestamp`/`formatDate`/`formatTime` for dates,
  `formatNumber`/`formatPercent`/`formatPercentPoints`/`formatPeriod`/
  `formatDuration`/`truncate` for the rest, all in the view's locale; no
  local helpers, no `Intl.DateTimeFormat`/`toLocaleDateString`/`toFixed` in
  widget code
- Status: a tone (`danger`/`warning`/`success`/`info`/`neutral`) via the
  toolkit's `StatusBadge`/`CountPill`/`KpiCell.tone` or its `TONE_*` maps, next to
  readable words; colours come from the role variables (override them in
  `server/src/ui/brand.css`, light and dark, to brand), never palette
  classes or raw colours in widgets
- Icons: Lucide through the kit's `Icon` (add `lucide-react` to the module's
  dependencies at the exact version `server/package.json` pins), never Unicode
  glyphs or emoji
- Long paged lists: `usePagedListView` + `ListTable` inside `PagedRows` + the
  toolkit's `PagedListFooter` (the feed must accept `firstResult`/`maxResults` and return
  an honest total). A new search keeps the previous rows on screen
  (`paged.stale`): read counts and filters from the payload shown, not from
  the request

Self-fetch rule (see `NotesListWidget`): fetch via `useToolQuery` against the
**`*_data` feed, never the `show_*` tool** (the host would render its result as
a second widget instead of returning JSON), with `{ enabled: !initialData }` so
a render through the show tool doesn't double-fetch. Import the tool name from
`src/tool-names.ts`.

## Step 2: the three-link registration chain

Every widget appears in three places. **Miss one and it is silently absent**
(no build error):

1. The show tool names the widget by id:
   `buildSingleWidgetView({ widget: "<module>:<widget>", … })` in
   `src/widget-tools.ts` (Step 3). Write the id as a **string literal**: the
   server's guard test reads it from your module's sources.
2. `src/widgets/index.ts`, the component map:
   `"<module>:<widget>": adaptDataWidget(Widget, "<module>:<dataType>", describeForModel)`,
   keyed by that same id. The `describeForModel` callback is the model's
   context line ("what is the user looking at"); always provide it.
3. `server/src/ui/widget-registry.ts`: your module's map must be spread into
   the host bundle map. `server/test/widget-registry.test.ts` reads every
   `widget: "<module>:<id>"` from the sources of the modules the server
   depends on and fails naming an id the registry cannot render, so a missing
   spread and a key that differs from the show tool's id both fail there.

Next to the chain, `src/tool-names.ts` holds a constant for every
`show_*`/`*_data` tool referenced from widget code, so a rename trips TS at
every call site.

Tailwind coverage comes for free for workspace modules: the
`modules/*/src` glob in `server/src/ui/globals.css` scans them all. Only a
module installed from npm needs its own `@source` entry there (missing means
silently unstyled).

## Step 3: the widget tools (`src/widget-tools.ts`)

This file is the documented exception that calls `server.tool()` directly.
Model both tools on `modules/mcp-notes/src/widget-tools.ts`:

- **`show_*` tool**: spread `...showToolBinding(name, title)` (from
  `@miragon/pulse-widget-shell/server`). It binds the mcp-use view, the
  passthrough `outputSchema`, and the Apps-SDK `_meta` half. **Never hand-write
  `_meta.ui.*` keys**; mcp-use owns and overwrites that namespace. Return
  `buildSingleWidgetView({ widget, app, dataType, data, title, summary })`:
  `summary` is the model-facing channel (1–2 sentences, key figures, pointer to
  the plain tool for raw data); the full payload travels only in
  `structuredContent`.
- **`*_data` feed**: spread `...appOnly` (native `visibility: "app"` +
  `openai/widgetAccessible`, **no** view binding) and return
  `buildDataFeedResult(data)`, so the in-widget `callTool()` gets JSON back
  instead of the host rendering a new widget.
- Wrap every handler in `withToolErrors` (all from
  `@miragon/pulse-widget-shell/server`).
- Share the input shape between the pair (one `const <thing>InputShape`), so
  the widget can re-issue the show tool's arguments against the feed, and
  declare it as `inputSchema: strictToolInput(<thing>InputShape)`, never a bare
  `z.object`, which silently drops an unknown key instead of refusing it.
- Register both inside your plugin's `register(server)` (through
  `registerWidgetTools` in the notes module): the boot applies the server-wide
  view CSP to every view-bound tool and refuses a tool name another plugin
  already registered.
- A widget-path tool that performs a **durable write** must honor the module's
  toolset itself (the registrar's filter never sees it): gate it on the
  module's `toolsets` vocabulary, where a missing toolset is the read-only
  floor (the no-suffix default without `MCP_OAUTH`), never "everything"; see
  the add-settings-section skill and
  `node_modules/@miragon/pulse-analytics-connector/src/settings-tools.ts`.

## Step 4: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

- `pnpm typecheck` is the **only** automated check that type-checks widget
  `.tsx` code. Never skip it.
- `pnpm test` runs the registry guard (every id a show tool names renders)
  plus the wire-contract e2e (naming, `_meta`, app-only visibility). If one
  fails it names exactly the missing link: fix the link, never the test.

Then a render check (widget rendering is not covered by any automated test).
Headless, with `pnpm dev` running, from `server/` (needs a local Chrome):

```bash
pnpm exec mcp-use client connect local http://localhost:8400/mcp  # once
pnpm exec mcp-use client local tools call <module>_show_<thing>   # wire: _meta.ui.resourceUri + structuredContent
pnpm exec mcp-use screenshot --mcp http://localhost:8400/mcp \
  --tool <module>_show_<thing> --output /tmp/widget.png --json
```

A styled widget in the PNG proves the bundle, the registry links, and the
Tailwind scan in one shot. In the inspector
(`http://localhost:8400/mcp/inspector`, the human/no-Chrome path), also
exercise the widget's self-fetch (e.g. change a filter) so the `*_data` path
runs too. The widget bundle is read once at boot, and the root `pnpm dev`
rebuilds modules + bundle on every start: restart `pnpm dev` at the repo
root to see changes.

## Troubleshooting

| Symptom                              | Cause                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widget renders as an empty slot      | the module's map is not spread in `server/src/ui/widget-registry.ts`, or its key differs from the show tool's id (the guard test names the id)                                |
| Widget renders unstyled              | widget sources outside the Tailwind scan set: workspace modules are globbed (`modules/*/src`); an npm-installed module needs its own `@source` in `server/src/ui/globals.css` |
| Hangs on "Loading…" forever          | `resolve.dedupe` trimmed in `server/vite.config.ts` (duplicate React contexts), or a missing `isError` branch in the fallback                                                 |
| Self-fetch renders a second widget   | the widget calls the `show_*` tool instead of the `*_data` feed                                                                                                               |
| e2e test fails on `_meta`/visibility | tool name breaks the `_show_`/`_data` convention, or a hand-written `_meta.ui` key: use the helpers                                                                           |
| Boot fails on a duplicate tool name  | two plugins register the same name; the error names both modules, rename one (keep the `<module>_` prefix)                                                                    |
| Old UI after an edit                 | bundle is read once at boot: restart `pnpm dev` at the repo root (it rebuilds modules + bundle on start)                                                                      |
