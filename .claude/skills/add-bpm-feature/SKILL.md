---
name: add-bpm-feature
description: Step-by-step house pattern for adding a new BPM operations tool, widget tool, or widget to the camunda7 module (`packages/connectors/camunda/camunda7-connector` + `packages/connectors/camunda/camunda7-client`). Use whenever adding or changing Camunda 7 / CIB Seven tools ("add a tool to suspend jobs", "expose X from the engine REST API"), input schemas, `show_*` widget tools, `*_data` feeds, or React widgets in the cockpit. Takes precedence over generic mcp-use examples.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-bpm-feature — new tool/widget in the camunda7 module

The camunda7 module never registers operations tools with raw `server.tool()`. Tools go
through the registrar (`createToolRegistrar` from `@miragon/pulse-widget-shell/server`);
engine access goes through `withEngine`/`resolveEngine` (per-call `engine` override >
`CAMUNDA_DEFAULT_ENGINE` > the only configured engine). A view is registered in three places (CLAUDE.md
invariant 3). Follow the steps for the path you need.

## Step 0 — pick the render path

| You need…                                | Path                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| JSON data for the model                  | Registrar tool in `src/tools/<domain>.ts` (Steps 1–3)                    |
| A widget rendered for the user + summary | `show_*` widget tool in `src/widget-tools/<area>.ts` (Step 4)            |
| App-only JSON for in-widget refresh/nav  | `*_data` feed in `src/widget-tools/data-feeds.ts`, `...appOnly` (Step 4) |

## Step 1 — input schema in camunda7-client

Add the Zod input schema to `packages/connectors/camunda/camunda7-client/src/schemas/<domain>.ts` and export
it from `src/schemas/index.ts`. Existing style (from `schemas/process-instances.ts`):

```ts
export const listProcessInstancesInput = z.object({
  processDefinitionKey: z.string().optional().describe("Filter by process definition key"),
  businessKeyLike: likeParam("Filter by business key"),
  active: flagParam("true = only active instances, false = only suspended"),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(), // capped at MAX_PAGE_SIZE (100); default page 20
  sortBy: z.enum(["instanceId", "definitionKey"]).optional().describe("Sort field"),
  sortOrder: sortOrderParam,
})
```

Every field gets a `.describe()`. A list/query tool pages with the shared params from
`schemas/shared.ts` — `firstResultParam` + `maxResultsParam(defaultPageSize)` — never a
hand-rolled `maxResults`: `src/tools/list-tools.test.ts` treats every registrar tool that
takes `maxResults` as a list and fails it without the cap or the envelope (Step 2). The
REST calls themselves use the generated SDK (imported from
`@miragon/pulse-camunda7-client/sdk`) — if the endpoint is missing there, the OpenAPI spec
changed and you need `pnpm generate`, not a hand-written fetch.

### Parameter naming guide

Inputs are STRICT (the registrar is always strict; raw `server.tool()` registrations use
`strictToolInput(...)` from `@miragon/pulse-widget-shell/server`): an unknown key is a tool
error listing the valid keys. So one name per concept across every tool: a model that learned
`assignee` on one tool must not be refused it on the next. Renames ship without aliases.

| Concept                  | Name                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process definition       | `processDefinitionKey` (all versions), `processDefinitionId` (one version); never bare `key`                                                        |
| Entity ids               | `<entity>Id` — `processInstanceId`, `deploymentId`, `jobId`, `activityId` (analytics too); never bare `id`, never `elementId`                       |
| Several values           | `<name>In`, an array (`processDefinitionKeyIn`); merged with the single form via `engineKeyList`                                                    |
| User filter              | `assignee` (the user a task is assigned to); a write that sets a user takes `userId`                                                                |
| Business key / substring | `businessKey` exact, `businessKeyLike`/`nameLike` substring — `engineLike` wraps a `%`-less value                                                   |
| Time bounds              | `<event>After`/`<event>Before` (`startedAfter`, `finishedBefore`, `incidentTimestampAfter`) via `engineDateParam` — ISO 8601 in, `toEngineDate` out |
| Boolean filters          | `flagParam` + `complementaryFlags` (active/suspended, …) or `trueOnly` — the engine IGNORES `false` (never sent); a both/neither pair is refused    |
| Paging / result size     | `firstResult` + `maxResults` from `firstResultParam` + `maxResultsParam` (above; also for a top-N cap: never `limit`)                               |
| Sorting                  | `sortBy` + `sortOrder`, sent as a pair by `engineSorting`                                                                                           |

The engine's own query names may differ (`taskAssignee`, `processInstanceBusinessKey`,
`withIncident`): the handler maps them, the schema keeps the guide's name. Every
filter a tool advertises is pinned on the wire in `src/tools/filters.wire.test.ts`
(page query AND `/count`); a retired spelling (`key`, `id`, `limit`, `elementId`, …) on
any module tool fails `apps/mcp-server-camunda7/test/strict-input.e2e.test.ts`; a tool
description, server-instructions text or server prompt that quotes a tool's parameter is
checked against its schema by `apps/mcp-server-camunda7/test/tool-name-refs.test.ts` —
write quoted arguments in call notation with literal names, `tool({ param: value })` (an
interpolated name is reported as `${…}`). Widget Ask-AI hand-offs and model contexts
never quote parameters: they pass typed `ids` (see Step 4).

## Step 2 — register the tool

Add the tool in `packages/connectors/camunda/camunda7-connector/src/tools/<domain>.ts`. Reference template —
`camunda7_list_process_instances` from `src/tools/process-instances.ts`:

```ts
import { listProcessInstancesInput } from "@miragon/pulse-camunda7-client/schemas"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { complementaryFlags, engineLike, engineSorting } from "@miragon/pulse-camunda7-client"
import { getProcessInstances, getProcessInstancesCount } from "@miragon/pulse-camunda7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

export function registerProcessInstanceTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "camunda7_list_process_instances",
    category: "process-instances",
    description:
      "List running process instances with optional filters. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listProcessInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      // The filters in the engine's format (naming guide), shared by the page
      // and its /count twin — fetched in parallel, so the envelope's total is honest.
      const filters = {
        processDefinitionKey: args.processDefinitionKey,
        businessKeyLike: engineLike(args.businessKeyLike),
        ...complementaryFlags(args, "active", "suspended"),
      }
      const [items, count] = await Promise.all([
        getProcessInstances({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getProcessInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })
}
```

Non-negotiables:

- Every tool carries a `category` matching its domain file name (e.g.
  `"process-instances"`, `"tasks"` — `task-form.ts` uses `"tasks"`,
  `incident-issue.ts` uses `"incidents"`).
- `inputSchema` spreads `...engineParamShape` so every tool accepts the per-call
  `engine` override.
- `handler` is wrapped in `withEngine(...)` — never construct, cache, or import a client
  directly; `withEngine` resolves the engine from the registry per call.
- Tool names are `camunda7_<verb>_<noun>` in snake_case.
- Write tools that only flip state return a small `{ success: true, … }` object instead
  of the raw (often empty) REST response.
- Destructive/admin-grade tools (delete, modify, suspension, deployments, migrations,
  batches, engine-wide broadcasts like signals, the external-task worker protocol) must
  be added to `ADMIN_ONLY_TOOLS` in `src/lib/toolsets.ts` so the
  `camunda7:read-only|operations|admin` toolset filtering stays correct — `read-only`
  membership is derived from `readOnlyHint: true`. `src/lib/toolsets.test.ts` enforces
  the rule structurally over every registered tool (`destructiveHint` ⇒ admin-only,
  read-only ⇒ `readOnlyHint`, every write states `destructiveHint` explicitly) — get
  the annotations right; never edit the test to pass.
- Toolsets fail CLOSED: with no suffix a deployment runs `read-only` (no OAuth) or
  `operations` (OAuth); `admin` is only ever reached by naming it. So an `operations`
  tool is on for every authenticated default deployment and an `admin` tool for none —
  place a new write deliberately. A tool that runs code inside the engine
  (`camunda7_create_deployment`) additionally sits behind its own strict env opt-in
  (`CAMUNDA_ALLOW_DEPLOYMENTS=true`) and is not registered without it; follow that
  pattern for anything comparable instead of trusting the toolset alone.

### Annotation conventions

| Operation                                     | Annotations                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Read / list / get                             | `{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`     |
| Set-style write (variable, retries, assignee) | `{ destructiveHint: false, idempotentHint: true, openWorldHint: true }` |
| Other write (start, complete, correlate, …)   | `{ destructiveHint: false, openWorldHint: true }`                       |
| Delete / irreversible (delete, modify)        | `{ destructiveHint: true, openWorldHint: true }` (admin-only)           |
| Engine-wide / worker / deploy                 | `{ destructiveHint: true, openWorldHint: true }` (admin-only)           |

MCP reads an ABSENT `destructiveHint` as `true`, so every write states it — `false` is a
deliberate claim, not a default. `idempotentHint: true` marks writes that repeat to the
same state. Every engine tool carries `openWorldHint: true` (it talks to an external
engine); a tool that only reads the server's own config (`camunda7_list_engines`) says
`openWorldHint: false`.

## Step 3 — wire a new domain file

Only when you created a new `src/tools/<domain>.ts`: add
`registerYourDomainTools(register)` to `registerTools` in
`packages/connectors/camunda/camunda7-connector/src/tools/index.ts`, mirroring the existing calls.

## Step 4 — widget path (only for UI features)

Widget components live in `packages/connectors/camunda/camunda7-connector/src/widgets/` and receive their data as
a `data` prop. Compose them from the design kit `@miragon/pulse-ui` and the view runtime
`@miragon/pulse-widget-shell/widgets` (pulse-ui holds what touches no host: primitives,
components, tone maps, `cn`, the formatters, `Icon`, the table cells; widget-shell holds what
reads the host or calls a tool, and neither re-exports the other's names); never re-inline
these primitives:

- `ViewDataState` — the loading/error/no-data guard (no inline Alert/loading ternary):
  `onRetry` is required (`paged.retry`, a query's `refetch`), loading is a `skeleton`
  slot under a polite sr-only status ("Ansicht wird geladen…" unless `loadingText`),
  no data pulse-ui's `EmptyState`
- Self-fetching widgets: skeleton + error via `QueryFallback` (+ `TableSkeleton`) — a
  missing `isError` branch means an eternal skeleton; `onRetry` is required
- Errors speak through widget-shell's `describeError(error, locale)`: an engine or transport
  failure (503/unreachable, timeout, a tool this server lacks, 401/403, 404, an engine
  exception) becomes what happened ("Die Engine prod ist nicht erreichbar (HTTP 503)")
  and what you can do, the raw "[503 ProcessEngineException] …" collapsed under the
  "Details" of pulse-ui's `ErrorState`: never raw engine text as a headline or in a toast.
  `ViewDataState`, `QueryFallback`, `useDetailView` (its stale notice: an inline warning
  `ErrorState`), `ConfirmDialog`, `useActionFeedback` and the view's own failed call
  (`ViewFrame`) all use it; a widget's own error line does too
  (`ErrorState` with `describeError(...)`), and `errorTitle` heads only a failure
  `describeError` cannot classify
- A view that reads its feed directly calls widget-shell's `useViewData` (from
  `@miragon/pulse-widget-shell/widgets`): the handed-in tool result always seeds a live
  query, so Refresh and a write's invalidation re-read it (#341). Widgets import every
  query hook (`useToolQuery`, `useToolMutation`, `useViewData`, `useQueryClient`) and the
  host seam (`useViewHost`, `HostModelContext`) from the view runtime, never from
  `mcp-use/react` or a retired toolkit package (ESLint); tests render them under `TestViewHost`
- `formatTimestamp`/`formatDate`/`formatTime` (dates) and `formatNumber`/`formatPercent`/
  `formatPercentPoints`/`formatPeriod`/`formatDuration`/`truncate`, all from
  `@miragon/pulse-ui`: no local format
  helpers, no `toFixed`, no `toLocaleString()` without a locale, no hand-built
  `Intl.NumberFormat` (canonical duration style
  "3m 7s" / German "3 Min. 7 s"; "3,7 %", "+0,2 Pp.", "7 Tage")
- Tables: widget-shell's `ListTable` is the frame: a named, keyboard-reachable scroll region
  (`role="region"`, `tabIndex=0`; `ariaLabel` is required), so a wide table never widens
  the document at 760 px (the host simulation pins it). A column a narrow view can do
  without takes `hideBelow: "sm" | "md" | "lg"` (the REGION's width: 640/768/1024 px;
  `md` hides inline, shows in fullscreen), the row actions are the LAST column with
  `sticky: true` (pinned at the region's right edge, Retry never scrolled away). Rows
  stay hand-composed `<tr>` + `Td`, one cell per column (the rules address cell
  positions). An id column is `IdCell` (`IdText` inline): Geist Mono, shortened
  ("5f0ce78e…", whole for screen readers and in `title`), a copy button with a toast.
  Nothing to show: pulse-ui's `TableEmptyState`, `variant="done"` (`CircleCheck`, success) for
  "nothing left to do" ("Keine offenen Incidents"), the default `empty` (quiet `Inbox`)
  for no data; `description`, `action`. The Komet (`KometMark`, `AppEmptyState`) only on
  APP-level surfaces (landing, first start, "no engines"), never in a widget
- Type roles (pulse-ui's `TYPE_SCALE`): a widget's page title is the `WidgetHeader`
  (28/700, an h2 below the view, `as`), a section `text-section` (21/600), running text
  `text-body` (16), dense tables and controls `text-dense` (14), captions and meta
  `text-small` (13, the floor); no `text-xs`/`text-[11px]`, no Tailwind sizes in kit
  code (`scanTypeScale` from `@miragon/pulse-ui/testing`; connectors adopt it with `rules:
["below-floor"]` first)
- From pulse-ui: `Section` (collapsibles); `Th`/`Td` (cells);
  `WidgetHeader` (`badge`/`titleSuffix`/`size="detail"`/`as`, no icon tile) + `VersionChip`
  (hero/detail headers); `KpiGrid` (KPI strips, incl. `variant="soft"`; a
  clickable cell says what the click does in `actionHint`, never `ariaLabel`). From the view
  runtime: `WidgetShell` (page container, split into View + Shell only when the body is
  embedded elsewhere)
- Where and what (#322 U4, U13): a show view's `WidgetHeader` `sub` starts with
  `<EngineMeta engineId={…} asOf={…} />` (`widgets/lib/engine-context.tsx`: the
  environment as a text chip, "PROD", and the engine through widget-shell's `ViewMeta`; inside
  the cockpit, whose head names the engine, only the time); a write confirmation adds
  `engineTargetLines(t, engineId, useEngineEnvironment(engineId))`. Names before ids: the
  design kit's `NamedId` (`@miragon/pulse-ui`: an activity's or process's name, the
  id a quiet mono line; the same look analytics uses), `InstanceLabel`
  (`widgets/lib/identity.tsx`: the business key, the UUID a copyable `IdText` chip; the
  words of `instanceName`); a drill passes the target's `label` so its breadcrumb reads
  the name. The builder reads names as enrichment (`fetchNamesByDefinition` with
  `processNameIn`/`elementNameIn`, `fetchDefinitionsById`, `fetchBusinessKeys`), every
  diagram name through widget-shell's `readBpmnNames`/`parseBpmnNames` (never a regex of your
  own: analytics reads the same diagrams), and a view that shows the engine's definition
  name passes its rows through `nameUnnamedDefinitions` (a Modeler pool around an unnamed
  process names it, as analytics does). A row keeps ONE deterministic action;
  its vendor link and chat hand-offs sit behind `MoreActions`, as `variant="menuitem"`
  entries (`HandOffButton`, `OpenInCockpitLink`); a confirmation names an instance with
  `instanceTargetLines` (business key, then short id)
- Status: a `ToneVariant` (`danger`/`warning`/`success`/`info`/`neutral`; open incident or
  failed job without retries = `danger` — `severityTone`/`countTone` from
  `@miragon/pulse-widget-shell/widgets` is the one ladder for incident and job counts in every
  module, a count without a state stays neutral —, retries left or degraded = `warning`) shown via
  pulse-ui's `StatusBadge` (tone and words required)/`CountPill`/`KpiCell.tone` or its
  `TONE_DOT`/`TONE_BORDER`/`TONE_ICON`/`TONE_TINT`/`TONE_SOFT`/`TONE_INK` maps (a tone
  from the wire through `resolveTone`), next to readable words; never a coloured
  number, never a palette class or raw colour; text on a tint is black (`TONE_SOFT`), the
  `-ink` role is only for text in a tone directly on the card or page (an inline error)
- Icons: Lucide via `Icon` (`import { FileSearch } from "lucide-react"`; the package pins
  devDependency `lucide-react` `1.61.0`, see CLAUDE.md invariant 6), never a Unicode glyph
  or emoji, at 16 px (`dense` in rows; `scanIconSizes` allows 16 and 24 only); a chat
  hand-off is widget-shell's `<HandOffButton action="explainError" prompt={ask(…)} />`
  (`@miragon/pulse-widget-shell/widgets`: the product's one table of functions, each with its
  Lucide icon and a label that names the chat, "Fehler im Chat erklären" / "Explain error in
  chat", the same in every module; `AskAiButton` is banned in connector widgets, so a new
  function gets its entry and both labels in widget-shell), placed after the deterministic action; `OpenInCockpitLink` gets `vendor={data.engineVendor}` (the
  builder sets it from `provider.branding.displayName`)
- Copy: en + de catalogs in the brand voice (du, AI, "CIB seven", no dash connector,
  errors say what happened and what you can do, `Ja`/`Nein` for Booleans) and the terms of
  `src/messages/GLOSSARY.md`; counts go in formatted (`formatNumber`) and the entry picks
  the noun's number (`countOf` from `messages/plural.ts`). The gates: `catalogTextFindings`
  over every catalog and en/de key parity of the widget catalogs (`messages/catalog-text.test.ts`;
  the model summaries are English only), the glossary
  (`messages/glossary.test.ts`), `scanGlyphs` over all of `src` and `scanColors` over
  `src/widgets` (`src/brand-gates.test.ts`; the gates come from `@miragon/pulse-ui/testing`,
  the glossary from `@miragon/pulse-widget-shell/testing`)
- BPMN: viewer lifecycle and the fixed light canvas via `useBpmnViewer` (the container
  is a forced-light island, `data-theme-mode="light"`, on the paper token) +
  `BpmnZoomControls` (light in every theme, Lucide). The frame height comes from the
  diagram's size (`height` from the hook: its height at the scale bpmn-js draws it, never
  past 1:1, 240–560 px, read from the XML's DI before the import, so the frame does not
  jump): pass no fixed `height` to `BpmnDiagram` or `BpmnHeatmap` unless a layout needs
  one. Overlay and legend colours are widget-shell's ONE
  token module (`BPMN_TOKENS`, `widget-shell/src/ui/bpmn-tokens.ts`: incident = danger,
  running/open task = blue on the info tint, counts white on blue or danger; strokes
  ≥ 3:1, badge text ≥ 4.5:1, drift- and contrast-tested) through `HIGHLIGHT_COLORS`
  (`src/widgets/bpmn-highlights.ts`) and `markerSwatch`/`badgeSwatch`; the CSS is
  `injectBpmnOverlayCss()`. No pulse: an open user task is a heavier dashed stroke

**Paged list recipe** (every list that can exceed one page follows it — reference:
`src/widgets/process-instances/list.tsx`):

1. Feed: accept `firstResult`/`maxResults` (+ server-side filter params like
   `businessKeyLike`/`nameLike`) and return the full filtered total (via the matching
   `/count` endpoint) so the footer is honest.
2. Widget: `usePagedListView` (owns search state, 300 ms debounce, the server-side
   `searchArg`, and the drop-initialData-on-interaction rule; chips go into
   `filtersActive` + the `args`) → `FilterBar` (with `searchAriaLabel`, the placeholder's
   words without the ellipsis, and `chipsAriaLabel` for a chip row: pulse-ui's default
   name is a generic "Filter"; `src/widgets/search-labels.test.tsx` pins every search box
   by its name) → `PagedRows` (marks the rows while they
   are the previous result) around `ListTable` (frame + `Th` header row;
   rows stay hand-composed `<tr>` + `Td`) or a `RowCard` stack → `TableEmptyState`
   (distinguish "no match" when `interacted`) → pulse-ui's `PagedListFooter`
   (`paged` as is, `noun` from the catalog — the stale page-0 error and the load-more
   error, each with its own retry and the raw reason under Details, + "Showing X of Y" in
   the list's one live region + Load more; deliberately not infinite scroll; rendered
   under an empty result too). Guard the whole view on
   `!paged.firstPage` only: a search keeps the previous rows (and the search box)
   mounted while its page 0 is in flight. While it does, `paged.stale` is true and
   `firstPage`/`total` are the PREVIOUS result's — a header count, the filters it
   covers and the model context read the payload's echo (`data.filters`), never the
   request's args (reference: the instance list's `listFilters`).

A view is registered in **three places — miss one and it is silently absent**:

1. `src/widgets/views.tsx` — map the show tool's name to its view component:
   `[CAMUNDA7_SHOW_MY_VIEW]: MyView`, where `MyView({ data })` gets the show tool's
   `structuredContent` and wraps the widget in `Camunda7Standalone` (its client-side
   drill-in). A composed view (a dashboard, the process detail) is ONE component that
   composes its widgets in a `ViewStack` and also serves the cockpit route
   (`src/widgets/cockpit-app/routes.tsx`).
2. `apps/mcp-server-camunda7/src/ui/view-registry.ts` — the view registry. It spreads
   `camunda7Views` from `src/widgets/index.ts` — verify your view actually arrives.
3. `src/tool-names.ts` — add a `CAMUNDA7_SHOW_*` / `CAMUNDA7_*_DATA` constant for every
   new widget tool, so the view map and navigation stay rename-safe.

A view is picked by its name, the show tool's name.
`apps/mcp-server-camunda7/test/view-registry.test.ts` holds the view registry to the
view-bound tools of the tools/list goldens and fails on a tool without a view.

Then register the widget tool in its area's file under `src/widget-tools/` (`cockpit.ts`,
`instances.ts`, `incidents.ts`; `*_data` feeds in `data-feeds.ts`). `src/widget-tools.ts`
wires them; these files are the documented exception that uses `server.tool()` directly:

- Every widget-path tool (show tool AND feed) declares
  `inputSchema: strictToolInput({ … })` (from `@miragon/pulse-widget-shell/server`) — never
  a bare `z.object`, which strips an unknown key silently;
  `apps/mcp-server-camunda7/test/strict-input.e2e.test.ts` refuses any module tool that
  accepts one.
- `show_*` tools: register through `registerShowTool` (`src/widget-tools/shared.ts`), which
  appends the `engine` parameter and spreads `...showToolBinding(TOOL_NAME_CONST, "Title")`
  (from `@miragon/pulse-widget-shell/server`); a tool whose input needs a refinement spreads
  it by hand — the helper binds a native mcp-use view named after the tool
  (`view: { name }`, mcp-use then emits all `_meta.ui.*` keys and the
  `ui://views/<tool>.html` resource itself), adds the required passthrough
  `outputSchema`, and stamps the Apps-SDK half of `_meta`; **never write
  `_meta.ui` keys by hand** (mcp-use owns and overwrites that namespace). Resolve the engine via
  `resolveEngine(args.engine, registry, ctx)` — it already returns `baseUrl`/`cockpitUrl`;
  never fish them out of `registry.engines`. Return `buildViewResult(data, summary)`
  (from `@miragon/pulse-widget-shell/server`): `data` IS the view's data, no title (the
  widget's heading names the view). The `summary` is the model-facing text channel (1-2
  sentences, key figures, no raw data) — the full payload travels only in
  `structuredContent`. It is English only: a `c7sum.*` entry in `src/messages/en.server.ts`,
  worded through `summaryT` (`src/lib/summary.ts`).
- `*_data` feeds: register through `registerDataFeed` in `data-feeds.ts` (`name`, `title`,
  `description`, `shape`, `read`), which spreads `...appOnly` (the native
  `visibility: "app"` field, emitted as SEP-1865 `_meta.ui.visibility: ["app"]`, plus
  `openai/widgetAccessible`; **no** view binding) and returns `buildDataFeedResult(data)` so
  the in-widget `callTool()` gets JSON back instead of the host rendering a new widget.
  Wrap every raw handler in `withToolErrors` (from `@miragon/pulse-widget-shell/server`).
- Shared data paths: every number a view shows comes from ONE builder in `src/data/`
  that its show tool AND its `*_data` feed call — never fork one.
  Definition lookups (id parsers, the key lookup, the per-KEY fold of the per-version
  statistics) come from `src/data/definition-info.ts`; the BPMN viewer payload from
  `src/data/bpmn-viewer-data.ts`. A key's latest version is `fetchLatestDefinition`
  (every tenant) — never `/process-definition/key/{key}`, which only knows tenant-less
  definitions. A long key's (over ~25 characters) definition id is a bare generated
  UUID that names no key, so ANY key that scopes a query, a drill, a hand-off or a
  cockpit link is resolved, never parsed: a view queried by key uses that key; rows
  that carry only a definition id go through `resolveDefinitionKeys` (at most ONE
  definition-statistics read, none when every id names its key) — a primary read where
  the key is what the view hands on, else wrapped in `optional(...)` as enrichment, so
  a bare id's key is `null` (no drill, no link), never its UUID. A view that already
  reads the statistics resolves through `definitionKeyResolver` over them.
  `processDefinitionKeyFromId` is a display fallback only.
- **Honest numbers** (`src/data/engine-reads.ts`): PRIMARY rows and counts — what the
  view exists to show, and every number its `summary` reports — propagate engine
  failures (read them through `countOf`/`rowsOf`; `withToolErrors` turns the throw into
  a tool error), and an unknown id or key is a not-found error — never a view of zeros. Only
  ENRICHMENT (display names, diagram XML, cockpit links, optional history) degrades, via
  `optional(...)`, and to `null` — never to a `0`, `[]` or `{}` that reads as a fact.
  Widgets render that null as "—" (`formatCount`, `src/widgets/lib/format-count.ts`),
  summaries as "unknown". Totals come from `/count` endpoints or statistics, never from
  the length of a capped page or scan: a recency scan (`INCIDENT_SCAN_LIMIT`, the health
  views' `CLUSTER_SCAN_LIMIT`) only enriches and says how far it reaches
  (`scannedIncidentCount`, null facts, "≥N" via `formatCountAtLeast`). A view about
  a process definition KEY spans every deployed version (key-scoped `/count`, statistics
  summed per key); only a diagram is one version, and it is labelled. Engine timestamps
  compare by instant (`engineDateMillis`/`latestEngineDate`/`earliestEngineDate` from
  `@miragon/pulse-camunda7-client`), never as strings. A new builder adds its case to the
  rejection table in `src/data/honest-numbers.test.ts` — the table fails without it. The
  table breaks EVERY read the healthy build makes (method + path + query names), so a
  case declares only its enrichment reads; any other read whose failure is swallowed fails.
- The `show_*`/`*_data` naming is load-bearing:
  `apps/mcp-server-camunda7/test/widget-contract.e2e.test.ts` enforces the widget `_meta` on
  every `*_show_*` tool and app-only visibility on every `*_data` feed **by name**.
- A widget-path tool never writes. A write is a registrar tool, so the toolset filter
  (`withToolsetFilter`/`isToolInToolset`) drops it outside its toolset, and an in-widget
  write calls it through `useEngineAction`, gated by `camunda7_widget_actions_data`.
- Every in-widget write runs through `useEngineAction({ tool, target, resetOn, available })`
  (`src/widgets/lib/engine-action.ts`) — never a raw `useToolMutation`/`callTool`. Its
  `allowed` is the gate — the toolset AND the subject's current state (`available`:
  false for an ended, cancelled or unconfirmed instance, a suspended one where the
  engine refuses the write): render the control only when true (hide it and a table
  column it would leave empty, never just disable it). List
  the tool in `CAMUNDA7_WIDGET_ACTIONS` (`src/tool-names.ts`) and give it a
  `WRITE_POLICY` entry (`src/widgets/lib/write-policy.ts`: the query namespaces it
  changes, and `confirm: true` for irreversible/state-changing writes — then `run`
  needs a confirmation naming its target, rendered by `EngineActionDialog`, with
  verb + object on both buttons: widget-shell's `ConfirmDialog`, an `alertdialog` over the
  scrim, the destructive confirm in the danger role, a failure shown inside it). Every
  `run` passes `feedback`, the toasts' titles naming the object, from
  `src/widgets/lib/write-feedback.ts` (`writeFeedback.jobRetry(t, instanceName(id,
businessKey))` …; add an entry and its `feedback.*` keys in `messages/{en,de}.feedback.ts`
  for a new write): a success toast, a failure toast with the reason in words
  (`useActionFeedback`); a confirmed write's failure stays in its dialog. Optimistic state reads `action.done` (dropped when
  `resetOn` changes — pass the data the marked ROWS come from, not a sibling feed).
  `src/widget-actions.test.ts` enforces all of it structurally; add
  the new call site to `src/widgets/action-gating.sites.ts` + its renderer in
  `action-gating.test-support.tsx`.
- Everything the widget tells the model goes through `useHandOff()`
  (`src/widgets/lib/hand-off.ts`): `<HandOffButton action="…" prompt={ask(handOff)} />` and
  `<HostModelContext content={context(view)}>`. A hand-off is a typed spec — an `intent`
  key from `messages/{en,de}.ask-ai.ts` (static, no tool names) or a static view
  `summary`, plus `ids` (arguments every named tool may take), `toolIds` (arguments only
  one tool takes, inlined only while it is named), `facts`, `untrusted` (engine text —
  fenced) and `tools` (filtered by the live surface). Reference:
  `src/widgets/remediation.ts`; the rules are CLAUDE.md invariant 6, enforced by
  `apps/mcp-server-camunda7/test/hand-off-surface.test.ts`.

## Step 5 — verify

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
# for widget/shell changes additionally:
pnpm --filter @miragon/pulse-mcp-server-camunda7 test:host
```

A new or changed tool changes the wire surface: add its name to
`apps/mcp-server-camunda7/test/expected-tools.ts`, then refresh the per-toolset goldens with
`GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server-camunda7 test` and commit the
`test/__golden__/` diff (descriptions and schemas are what the model reads — review them).
If `char-budgets.json` grew, `pnpm lint` fails until the commit carries a
`Ratchet-Exception: <why the model must read more>` trailer — trim wording first.

`pnpm typecheck` is the **only** automated check that type-checks widget `.tsx` code
(`tsc -p tsconfig.widgets.json`) — never skip it. For widgets also do a manual render
check: `docker compose -f playground/docker/docker-compose.yml up -d`, `pnpm dev`, then call the
tool in the inspector at `http://localhost:8400/mcp/inspector`. The default `pnpm dev` boot
is read-only (the boot log names the toolsets) — to exercise a write tool or button, set
`MCP_ACTIVE_MODULES=camunda7:admin,analytics` in `.env` (plus
`CAMUNDA_ALLOW_DEPLOYMENTS=true` for deployments). Run `pnpm format:check` (or
`pnpm format`) before committing.
