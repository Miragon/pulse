---
name: add-bpm-feature
description: Step-by-step house pattern for adding a new BPM operations tool, widget tool, or widget to the engine module (`packages/connectors/engine/engine-connector`, over `packages/connectors/engine/engine-client` and `packages/connectors/engine/engine-core`). Use whenever adding or changing Camunda 7 / CIB seven tools ("add a tool to suspend jobs", "expose X from the engine REST API"), input schemas, cockpit routes, `*_data` feeds, or React widgets in the cockpit. Takes precedence over generic mcp-use examples.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-bpm-feature — new tool/widget in the engine module

The engine module never registers operations tools with raw `server.tool()`. Tools go
through the registrar (`createToolRegistrar` from `@miragon/pulse-widget-shell/server`);
engine access goes through `withEngine`/`resolveEngine` (per-call `engine` override >
`ENGINE_DEFAULT` > the only configured engine). A view is registered in three places (CLAUDE.md
invariant 3). Follow the steps for the path you need.

## Step 0 — pick the render path

| You need…                                                        | Path                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| JSON data for the model                                          | Registrar tool in `src/tools/<domain>.ts` (Steps 1–3)                                 |
| A view for the user                                              | a cockpit route plus its builder and `*_data` feed (Step 4); never a second view tool |
| App-only JSON for in-widget refresh/nav                          | `*_data` feed in `DATA_FEEDS` of `src/data/feeds.ts` (Step 4)                         |
| An answer the CLI's workflow commands give too (inspect, status) | a composite on `@miragon/pulse-engine-core` over `src/lib/core-adapter/` (Step 2b)    |

## Step 1 — input schema next to the tools

Add the Zod input schema to `packages/connectors/engine/engine-connector/src/schemas/<domain>.ts` and
export it from `src/schemas/index.ts`. Existing style (from `schemas/process-instances.ts`):

```ts
export const listProcessInstancesInput = z.object({
  processDefinitionKey: z.string().optional(),
  businessKeyLike: likeParam(),
  active: flagParam(),
  withIncidents: flagParam("true = only instances with an open incident"),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(), // capped at MAX_PAGE_SIZE (100); default page 20
  sortBy: z.enum(["instanceId", "definitionKey"]).optional(),
  sortOrder: sortOrderParam,
})
```

**Descriptions.** Describe a field only where the tool gives it its own meaning: what `false`
or an omitted value selects when no shared rule says it (`withIncidents`: open only), a unit or
format the name does not say (`retryTimeout`: in milliseconds), an id that names another object
than its name suggests, or which views take it (`engine_open_cockpit`). A description that
restates the name or the tool description goes. What a parameter means on every tool
(`engine`, paging and sorting, `processDefinitionKey`/`processDefinitionId`, `activityId`,
`incidentType`, `…Like`, the boolean filters, the date bounds, the variable shape) is said once
in `engineInstructions` (`packages/connectors/engine/engine-connector/src/instructions.ts`),
and the paging, sorting, `…Like`, flag, date and variable-map helpers in `schemas/shared.ts`
carry no description of their own, so a field built from them needs none (`flagParam` and
`engineDateParam` take one where the field means more; `wholeVariableParam` keeps its own). A
new shared meaning goes into the instructions, briefly, not onto each tool. A safety rule stays
at the write it guards (the cut-value rule on the variable writes), where a host that drops the
server instructions still shows it. `apps/mcp-server/test/tools-list.golden.test.ts`
fails when one description repeats on more than two model-visible tools.

A list/query tool pages with the shared params from
`schemas/shared.ts` — `firstResultParam` + `maxResultsParam(defaultPageSize)` — never a
hand-rolled `maxResults` (a `*_data` feed spreads `pagingShape` from the same file, the one paging
definition in its described, default-free form): `src/tools/list-tools.test.ts` treats every registrar tool that
takes `maxResults` as a list and fails it without the cap or the envelope (Step 2). The
REST calls themselves use the generated SDK (imported from
`@miragon/pulse-engine-client/sdk`) — if the endpoint is missing there, the OpenAPI spec
changed and you need `pnpm generate`, not a hand-written fetch. The engine's REST rules the
handler applies (`toEngineDate`, `engineLike`, `complementaryFlags`, `engineSorting`,
`toEngineVariables`, `incidentRecovery`, `RAW_VARIABLES`) come from `@miragon/pulse-engine-core`,
their one home, which the CLI uses too; the reads bound to the SDK (`fetchJobStacktrace`,
`readProcessInstanceVariables`, `readBatch`) from `@miragon/pulse-engine-client`.

### Parameter naming guide

Inputs are STRICT (the registrar is always strict; raw `server.tool()` registrations use
`strictToolInput(...)` from `@miragon/pulse-widget-shell/server`): an unknown key is a tool
error listing the valid keys. So one name per concept across every tool: a model that learned
`assignee` on one tool must not be refused it on the next. Renames ship without aliases.

| Concept                  | Name                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Process definition       | `processDefinitionKey` (all versions), `processDefinitionId` (one version); never bare `key`                                                                                                                                                           |
| Entity ids               | `<entity>Id` — `processInstanceId`, `deploymentId`, `jobId`, `activityId` (analytics too); never bare `id`, never `elementId`                                                                                                                          |
| Several values           | `<name>In`, an array (`processDefinitionKeyIn`); merged with the single form via `engineKeyList`                                                                                                                                                       |
| User filter              | `assignee` (the user a task is assigned to); a write that sets a user takes `userId`                                                                                                                                                                   |
| Business key / substring | `businessKey` exact, `businessKeyLike`/`nameLike` substring via `likeParam()`: `engineLike` wraps a `%`-less value                                                                                                                                     |
| Time bounds              | `<event>After`/`<event>Before` (`startedAfter`, `finishedBefore`, `incidentTimestampAfter`) via `engineDateParam()`: ISO 8601 in, `toEngineDate` out                                                                                                   |
| Boolean filters          | `flagParam()` + `complementaryFlags` (active/suspended, …) or `trueOnly`: the engine IGNORES `false` (never sent); a both/neither pair is refused; a new `complementaryFlags` pair is named in `engineInstructions` (`instructions.test.ts` checks it) |
| Paging / result size     | `firstResult` + `maxResults` from `firstResultParam` + `maxResultsParam` (above; also for a top-N cap: never `limit`)                                                                                                                                  |
| Sorting                  | `sortBy` + `sortOrder`, sent as a pair by `engineSorting`                                                                                                                                                                                              |

The engine's own query names may differ (`taskAssignee`, `processInstanceBusinessKey`,
`withIncident`): the handler maps them, the schema keeps the guide's name. Every
filter a tool advertises is pinned on the wire in `src/tools/filters.wire.test.ts`
(page query AND `/count`); a retired spelling (`key`, `id`, `limit`, `elementId`, …) on
any module tool fails `apps/mcp-server/test/strict-input.e2e.test.ts`, so a parameter that
instructions or a description quote but the tool does not take turns into a refused call.
The one quoted filter set in the instructions (the retry playbook's `engine_list_jobs`
filters) is held to `listJobsInput` by `src/instructions.test.ts`; a newly quoted parameter
gets its own pin there. Widget Ask-AI hand-offs and model contexts never quote parameters:
they pass typed `ids` (see Step 4).

## Step 2 — register the tool

Add the tool in `packages/connectors/engine/engine-connector/src/tools/<domain>.ts`. Reference template —
`engine_list_process_instances` from `src/tools/process-instances.ts`:

```ts
import { listProcessInstancesInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { complementaryFlags, engineLike, engineSorting } from "@miragon/pulse-engine-core"
import { getProcessInstances, getProcessInstancesCount } from "@miragon/pulse-engine-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

export function registerProcessInstanceTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_list_process_instances",
    category: "process-instances",
    description: "List running process instances.",
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

A list tool's description says what it lists, never the paging contract
(`src/tools/list-tools.test.ts`).

Non-negotiables:

- Every tool carries a `category` matching its domain file name (e.g.
  `"process-instances"`, `"tasks"` — `task-form.ts` uses `"tasks"`,
  `incident-issue.ts` uses `"incidents"`).
- `inputSchema` spreads `...engineParamShape` so every tool accepts the per-call
  `engine` override.
- `handler` is wrapped in `withEngine(...)` — never construct, cache, or import a client
  directly; `withEngine` resolves the engine from the registry per call.
- Tool names are `engine_<verb>_<noun>` in snake_case.
- Write tools that only flip state return a small `{ success: true, … }` object instead
  of the raw (often empty) REST response.
- Destructive/admin-grade tools (delete, modify, suspension, deployments, migrations,
  batches, engine-wide broadcasts like signals, the external-task worker protocol) and
  reads that only feed an admin write (`engine_get_batch`,
  `engine_get_activity_instance_tree`) must
  be added to `ADMIN_ONLY_TOOLS` in `src/lib/mcp/toolsets.ts` so the
  `engine:read-only|operations|admin` toolset filtering stays correct — `read-only`
  membership is derived from `readOnlyHint: true`. `src/lib/mcp/toolsets.test.ts` enforces
  the rule structurally over every registrar tool (`destructiveHint` ⇒ admin-only,
  read-only ⇒ `readOnlyHint`, every write states `destructiveHint` explicitly), and
  `src/plugin.test.ts` over every tool the module registers, feeds included (the
  read-only floor holds only `readOnlyHint` tools); get the annotations right, never
  edit the test to pass.
- Toolsets fail CLOSED: with no suffix a deployment runs `read-only` (no OAuth) or
  `operations` (OAuth); `admin` is only ever reached by naming it. So an `operations`
  tool is on for every authenticated default deployment and an `admin` tool for none —
  place a new write deliberately. A tool that runs code inside the engine
  (`engine_create_deployment`) additionally sits behind its own strict env opt-in
  (`ENGINE_ALLOW_DEPLOYMENTS=true`) and is not registered without it; follow that
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
engine); a tool that only reads the server's own config (`engine_list_engines`) says
`openWorldHint: false`.

## Step 2b — a read composite on engine-core

A question the CLI answers too (where an instance waits, how an engine is doing) runs on
`@miragon/pulse-engine-core` (`packages/connectors/engine/engine-core`, the engine family's
core), the workflow domain both share, never on a second copy here. A rule both need that it
lacks goes into that package (a leaf: no dependency, data rather than wording).
The pattern is `engine_inspect_process_instance` and `engine_status`
(`src/lib/core-adapter/composites.ts`, registered like any registrar tool):

- Map every operation the composite sends in `READS` of `src/lib/core-adapter/engine-port.ts`, one typed
  SDK read each; text/plain and variable reads go through engine-client's SDK-bound reads
  (`fetchJobStacktrace`, `readProcessInstanceVariables`), as `engine-contract.test.ts`
  demands. `src/lib/core-adapter/engine-port.test.ts` holds `READS` to engine-core's operation
  lists.
- Word engine-core's error reasons in `src/lib/core-adapter/workflow-errors.ts` (`[CODE] message` in the
  tool's parameter names, no tool names).
- Return data for the model: drop `next` (it would name tools a toolset may lack), cut
  variables with `truncatePlainVariables`, and cap every list engine-core leaves uncapped for
  the CLI (today wait states, incidents, timeline, variables, definitions, topics), naming each
  cut in `truncated`. The cap bounds the result, not the reads. Pin the wire and each cap in
  `src/lib/core-adapter/composites.wire.test.ts` (inspect) and
  `src/lib/core-adapter/composites-status.wire.test.ts` (status), over the helpers of
  `src/lib/core-adapter/composites.test-support.ts`.

`src/lib/` is split by job, and each helper goes into the folder of its job: `engine/`
(routing: `resolveEngine`, `withEngine`, the cockpit links, passthrough auth), `core-adapter/`
(the engine-core port, the composites, their error wording), `bpmn/` (the definition XML,
BPMN and task-form reading, completing a user task by its form), `mcp/` (the tool surface:
toolsets, the paging envelope, the bounds on variable values and failure text) and `shared/`
(pure code the widgets run too). `src/data/` and `src/lib/` never import `src/tools/`,
`src/widget-tools/`, `src/widgets/` or the connector's root (`index`, `plugin`, `module`)
(`connector-data-and-lib-point-down`): a helper a builder needs from a tool moves down into the
lib folder of its job (the task form's `buildTaskFormSchema` into `bpmn/`).

## Step 3 — wire a new domain file

Only when you created a new `src/tools/<domain>.ts`: add
`registerYourDomainTools(register)` to `registerTools` in
`packages/connectors/engine/engine-connector/src/tools/index.ts`, mirroring the existing calls.

## Step 4 — widget path (only for UI features)

Widget components live in `packages/connectors/engine/engine-connector/src/widgets/` and receive their data as
a `data` prop. Compose them from the design kit `@miragon/pulse-ui` and the view runtime
`@miragon/pulse-widget-shell/widgets` (pulse-ui holds what touches no host: primitives,
components, tone maps, `cn`, the formatters, `Icon`, the table cells; widget-shell holds what
reads the host or calls a tool, and neither re-exports the other's names); never re-inline
these primitives. Widgets are browser code: at runtime they import only their own widgets,
`src/messages`, `src/tool-names.ts`, the view models, `@miragon/pulse-widget-shell/widgets` and the
view stack, plus `src/lib/shared` (pure code the server runs too, held to the same allowlist);
`src/tools`, `src/data`, the feed contracts, the plugin, the module,
`@miragon/pulse-engine-client` and anything else only as types (`import type`), and the other
`src/lib` folders not even as types: a type both sides need is declared once in
`src/lib/shared` (`TaskCompletion`). Data arrives through the view tool and the `*_data` feeds
(`connector-widgets-are-browser-code` and `connector-widgets-only-shared-lib` in
`.dependency-cruiser.cjs`):

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
  `mcp-use/react` (ESLint); tests render them under `TestViewHost`
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
- Where and what (#322 U4, U13): the cockpit's head names the engine and its environment (a
  text chip, "PROD"), so a route view's `WidgetHeader` `sub` carries only the time it read
  (widget-shell's `ViewMeta` with `asOf`) and its own facts; a route widget takes `engine` and
  its ids as required props and builds its feed args from them alone. A write confirmation
  adds `engineTargetLines(t, engineId, useEngineEnvironment(engineId))`
  (`widgets/lib/engine-context.tsx`). Names before ids: the
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
  over every catalog and en/de key parity of the widget catalogs (`messages/catalog-text.test.ts`),
  the glossary
  (`messages/glossary.test.ts`), `scanGlyphs` over all of `src` and `scanColors` over
  `src/widgets` (`src/brand-gates.test.ts`; the gates come from `@miragon/pulse-ui/testing`,
  the glossary from `@miragon/pulse-widget-shell/testing`)
- BPMN: viewer lifecycle and the fixed light canvas via `useBpmnViewer` (the container
  is a forced-light island, `data-theme-mode="light"`, on the paper token) +
  `BpmnZoomControls` (light in every theme, Lucide). The frame height comes from the
  diagram's size (`height` from the hook: its height at the scale bpmn-js draws it, never
  past 1:1, 240–560 px, read from the XML's DI before the import, so the frame does not
  jump): pass no fixed `height` to `BpmnDiagram` unless a layout needs one. The heat on the
  process flow is analytics' (`analytics:process-heatmap` through `HostWidgetSlot`, offered only
  while `useAnalyticsActive` holds and both heatmap host widgets are registered): this module
  passes its diagram, never the heat values.
  Overlay and legend colours are widget-shell's ONE token module (`BPMN_TOKENS`,
  `widget-shell/src/ui/bpmn-tokens.ts`: incident = danger, running/open task = blue on the
  info tint, counts white on blue or danger; strokes ≥ 3:1, badge text ≥ 4.5:1, drift- and contrast-tested) through `HIGHLIGHT_COLORS`
  (`src/widgets/bpmn-highlights.ts`); the CSS is
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

The engine module has ONE view, `engine_open_cockpit` → `CockpitApp` (CLAUDE.md invariant 3). New
UI is a **cockpit route**, never a second view tool. On the server a route is five entries;
`COCKPIT_ROUTES` and the widgets' route switch fail to compile without it, and
`src/data/cockpit-start.test.ts` fails on a route whose feed is missing from `DATA_FEEDS`:

1. `src/view-models.ts`: a section in `CockpitView` with the ids the route reads, and its
   data type in `CockpitStartData`.
2. `src/data/`: ONE builder for the route's data (`<route>-data.ts`).
3. `src/data/feeds.ts`: the route's `*_data` feed,
   `dataFeed({ name, title, description, shape, read })`, in `DATA_FEEDS`; `read` calls the
   builder. `src/widget-tools/data-feeds.ts` registers every feed of `DATA_FEEDS`.
4. `src/tool-names.ts`: the feed's name as an `ENGINE_*_DATA` constant.
5. `src/data/routes.ts`: the route's entry in `COCKPIT_ROUTES`: the ids it `needs` and also
   `takes` (fields of its own `CockpitView` section, checked at compile time), its `start` (its
   feed's read with the first page's args) and its `facts`. `src/widget-tools/cockpit.ts`
   builds the `view` enum and checks the ids from it, and `src/data/cockpit-start.ts`
   dispatches the start view and its facts. A start param new to the cockpit also gets its
   described field in `startViewShape` (`src/widget-tools/cockpit.ts`; `StartParam` is read
   off `CockpitView`, so a missing field fails to compile), and a route that takes an existing
   param adds its name to that param's description (the tools/list golden shows the change).

In the widgets a route is its widget, a case in `CockpitRoute`
(`src/widgets/cockpit-app/routes.tsx`) that renders it with `seedOf(seed, section)` as its
`data` and the route's `engine` and ids as required props, a `NavIntent` and an emitter (below)
and its en/de messages. A composed view (a dashboard, the process detail) is ONE component that
composes its widgets in a `ViewStack`.

The start data is exactly the feed's page-0 payload: build it with the size the widget
pages by (`LIST_PAGE_SIZE`, `HISTORY_PAGE_SIZE` in `src/view-models.ts`), so the route's
widget seeds its feed with it and refreshes after a write without a fetch on mount
(`src/data/cockpit-start.test.ts` pins the seed against the feed). The facts are the
model-facing result: compact JSON, English keys, ids and counts (a `null` count is
unknown, never 0), engine text clipped, never XML. A route needs an emitter in the cockpit
too: a `DrillButton`, a KPI cell's `onClick`, or a head section in
`src/widgets/cockpit-app/app.tsx`, each through `useNav()` with a `NavIntent`
(`src/widgets/navigation.ts`) that `intentToView` (`src/widgets/nav-core.ts`) maps onto the
route. A route that nothing emits and `engine_open_cockpit` cannot open is dead.

`apps/mcp-server/test/view-registry.test.ts` holds the view registry
(`apps/mcp-server/src/ui/view-registry.ts`, which spreads `engineViews` from
`src/widgets/index.ts`) to the view-bound tools of the tools/list goldens.

`src/widget-tools.ts` wires the cockpit tool (`src/widget-tools/cockpit.ts`), the `*_data`
feeds (`data-feeds.ts`, over `DATA_FEEDS`) and the actions feed; these files are the documented
exception that uses `server.tool()` directly:

- Every widget-path tool (the cockpit AND each feed) declares
  `inputSchema: strictToolInput({ … })` (from `@miragon/pulse-widget-shell/server`) — never
  a bare `z.object`, which strips an unknown key silently;
  `apps/mcp-server/test/strict-input.e2e.test.ts` refuses any module tool that
  accepts one.
- `engine_open_cockpit` spreads `...showToolBinding(ENGINE_OPEN_COCKPIT, "Open Cockpit")`
  (from `@miragon/pulse-widget-shell/server`), which binds a native mcp-use view named after
  the tool (`view: { name }`, mcp-use then emits all `_meta.ui.*` keys and the
  `ui://views/<tool>.html` resource itself), adds the required passthrough `outputSchema`,
  and stamps the Apps-SDK half of `_meta`; **never write `_meta.ui` keys by hand** (mcp-use
  owns and overwrites that namespace). Resolve the engine via
  `resolveEngine(args.engine, registry, ctx)`, which already returns `baseUrl`/`cockpitUrl`;
  never fish them out of `registry.engines`. It returns `buildViewResult(data, facts)`
  (from `@miragon/pulse-widget-shell/server`): `data` IS the view's data, no title (the
  widget's heading names the view); the facts are the compact JSON of the route's `facts`, the
  model-facing text channel, while the full payload travels only in `structuredContent`.
- `*_data` feeds: describe one with `dataFeed({ name, title, description, shape, read })` in
  `DATA_FEEDS` (`src/data/feeds.ts`); `registerDataFeed` in `data-feeds.ts` registers each and
  spreads `...appOnly` (the native
  `visibility: "app"` field, emitted as SEP-1865 `_meta.ui.visibility: ["app"]`, plus
  `openai/widgetAccessible`; **no** view binding) and returns `buildDataFeedResult(data)` so
  the in-widget `callTool()` gets JSON back instead of the host rendering a new widget.
  Wrap every raw handler in `withToolErrors` (from `@miragon/pulse-widget-shell/server`).
- Shared data paths: every number a view shows comes from ONE builder in `src/data/`
  that its `*_data` feed AND the cockpit's start view (`COCKPIT_ROUTES`) call; never
  fork one. Definition lookups (id parsers, the key lookup, the per-KEY fold of the
  per-version statistics) come from `src/data/definition-info.ts`. A key's latest version is
  `fetchLatestDefinition`
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
  view exists to show, and every number its facts report — propagate engine
  failures (read them through `countOf`/`rowsOf`; `withToolErrors` turns the throw into
  a tool error), and an unknown id or key is a not-found error — never a view of zeros. Only
  ENRICHMENT (display names, diagram XML, cockpit links, optional history) degrades, via
  `optional(...)`, and to `null` — never to a `0`, `[]` or `{}` that reads as a fact.
  Widgets render that null as "—" (`formatCount`, `src/widgets/lib/format-count.ts`),
  the facts keep it `null` (the instructions read it as unknown). Totals come from `/count`
  endpoints or statistics, never from
  the length of a capped page or scan: a recency scan (`INCIDENT_SCAN_LIMIT`, the health
  views' `CLUSTER_SCAN_LIMIT`) only enriches and says how far it reaches
  (`scannedIncidentCount`, null facts, "≥N" via `formatCountAtLeast`). A view about
  a process definition KEY spans every deployed version (key-scoped `/count`, statistics
  summed per key); only a diagram is one version, and it is labelled. Engine timestamps
  compare by instant (`engineDateMillis`/`latestEngineDate`/`earliestEngineDate` from
  `@miragon/pulse-engine-core`), never as strings. A new builder adds its case to the
  rejection table in `src/data/honest-numbers.test.ts` — the table fails without it. The
  table breaks EVERY read the healthy build makes (method + path + query names), so a
  case declares only its enrichment reads; any other read whose failure is swallowed fails.
- The `show_*`/`*_data` naming is load-bearing:
  `apps/mcp-server/test/widget-contract.e2e.test.ts` enforces the widget `_meta` on
  every `*_show_*` tool and on `engine_open_cockpit`, and app-only visibility on every
  `*_data` feed **by name**.
- A widget-path tool never writes. A write is a registrar tool, so the toolset filter
  (`withToolsetFilter`/`isToolInToolset`) drops it outside its toolset, and an in-widget
  write calls it through `useEngineAction`, gated by `engine_widget_actions_data`.
- Every in-widget write runs through `useEngineAction({ tool, target, resetOn, available })`
  (`src/widgets/lib/engine-action.ts`) — never a raw `useToolMutation`/`callTool`. Its
  `allowed` is the gate — the toolset AND the subject's current state (`available`:
  false for an ended, cancelled or unconfirmed instance, a suspended one where the
  engine refuses the write): render the control only when true (hide it and a table
  column it would leave empty, never just disable it). List
  the tool in `ENGINE_WIDGET_ACTIONS` (`src/tool-names.ts`) and give it a
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
  `summary`, plus `ids`, `facts`, `untrusted` (engine text, fenced); no `tools`: a hand-off
  names no tool, the module instructions and the tool descriptions steer the model.
  Reference:
  `src/widgets/remediation.ts`; the rules are CLAUDE.md invariant 6, enforced by
  `scripts/hand-off-refs.test.mjs`.

## Step 5 — verify

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
# for widget/shell changes additionally:
pnpm --filter @miragon/pulse-mcp-server test:host
```

A new or changed tool changes the wire surface: add its name to
`apps/mcp-server/test/expected-tools.ts`, then refresh the per-toolset goldens with
`GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server test` and commit the
`test/__golden__/` diff (descriptions and schemas are what the model reads — review them).
The budget counts the model-visible tools/list text plus the server instructions of each
toolset. If `char-budgets.json` grew, `pnpm lint` fails until the commit carries a
`Ratchet-Exception: <why the model must read more>` trailer — trim wording first.

`pnpm typecheck` is the **only** automated check that type-checks widget `.tsx` code
(`tsc -p tsconfig.widgets.json`) — never skip it. For widgets also do a manual render
check: `pnpm play` (playground, build and server in one command), then call the
tool in the inspector at `http://localhost:8400/mcp/inspector`. The default boot
is read-only (the boot log names the toolsets) — to exercise a write tool or button, run
`pnpm play --admin` (`--deploy` for deployments). Run `pnpm format:check` (or
`pnpm format`) before committing.
