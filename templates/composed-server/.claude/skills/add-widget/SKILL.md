---
name: add-widget
description: Step-by-step house pattern for adding an interactive widget to a module (the React component built from the design kit `@miragon/pulse-ui` and widget-shell's view runtime, the `show_*` widget tool, the app-only `*_data` feed, the view map keyed by the show tool's name, and a widget test under `TestViewHost`). Use whenever adding or changing widgets, `show_*` tools, `*_data` feeds, in-widget data fetching, or when debugging a widget that renders empty, unstyled, or hangs on "Loading…".
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-widget: an interactive widget in your module

**Reference implementation: the notes widget.** `modules/mcp-notes/src/widgets/notes-list.tsx`
(component), `widgets/views.tsx` (the view map), `widgets/notes-list.test.tsx`
(the widget test), `widget-tools.ts` (show tool and data feed), `tool-names.ts`
(rename safety). Richer patterns (paged lists,
KPI grids, BPMN viewers) live in
`server/node_modules/@miragon/pulse-engine-connector/src/widgets/`.
The names below are documented in
`server/node_modules/@miragon/pulse-widget-shell/README.md` (export table) and
`server/node_modules/@miragon/pulse-ui/README.md`, typed in
`server/node_modules/@miragon/pulse-widget-shell/dist/ui/index.d.ts`
(widget-shell's `./widgets`) and
`server/node_modules/@miragon/pulse-ui/dist/index.d.ts`. The package
directories are gitignored symlinks: search one of them, not the repo root.

## Step 0: pick the render path

| You need…                                | Path                                                         |
| ---------------------------------------- | ------------------------------------------------------------ |
| JSON data for the model                  | Plain registrar tool in `src/tools.ts`; no widget, stop here |
| A widget rendered for the user + summary | `<module>_show_<thing>` widget tool in `src/widget-tools.ts` |
| App-only JSON for in-widget refresh/nav  | `<module>_<thing>_data` feed in `src/widget-tools.ts`        |
| A view that must stay outside the bundle | "A finished HTML view" below, instead of Steps 1 and 2       |

A widget almost always means **both** widget-path tools: the `show_*` tool
renders it, the `*_data` feed is what it re-reads (a retry, an invalidation
after a write) and fetches when it is mounted without data. The `_show_`/`_data`
**naming is load-bearing**: `server/test/widget-contract.e2e.test.ts` asserts
the widget `_meta` contract by name across all composed modules.

## Step 1: the component

Widgets live in `src/widgets/` and receive their payload as a `data` prop.
Compose them from the design kit `@miragon/pulse-ui` and the view runtime
`@miragon/pulse-widget-shell/widgets`, never re-inline their primitives. The
kit holds everything that touches no host (primitives, components, tone
maps, `cn`, the formatters, `Icon`, the table cells); the view runtime holds
what reads the host or calls a tool. Neither re-exports the other's names:

- `WidgetShell` (container) from the view runtime; `WidgetHeader`
  (title/sub/badge, no icon tile, `as` for the heading level) and `Section`
  from the kit
- Tables: the view runtime's `ListTable` (the frame, over the kit's
  `DataTable`: a named, keyboard-reachable scroll region with a sticky head
  and 28 px rows, so a wide table never widens the view;
  `hideBelow` on a column a narrow view can do without; `sticky` on the last
  column, the row actions; `sort` on the column the rows are ordered by;
  `groups` to head adjacent columns) with hand-composed `<tr>` + the kit's
  `Td` rows; `IdCell` (view runtime) for an id column (Geist Mono, shortened,
  a copy button); the kit's `TableEmptyState` instead of an empty frame
  (`variant="done"` for "nothing left to do"); KPI strips: the kit's
  `KpiGrid`
- No data yet (a widget mounted without the show tool's data): the view
  runtime's `QueryFallback` + `TableSkeleton`. A missing `isError` branch
  means an eternal skeleton. Its `onRetry` is required, and the error speaks
  for itself: `describeError` turns an engine or transport failure into what
  happened and what you can do, the raw text under "Details"; `errorTitle`
  heads only a failure it cannot classify
- Writes: confirm with the toast (`useActionFeedback().succeeded/failed`,
  naming the object), ask first with `ConfirmDialog` (verb + object on both
  buttons), both from the view runtime
- Formatting, from the kit: `formatTimestamp`/`formatDate`/`formatTime` for
  dates, `formatNumber`/`formatPercent`/`formatPercentPoints`/`formatPeriod`/
  `formatDuration`/`truncate` for the rest, all in the view's locale; no
  local helpers, no `Intl.DateTimeFormat`/`toLocaleDateString`/`toFixed` in
  widget code
- Status: a tone (`danger`/`warning`/`success`/`info`/`neutral`) via the
  kit's `StatusBadge`/`CountPill`/`KpiCell.tone` or its `TONE_*` maps, next
  to readable words; colours come from the role variables (override them in
  `server/src/ui/brand.css`, light and dark, to brand), never palette
  classes or raw colours in widgets
- Icons: Lucide through the kit's `Icon` (add `lucide-react` to the module's
  dependencies at the exact version `server/package.json` pins), never Unicode
  glyphs or emoji
- Long paged lists: the view runtime's `usePagedListView` + `ListTable` inside
  `PagedRows` + the kit's `PagedListFooter` (the feed must accept
  `firstResult`/`maxResults` and return an honest total). A new search keeps
  the previous rows on screen (`paged.stale`): read counts and filters from
  the payload shown, not from the request

Data rule (see `NotesListWidget`): read through the view runtime's
`useViewData(data, key, FEED, args, ready)` against the **`*_data` feed, never
the `show_*` tool** (the host would render its result as a second view instead
of returning JSON). The show tool's data SEEDS the feed's cache entry, so a
render never double-fetches, while a retry or a write's invalidation of `key`
re-reads the feed; mounted without data, the widget fetches it. Build `args`
from the data on screen (the notes view carries its `query`), so a re-read
asks for what the view shows. Import the tool name from `src/tool-names.ts`.

Widgets reach the host only through the view runtime: `useViewHost()` (`callTool`,
`sendFollowUp`, `openExternal`), `HostModelContext` and the query hooks
(`useViewData`, `useToolQuery`, `useToolMutation`, `useQueryClient`). Never
import `@modelcontextprotocol/ext-apps` in a widget: only widget-shell's host
adapter under the bundle root (`mountViews`) talks to the host, and the seam is
what lets a test render the widget without a host (Step 4).

## Step 2: the three links

Every view appears in three places. **Miss one and it is silently absent**
(no build error):

1. The show tool returns its view's data: `buildViewResult(data, summary)` in
   `src/widget-tools.ts` (Step 3). Its NAME is the view's name.
2. `src/widgets/views.tsx`, the module's view map (re-exported by
   `src/widgets/index.ts`): `[MY_SHOW_TOOL]: MyView`, keyed by the show tool's
   name, where `MyView({ data })` renders the widget inside
   `<HostModelContext content={describeMy(data)}>`. The description is the
   model's context line ("what is the user looking at"); always provide it.
3. `server/src/ui/view-registry.ts`: your module's view map must be spread
   into `viewRegistry`. `server/test/view-registry.test.ts` boots the real
   composition and fails naming a view-bound tool without a view, so a missing
   spread and a key that differs from the show tool's name both fail there.

Next to the chain, `src/tool-names.ts` holds a constant for every
`show_*`/`*_data` tool referenced from widget code, so a rename trips TS at
every call site.

Tailwind coverage comes for free for workspace modules: the
`modules/*/src` glob in `server/src/ui/globals.css` scans them all. Only a
module installed from npm needs its own `@source` entry there (missing means
silently unstyled).

## Step 3: the widget tools (`src/widget-tools.ts`)

This file is the documented exception that calls the official SDK's
`server.registerTool(name, config, handler)` directly (`server` is the
`ModuleServer` your plugin's `register(server)` gets; ext-apps'
`registerAppTool` works on it too, with the same
`...showToolBinding(name, title)` spread into its config, which then adds
nothing). Model both tools on `modules/mcp-notes/src/widget-tools.ts`:

- **`show_*` tool**: annotate it `{ readOnlyHint: true, idempotentHint: true }`
  (why: the last bullet). Spread
  `...showToolBinding(name, title)` (from
  `@miragon/pulse-widget-shell/server`) into its config. It binds the view
  named after the tool (`_meta.ui.resourceUri`, a resource the boot serves),
  the passthrough `outputSchema`, and the Apps-SDK `_meta` half. **Never
  hand-write `_meta` keys.** Return
  `buildViewResult(data, summary)`: the `structuredContent` IS the view's
  data (no title: the widget's heading names the view), and `summary` is the
  model-facing channel (1–2 sentences, key figures, pointer to the plain tool
  for raw data).
- **`*_data` feed**: spread `...appOnly` (`_meta.ui.visibility: ["app"]` +
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
  view CSP to every bundle view and refuses a tool name another plugin
  already registered.
- A widget-path tool never writes, and the `show_*` tool states
  `readOnlyHint: true`. On a host that strips `structuredContent`
  (claude.ai) the view re-runs its show tool once by itself, without asking,
  so a write there would run twice; and the registrar's toolset filter never
  sees a widget-path tool. A write is a registrar tool (the `create-module`
  skill, Step 5), which the filter drops outside its toolset.
  `server/test/view-registry.test.ts` fails on a view-bound tool that is not
  a read.

## Step 4: verify

```bash
pnpm build && pnpm typecheck && pnpm test
```

- `pnpm typecheck` is the **only** automated check that type-checks widget
  `.tsx` code. Never skip it.
- `pnpm test` runs the view-registry guard (every view-bound tool is a read,
  a bundle view's tool has a view under its name, and every view has a tool) plus the
  wire-contract e2e (naming, `_meta`, app-only visibility). If one fails its
  message names the missing link: fix the link, not the guard. The one test
  that names the example, `server/test/example-notes.test.ts`, goes with the
  example module (the `create-module` skill, "Remove the example module").
- Write a widget test next to the widget, as
  `modules/mcp-notes/src/widgets/notes-list.test.tsx` does: `// @vitest-environment
happy-dom`, then render the view or widget under `TestViewHost` from
  `@miragon/pulse-widget-shell/widgets` with fake `tools`, and assert what it
  shows, what it asked the host (`onHostAction`: tool calls, follow-ups,
  links) and what it told the model (`onModelContext`). No server, no host,
  no view runtime. Numbers and dates render in the test host's `locale`
  (English without one) and its `host.timeZone`, as the view root renders
  them in the host's, so the test reads the same on every machine.

Then a render check of the real bundle (the widget test renders the component,
not the built bundle in a host). `pnpm dev` starts the official MCP Inspector
next to the server; open the URL it prints, then render `<module>_show_<thing>`
in its Apps tab. A styled widget proves the bundle, the registry links, and
the Tailwind scan in one shot; also exercise the widget's feed (a retry, or a
write that invalidates it) so the `*_data` path runs too. The inspector has no
chat, so a hand-off does nothing there; a real host behind a tunnel shows it
(the `setup-server` skill, Step 6). Headless, with `pnpm dev` running, the
inspector's CLI checks the wire from `server/`:

```bash
pnpm exec mcp-inspector --cli --server-url http://127.0.0.1:8400/mcp --transport http \
  --method tools/call --tool-name <module>_show_<thing> --app-info      # the view: resourceUri, csp
pnpm exec mcp-inspector --cli --server-url http://127.0.0.1:8400/mcp --transport http \
  --method tools/call --tool-name <module>_show_<thing> --format json   # its structuredContent
```

A widget edit rebuilds the bundle and restarts the server by itself; reopen
the view to see it. A module's tools are built once, when `pnpm dev` starts:
restart `pnpm dev` at the repo root after changing them.

## A finished HTML view

A widget in the bundle is the default: it shares the kit and the host contexts,
and every other module's view looks like it. A module may instead bring one
finished HTML document as a resource of its own, when the view comes from
another toolchain or the module ships on npm without widget sources. Nothing of
it enters the Vite build, the view map or `view-registry.ts`. It costs you:

- **No shared bundle code.** The document carries its own React and styles, or
  none, and every render pays for them.
- **No host contexts from widget-shell**: no `useViewHost`, query hooks,
  `LocaleGate` or theme. The document runs the MCP Apps handshake itself (ext-apps'
  `App`, https://apps.extensions.modelcontextprotocol.io/api/), reads theme and
  locale from the host context and calls its feeds through the host. A feed's
  `buildDataFeedResult` answers one text block of JSON, no `structuredContent`,
  so the document parses `content[0].text` itself. It also has
  no recovery for a host that strips `structuredContent`: on such a host it gets
  no data unless it fetches it from a feed itself.
- **The CSP is yours.** The boot adds nothing: not the server's origin, not the
  fonts. The document loads its own, and `_meta.ui.csp` admits every origin it
  needs. The same goes for what a bundle view's resource tells Apps SDK hosts,
  `openai/widgetDescription` and `openai/ui`: state them in your resource's
  `_meta` if a host should read them.
- **Its size is yours.** The bundle has a budget, a document none: a read sends
  it whole and holds about four times its size in the server's memory (256 MB
  grew the process by 1 GB).

```ts
import { readFileSync } from "node:fs"
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import {
  buildViewResult,
  showToolBinding,
  strictToolInput,
  type AppResourceCsp,
  type ModuleServer,
} from "@miragon/pulse-widget-shell/server"

const BOARD_URI = "ui://board/board.html" // your own: ui://views/ is the boot's
const CSP: AppResourceCsp = { connectDomains: ["https://api.example.com"] }
const BOARD_HTML = readFileSync(new URL("./board.html", import.meta.url), "utf8")

export function register(server: ModuleServer): void {
  registerAppTool(
    server,
    "board_show_board",
    {
      title: "Board",
      annotations: { readOnlyHint: true },
      inputSchema: strictToolInput({}),
      ...showToolBinding("board_show_board", "Board", { resourceUri: BOARD_URI, csp: CSP }),
    },
    () => buildViewResult({ cards: [] }, "No cards."),
  )
  registerAppResource(server, "Board", BOARD_URI, {}, () => ({
    contents: [
      {
        uri: BOARD_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: BOARD_HTML,
        _meta: { ui: { csp: CSP } },
      },
    ],
  }))
}
```

`tsc` copies no HTML and the example reads `board.html` on import, so without the
file next to the compiled code the server does not start, even with the module
off: build with `"build": "tsc && cp src/board.html dist/"`. To publish the module,
its `package.json` says `"files": ["dist"]` and drops the `"private": true` of the
copied notes module.

`server.registerTool` and `server.registerResource` work just the same; the two
ext-apps helpers add only the flat `ui/resourceUri` and the MIME type. A module
that imports them declares ext-apps as a ranged peer (`CLAUDE.md`, rule 5), and a
server that installs it from npm pins it in `dependencies` of
`server/package.json`: `"@modelcontextprotocol/ext-apps"` at the version
`server/node_modules/@miragon/pulse-widget-shell/package.json` lists.
`server/test/pins.test.ts` holds a pin you set and misses one you did not. The
`_show_` and `_data` naming holds as ever:
`server/test/widget-contract.e2e.test.ts` also asks every view tool for both
`_meta` halves, so spread `showToolBinding` here too, with `registerAppTool` as
well.

The boot checks the rest. A URI or resource name two registrations share fails
naming both modules, so does a URI under `ui://views/`, which it serves from the
bundle, or a template that could reach it (spell out its scheme, and a `ui:`
template's host), and so does a tool whose URI no module registers, is no `ui://`
URI or is a template's text. A read or prompt callback that returns no `contents`
or `messages` array, or throws no `Error`, gets an error naming the module. A
thrown error's message reaches the client, as a tool's does, so keep secrets out
of it; its stack goes to the log, the rest of it nowhere, and a `ProtocolError`
goes out as thrown. A template's `list` callback that fails or takes over 5 s
costs only its own entries in `resources/list`. A module's test reads
the document with `recordingModuleServer().resource(uri).read()`. Render it in the
inspector's Apps tab as any other view, and check it on `--app-info` (Step 4).

## Troubleshooting

| Symptom                                                 | Cause                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boot fails: "binds …, which this server does not serve" | the tool's `_meta` names a URI no module registers: bind `ui://views/<tool>.html` with `showToolBinding(name, title)`, or register that resource (a finished HTML view)       |
| Boot fails: "binds …, which no host would render"       | the tool's `_meta` names a URI that is no `ui://` URI or a template's text: bind one document, and keep a resource of another scheme for data                                 |
| "Can't show this view"                                  | the module's view map is not spread in `server/src/ui/view-registry.ts`, or its key differs from the show tool's name (the guard test names the tool)                         |
| Widget renders unstyled                                 | widget sources outside the Tailwind scan set: workspace modules are globbed (`modules/*/src`); an npm-installed module needs its own `@source` in `server/src/ui/globals.css` |
| Hangs on "Loading…" forever                             | `resolve.dedupe` in `server/vite.config.ts` trimmed or no longer spreading `VIEW_BUNDLE_DEDUPE` (duplicate React contexts), or a missing `isError` branch in the fallback     |
| A refresh renders a second view                         | the widget calls the `show_*` tool instead of the `*_data` feed                                                                                                               |
| e2e test fails on `_meta`/visibility                    | tool name breaks the `_show_`/`_data` convention, or a hand-written `_meta.ui` key: use the helpers                                                                           |
| The show tool is not in the tool list                   | its module is not named in `MCP_ACTIVE_MODULES` in `.env` (a module the list does not name stays off; the boot log's `Toolsets:` line shows what runs)                        |
| Boot fails on a duplicate tool name                     | two plugins register the same name; the error names both modules, rename one (keep the `<module>_` prefix)                                                                    |
| Old UI or tool text after an edit                       | the view still shows the old bundle: reopen it; a tool's text or handler is built once, when `pnpm dev` starts: restart it at the repo root (it rebuilds the modules)         |
