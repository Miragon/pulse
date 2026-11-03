---
name: add-analytics-feature
description: Step-by-step house pattern for adding a new analytics capability, a PromQL query function in `packages/connectors/analytics/analytics-client` and one tool in `packages/connectors/analytics/analytics-connector` (normally a show tool with its view). Use whenever adding or changing process analytics ("add a query for X", "new KPI/metric analysis", "extend the analytics dashboard"), PromQL queries, Prometheus-backed tools, or analytics widgets. Takes precedence over generic mcp-use examples.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-analytics-feature — new query/tool/widget in the analytics module

Analytics is metric-first: query functions issue instant PromQL queries against
Prometheus (`/api/v1/query`) where the range window carries the time period, then map the
labeled samples into row shapes. There is no event store: anything that needs
per-instance event ordering is out of reach; say so in the description.

## Step 1 — query function in analytics-client

Add the function to `packages/connectors/analytics/analytics-client/src/queries/<topic>.ts` and export it
(plus its result types) from `src/queries/index.ts`. Always build selectors with the
helpers from `src/prometheus.ts` — never concatenate label values by hand:

- `escapeLabelValue(value)` — escapes `\` and `"` for use inside a label matcher
- `engineMatcher(engine)` — optional `engine_id="…"` / `engine_id=~"a|b"` fragment
- `selector(...matchers)` — assembles `{…}`, dropping empties
- `PERIOD_RANGE` / `PERIODS` / `Period` — the allowed windows (`1d`–`30d`, capped at
  retention); derive anything period-shaped from these — never copy the enum
- `increaseIn(series, window)` (`src/queries/helpers.ts`) — the ONE way to read a counter
  or histogram series over a window (contract rule 2): the plugin creates a series on its
  first event and `increase()`/`rate()` never count a series' first sample, so the first
  incident of a type at an activity would read 0. It counts a series born inside the window
  with its whole value: one silent in the hour before the window (where that hour lies
  past the retention, in the window's own first hour)
- `engineState(gauge, sel)` — the ONE way to read a gauge (contract rule 3): every node
  of a clustered engine reports the same engine-wide rows, so they are folded with
  `max by (<the gauge's contract labels>)` before anything sums them
- Durations are whole MILLISECONDS on the wire (contract rule 1) and in every result
  (`*Ms`, camelCase, the heatmap included: `BpmnHeatmapData.durationMs`)

Reference shape (from `elementHeat` in `src/queries/element.ts`):

```ts
import { METRIC_NAMES as M } from "../metric-names.js"

const sel = selector(
  `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`,
  engineMatcher(params.engine),
)

const inWindow = (series: string) => increaseIn(series, { range })

const [counts, sums] = await Promise.all([
  ch.instant(`sum by (activity_id)(${inWindow(`${M.activityEnded}${sel}`)})`),
  ch.instant(`sum by (activity_id)(${inWindow(`${M.activityDuration}_sum${sel}`)})`),
])
// sums are ms: `Math.round(sum / count)` for the heat's whole milliseconds
```

**Metric-name contract:** series names come from `METRIC_NAMES`
(`src/metric-names.ts`) — never raw `engine_*` literals; a guard test in
`src/metrics-contract.test.ts` fails on them. Histogram entries are the base name —
append `_sum`/`_count`/`_bucket` at the call site. The single source of truth is
`packages/connectors/analytics/analytics-client/metrics-contract.json`: if you need a _new_ metric or label,
change the contract first, then the Kotlin plugin
(`engine-plugins/cibseven-history-metrics/.../ProcessMetrics.kt` /
`EngineStateMetrics.kt`), `METRIC_NAMES`, and any alert rules / Grafana dashboards —
contract tests on both sides enforce consistency: the TS side also checks the Grafana
dashboards (incl. regex matchers), the alert rules' and dashboards' `sum by (…)`
grouping labels, `GAUGE_LABELS` against the gauges, millisecond `buckets` on every
histogram, and dead contract entries (documented allowlist in the test); the Kotlin side
checks the label keys each instrument attaches and the bucket bounds each histogram
registers. Don't weaken these guards. Keep labels model-bounded (never
instance ids, business keys, variable values).

**Label contract:** `src/metrics-contract-labels.test.ts` runs every exported query
function against a recording client and checks each label the sent PromQL names — matchers,
`by`/`without`, `on`/`ignoring`/`group_*` — against the labels the contract declares for
that series; alert rules and Grafana dashboards go through the same checker. The calls it
runs come from the `SCENARIOS` map in `src/query-scenarios.test-support.ts` (shared with the
honesty guard below), total over the `queries` namespace, so a new export without an entry
fails `pnpm typecheck`. Give the entry argument sets that switch on every optional matcher
(engine filter single and multi, element/incident scope, process scope present and
absent). A PromQL shape the checker (`src/promql-{parse,labels,sources}.test-support.ts`)
rejects means extending the checker, never bypassing it. The same file runs the reading
rules (`src/promql-reading-rules.test-support.ts`) over every sent query, the alert rules
and the dashboard panels: a counter or histogram outside the born-series count, or a gauge
not folded over exactly its contract labels, fails. Alert rules and dashboards spell the
count out in the exact shape `increaseIn` emits.

**Honesty rules** — `src/query-honesty.test.ts` runs the same scenarios and holds two more
total maps a new export must fill (`pnpm typecheck` fails otherwise): `NO_DATA` (what the
function returns against an empty Prometheus) and `SCOPE_ECHO` (how its result names the
engines it covers — `engines: engineIdsOf(params.engine)`, or a stated exemption). Build the
result so those entries can hold:

- `first()` (missing series → 0) only for COUNTS; durations and gauges use `firstOrNull()` —
  "nothing ended" is `null`, never 0 s. A per-key gauge (running, open incidents) has no row
  for what does not exist, so decide 0 vs `null` with the presence probe
  `reportingEnginesQuery` (`queries/helpers.ts`), never from the gauge's own series.
- Rates and deltas through `ratePct`/`pctChange`/`ppDelta` — `null` on a zero or unmeasured
  base, never 0 % or −100 %.
- Explicit time windows through `clampWindow` + `windowAt` (`queries/windows.ts`): clamped to
  `[now − retention, now]`, reported as measured (`partial`), refused when unrepairable; per-day
  rates from the exact `seconds`, never the rounded `daysOf`.

## Step 2 — PromQL snapshot test

Co-locate `<topic>.test.ts` next to the query. Use the mock-client pattern from
`src/queries/dashboard.test.ts`: a `vi.fn()`-backed `PrometheusClient` that dispatches
canned `PromSample[]` by inspecting the PromQL string, plus an assertion that **every**
issued query is correctly scoped:

```ts
const instant = vi.fn(async (q: string): Promise<PromSample[]> => {
  // durations answer in ms, the histogram's unit
  if (q.includes("histogram_quantile")) return [{ metric: { activity_id: "A" }, value: 15_000 }]
  return [{ metric: { activity_id: "A" }, value: 10 }]
})
const ch: PrometheusClient = { instant }

// …after calling the query function:
const queries = instant.mock.calls.map((c) => c[0])
expect(queries.every((q) => q.includes('process_definition_key="myKey"'))).toBe(true)
expect(queries.every((q) => q.includes("[30d]"))).toBe(true)
```

Also cover the mapping logic (ranking, thresholds, rounding, null fields), and add the
function's `SCENARIOS` entry (`src/query-scenarios.test-support.ts`) plus its `NO_DATA` and
`SCOPE_ECHO` entries in `src/query-honesty.test.ts` (Step 1).

## Step 3 — input schema

Add the tool's input schema to `packages/connectors/analytics/analytics-client/src/schemas/<topic>.ts` and
export it from `src/schemas/index.ts`. Reuse `engineFilterShape` from
`src/schemas/shared.ts` for the optional `engine` filter and `periodField` for the
`period` input (derived from `PERIODS` — never redeclare the period enum). Descriptions follow
the rule of the add-bpm-feature skill (reference: `engineCompareInput` in
`src/schemas/engine-compare.ts`, whose required `processDefinitionKey` says why); `engine`,
`period`, the A/B sides and `minBucketSize` are said once in `analyticsInstructions`
(`packages/connectors/analytics/analytics-connector/src/instructions.ts`).

**Defaults live in the schema.** `periodField` defaults to `7d` and each schema's
`minBucketSize` to 10: the tool takes the schema's `.shape` as is, so an omitted value
reaches the handler already defaulted and the model reads the default in tools/list. Never
re-add a `?? "7d"` in a handler; read the schema's `z.output` type if a field looks optional.

## Step 4 — show tool and view in analytics-connector (the default)

Each analytics question gets ONE tool, and normally that is a show tool: it renders a view
for the user and returns its figures to the model. The view chain mirrors the engine module:

1. Component in `packages/connectors/analytics/analytics-connector/src/widgets/`, taking a `data` prop.
   Widgets are browser code: at runtime they import only their own widgets, `src/messages`,
   `src/tool-names.ts`, `src/bpmn-names.ts`, `@miragon/pulse-widget-shell/widgets` and the view
   stack; the tools, the plugin, the module, `@miragon/pulse-analytics-client` and anything else
   only as types (`connector-widgets-are-browser-code` in `.dependency-cruiser.cjs`).
2. Register its view in `src/widgets/views.tsx` in `analyticsViews` under the show tool's
   name (an `ANALYTICS_SHOW_*` constant in `src/tool-names.ts`): one explicit component
   per view, taking `{ data }`. It wraps its widget in
   `<HostModelContext content={describeMyView(data)}>` only when the tool's `content` does
   not carry what the view shows (today: the heatmap, whose content is a summary). A
   dashboard is ONE component that stacks its widgets (`ViewStack`, each row in its own
   error boundary), every part taking the view's data as it is (reference:
   `src/widgets/analytics-dashboard/view.tsx`).
3. The view registry `apps/mcp-server/src/ui/view-registry.ts` spreads
   `analyticsViews` — verify your view arrives there.
   `apps/mcp-server/test/view-registry.test.ts` fails on any view-bound tool
   without a view.
4. Register an `analytics_show_*` tool in `src/widget-tools.ts` with
   `inputSchema: strictToolInput({ … })` (strict like the registrar: an
   unknown key is a tool error listing the valid ones — naming per the guide in the
   add-bpm-feature skill, e.g. `maxResults`, never `limit`; `activityId`, never `elementId`) and spread `...showToolBinding(TOOL_NAME, "Title")` (from
   `@miragon/pulse-widget-shell/server` — native `view` binding named after the tool + required
   passthrough `outputSchema` + the Apps-SDK `_meta` half; never hand-write
   `_meta.ui` keys, mcp-use owns them), returning `buildViewResult(view, JSON.stringify(result))`
   (`viewWithJson` in `src/widget-tools/shared.ts`): the `structuredContent` IS the view's
   data, the `content` the query result as compact JSON, without the `names` only the view
   needs (reference: `analytics_show_dashboard`). Only a widget that reads a feed itself (rendered without
   data, like the fleet's landscape, or refreshing in place) needs one: an app-only
   `*_data` feed spreads `...appOnly`
   (`visibility: "app"` + `openai/widgetAccessible`, **no** view binding) and returns
   `buildDataFeedResult(data)`. Both resolve `engine` through `withEngineScope` like the
   registrar tools, and the payload echoes the resolved `engines` so the view and the
   model read the scope from the DATA.

**Engine scope:** analytics reads only the server's configured engine ids
(`src/engine-ids.ts`) — a shared Prometheus holds other teams' engines too. Every handler
passes its args through `withEngineScope(engineScope, args)` (omitted `engine` = all configured
engines, any other id refused; with none configured it refuses fail-closed); a tool that takes
engine ids by another name resolves each with `engineScope.require(id, "<field>")` (see
`analytics_show_engine_compare`). Never hand `args` to a query unscoped.
`src/engine-scope.test.ts` sweeps every registered Prometheus-reading tool: add the new tool
to its `ARGS` map (total over the registered surface) with valid arguments minus `engine`.

Analytics tools are read-only by nature and talk to an external Prometheus:
`{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`. Analytics declares no
toolsets, so every tool reaches every deployment: each one is a read (`src/module.test.ts`
pins it). A write would first need a toolset vocabulary on the module.
Name each description honestly about metric limitations (e.g. "queue/wait time is not
available from metrics").

Rules while building:

- Compose the component from the design kit `@miragon/pulse-ui` and the view runtime
  `@miragon/pulse-widget-shell/widgets`: `ViewDataState` for the loading/error/no-data guard
  (`onRetry` required, a `skeleton` slot under a polite sr-only status) and `WidgetShell`
  from the view runtime; `Section`, `Th`/`Td`, `WidgetHeader` (no icon tile, `as` for the
  heading level), `KpiGrid` (incl. `variant="soft"`), `StatusBadge`/`CountPill`, the
  `TONE_*` maps and `cn` from pulse-ui; formatting via pulse-ui's `formatTimestamp`/`formatNumber`/`formatPercent`/`formatPercentPoints`/
  `formatPeriod`/`formatDuration`/`truncate` (canonical duration style "3m 7s", German
  "3 Min. 7 s"; "3,7 %", "+0,2 Pp.", "7 Tage"). Never re-inline these primitives, write
  local format helpers, or call `toFixed`, a `toLocaleString()` without a locale or a
  hand-built `Intl.NumberFormat`.
- Tables: widget-shell's `ListTable` (a named, keyboard-reachable scroll region with a
  required `ariaLabel`, so a wide breakdown never widens the document at 760 px;
  `hideBelow: "sm" | "md" | "lg"` on a column a narrow view can do without, by the
  region's width; `sticky: true` on the last column when it holds row actions; `sort` on
  the column the rows are ordered by; `groups` to head adjacent columns, like the
  landscape's "Load" and "Job backlog"; rows stay `<tr>` + `Td`, one cell per column,
  numbers `tabular-nums` right-aligned). Order columns by priority: the identifying
  column, then the sort key, then what can give way (`hideBelow`); the host simulation
  (`apps/mcp-server/test-host/analytics.spec.ts`, against `stub-prometheus.ts`)
  checks at 760 px that the promised columns show inside their region. Nothing to
  show: pulse-ui's `TableEmptyState` (`variant="done"` for "nothing failing", the quiet default for
  no data, the next step as `description`). Type on pulse-ui's scale: `text-section`
  for a card heading, `text-dense` for table text, `text-small` (13 px, the floor) for
  captions, never `text-xs` (`scanTypeScale` in `src/brand-gates.test.ts`).
- Names before ids (U13): metrics carry ids only; a view that lists processes or
  activities passes its payload through `src/named-views.ts` in the show tool AND its feed
  (one function each), which adds `names` from the injected BPMN lookup
  (`createNameLookup` in `src/bpmn-name-lookup.ts`, reading each diagram through widget-shell's
  `parseBpmnNames`, the rule the engine module names the same model by). Each model is read on the engines
  the view's rows come from (`engines`, or `enginesByKey` per process), in order, until
  one has it, so a process that runs only on a later engine is named too. An engine's
  answer is kept five minutes PER CALLER (`callerCacheKey` from widget-shell: under
  passthrough auth the engine answers with the caller's own permissions, so one caller's names never reach
  another); `null` from the injected `FetchBpmnXml` means "not deployed there" and is
  kept, a failed read REJECTS and is never kept. A view waits 2 s at most and reads up
  to 40 keys, named by priority (the dashboard: its scope, then the activities'
  processes, then the breakdown's). The widget shows the design kit's `NamedId`
  (`@miragon/pulse-ui`: the name first, the id quiet in mono below, the id
  alone in mono without a name; one look with the engine module) and an activity's type in words
  (`activityTypeLabel`, `src/widgets/names.ts`).
- A count nobody measured is `null` and renders "—" through `Figure`
  (`src/widgets/figure.tsx`: the reason is read out in its place and is its tooltip),
  one meaning everywhere, and the table puts `FigureLegend` under it (the reasons that
  occur, one line each), so keyboard and touch readers get the meaning too; a silent
  engine's counts are null, never 0. A known "none" is words, never "—" ("Kein
  Prozess"). A different state (a process not deployed on an engine) gets its own sign
  and a legend line.
- The heatmap is this module's `BpmnHeatmapWidget` (`src/widgets/heatmap/`): ONE hue from `--cd-info-soft` to
  `--cd-blau` (red is for incidents), every element above zero at a visible minimum, a
  legend with the smallest and largest value (`HeatmapLegend` `min`/`max`, formatted),
  the values per element as a table under the diagram (`HeatValuesTable`), the frame
  height from the diagram's size (its height at the scale bpmn-js draws it, 240–560 px)
  and the paper light in every theme; the legend's ends are exact: the ramp maps the
  range linearly (`heatIntensity`).
- Status and comparison colour come from pulse-ui's tone model (`ToneVariant`, `TONE_*`
  maps, `resolveTone` for a tone from the wire, CLAUDE.md invariant 6): a dot, edge or icon next to neutral digits, black text on a tint
  (`TONE_SOFT`), `TONE_INK` only for words in a tone directly on the card (an inline error);
  volume (starts) and suppressed comparisons stay `neutral`, red is `danger` and only for
  incidents/failures. A count of what happened (new incidents included) carries no tone;
  the open incident and the job without retries (`failedJobs` in health and the landscape)
  are the states: a danger dot on its KPI, `StateCount` in a table (`src/widgets/figure.tsx`: a danger
  `CountPill` while there is any, by widget-shell's `countTone`, the ladder the engine module edges the same
  counts by; none is a plain number). A rate is judged only against a reference, never on its own: the dashboard's
  incident rate against the period before (`previous` in `dashboardData`, the trend of its
  `KpiCell`, `deltaVerdict` with the comparisons' threshold, "not reliable" under the
  comparisons' default `minBucketSize` of 10), and only with the process held fixed: over several processes
  the rate is a total over their mix and moves with it, so the trend names the previous
  rate without a verdict, direction or colour (`incidentRateTrend`). A bar scales to the largest value in its table, never to 100, and is a magnitude
  in the data-viz blue (`TONE_DOT.info`), never a state colour.
  No palette classes or raw colours.
- Icons are Lucide via `Icon` (devDependency `lucide-react` `1.61.0`, see invariant 6), never
  glyphs or emoji, at 16 px (`dense` in rows and chips; no `size` other than 16 or 24). A chat
  hand-off is widget-shell's `<HandOffButton action="findCause" prompt={ask(…)} />`: the product's
  one table of functions with their Lucide icon and a label that names the chat, the same as
  the engine module's (`AskAiButton` is banned in connector widgets; a new function goes into
  widget-shell). Copy follows the brand voice in en + de; the package's brand-gate test
  runs `catalogTextFindings` over both catalogs, `scanGlyphs` over `src/widgets` +
  `src/messages`, `scanIconSizes` and `scanColors` over `src/widgets`
  (`@miragon/pulse-ui/testing`). The words come from `src/messages/GLOSSARY.md`
  ("nicht belastbar", "Zeitraum" …, plus widget-shell's `PRODUCT_GLOSSARY`
  (`@miragon/pulse-widget-shell/testing`) shared with the engine module:
  "Incident", "Jobs ohne Versuche", "bereitgestellt" …; `glossary.test.ts` rejects the
  synonyms both rule out), counted entries are `plural(…)` and take the count formatted.
- Only the heatmap words a summary for the model, in English through `summaryT`
  (`src/summary.ts`, an `aSum.*` entry in `src/messages/en.server.ts`); every other show
  tool returns its result as JSON. A show tool sets no view title: the widget's heading
  names the view in the host's language.
- Every data view states its reference frame under its title with widget-shell's `ViewMeta`:
  `formatLookback(data.period)`, `enginesMeta(data.engines, reporting)`
  (`src/widgets/view-meta.ts`) and the result's `asOf` (every analytics-client view
  result carries it). A comparison judges only quality metrics, from their threshold on
  (`deltaVerdict` in `src/widgets/comparison-shared.tsx`); volume stays neutral and a
  suppressed comparison reads "nicht belastbar".
- Self-fetching widgets guard skeleton + error via `QueryFallback` (+ `TableSkeleton`):
  a missing `isError` branch means an eternal skeleton, and `onRetry` (the query's
  `refetch`) is required. The error words itself through widget-shell's `describeError`:
  "Prometheus ist nicht erreichbar", a timeout, a tool this server lacks … each with
  what you can do, the raw text collapsed under the "Details" of pulse-ui's `ErrorState`;
  `errorTitle` (`aCommon.loadError` in the self-fetch of `EngineLandscapeWidget`) heads only a failure `describeError`
  cannot classify. The heatmap's import error is an inline `ErrorState` (`errorTitle`,
  `errorHint`, the parser's text under Details).
- The model description (today only the heatmap's `describeBpmnHeatmap` in
  `src/widgets/model-descriptions.ts`, named directly in the view's
  `<HostModelContext content={…}>`) returns `modelContextText(…)`: a static `summary`, data
  only in `ids`/`facts`/`untrusted`, no tool named; Ask-AI hand-offs go through
  `useHandOff()` (`src/widgets/hand-off.ts`). Both state the scope of the data on
  screen: `engine: engineIdsOf(data.engines)` (the resolved, configured ids — never
  a widget's `engine` prop, which only feeds its self-fetch), `period`/key from the
  echo; a null figure is left out, never sent as 0. CLAUDE.md invariant 6;
  `scripts/hand-off-refs.test.mjs` rejects a hand-written text.
- Naming is load-bearing: `apps/mcp-server/test/widget-contract.e2e.test.ts` enforces
  the widget `_meta` on every `*_show_*` tool and app-only visibility on every `*_data`
  feed **by name**.

## Step 5 — registrar tool (the exception: a read without a view)

A read the user does not need to see, today only `analytics_engine_health`, registers
through the registrar instead of a show tool: in
`packages/connectors/analytics/analytics-connector/src/tools/<topic>.ts`, wired in
`src/tools/index.ts`, it returns its result to the model as JSON without a view. Reference:
`analytics_engine_health` from `src/tools/health.ts`:

```ts
export function registerHealthTools(
  register: ToolRegistrar<PrometheusClient>,
  engineScope: AnalyticsEngineScope,
) {
  register({
    name: "analytics_engine_health",
    category: "analytics",
    description: "Live operational health of the CIB Seven engine(s) …",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: schemas.engineHealthInput.shape,
    handler: async (ch, args, ctx) =>
      queries.engineHealth(withCallerSignal(ch, ctx?.signal), {
        engine: engineScope.resolve(args.engine),
        // …
      }),
  })
}
```

A new domain file adds its `registerXyzTools(register, engineScope)` call to `registerTools`
in `src/tools/index.ts`. Engine scope, annotations and honest descriptions follow Step 4.

## Step 6 — verify

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

A new or changed tool changes the wire surface: add its name to
`apps/mcp-server/test/expected-tools.ts`, then refresh the per-toolset goldens with
`GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server test` and commit the
`test/__golden__/` diff. The budget of each toolset counts the model-visible tools/list text
plus the server instructions. If `char-budgets.json` grew, `pnpm lint` fails until the commit
carries a `Ratchet-Exception: <why the model must read more>` trailer — trim wording first.
An engine widget that names an analytics feed by raw string (today only the probe,
`analytics_engine_landscape_data`) is checked against the admin golden by
`scripts/tool-name-refs.test.mjs` (so refresh the goldens first): renaming a feed fails there.
The engine module shows analytics' UI only through the host widgets (`analyticsHostWidgets` in
`src/widgets/views.tsx`): `analytics:engine-landscape` in its fleet view,
`analytics:process-heatmap` and `analytics:process-heatmap-legend` in its process flow. A host
widget fetches its own data and reads its props as untyped input
(`readProcessHeatmapProps`; props outside the contract call the caller's `onUnavailable`, so
the engine falls back to its incidents); the ids and props are a contract, pinned here
(`src/widgets/process-heatmap.test.tsx`) and on the engine side, rendered together by the
app's `test:host` (the process flow in Frequency and Duration), and the app's
`view-registry.test.ts` holds each id the engine renders to a registered widget.

`pnpm test` runs the query snapshot tests; `pnpm typecheck` is the **only** check that
covers widget `.tsx` code (`tsc -p tsconfig.widgets.json`). For end-to-end verification:
`pnpm play` (the playground's engine and Prometheus emit real metrics; it builds and starts the
server against them), then call the tool in the inspector at
`http://localhost:8400/mcp/inspector`. Run `pnpm format:check` before committing.
