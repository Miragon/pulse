---
name: add-analytics-feature
description: Step-by-step house pattern for adding a new analytics capability — a PromQL query function in `packages/connectors/analytics/analytics-client`, a tool in `packages/connectors/analytics/analytics-connector`, and optionally a dashboard widget. Use whenever adding or changing process analytics ("add a query for X", "new KPI/metric analysis", "extend the analytics dashboard"), PromQL queries, Prometheus-backed tools, or analytics widgets. Takes precedence over generic mcp-use examples.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# add-analytics-feature — new query/tool/widget in the analytics module

Analytics is metric-first: query functions issue instant PromQL queries against
Prometheus (`/api/v1/query`) where the range window carries the time period, then map the
labeled samples into row shapes. There is no event store — anything that needs
per-instance event ordering is out of reach and must be documented as such (see the
`avg_wait_sec: null` notes in `queries/element.ts`).

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
- Durations are whole MILLISECONDS on the wire (contract rule 1); the result models stay
  in seconds (`*_sec`, via `secondsOf`/`secondsOrNull`) or ms (`*Ms`) as they always were

Reference shape (from `elementBottleneck` in `src/queries/element.ts`):

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
// sums are ms: secondsOf(sum / count) for an `*_sec` field
```

**Metric-name contract:** series names come from `METRIC_NAMES`
(`src/metric-names.ts`) — never raw `camunda_*` literals; a guard test in
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
`src/queries/element.test.ts`: a `vi.fn()`-backed `PrometheusClient` that dispatches
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
`period` input (derived from `PERIODS` — never redeclare the period enum), and
`.describe()` every field (see `elementBottleneckInput` in `src/schemas/path.ts`).

**No zod default on an input a user setting supplies.** `periodField` defaults to `7d`
for the query's own callers; at the TOOL boundary a default would fill an omitted
`period` before the handler sees it, and the user's saved look-back
(`profile.modules.analytics.defaultPeriod`) would never apply. The tool therefore
overrides `period` and `minBucketSize` with `optionalPeriod` / `optionalMinBucketSize`
from `analytics-connector/src/settings.ts` and falls back through `settingsFor` (Step 4).
The same holds for any new setting: optional at the boundary, defaulted in the handler.

## Step 4 — tool in analytics-connector

Register the tool in `packages/connectors/analytics/analytics-connector/src/tools/<topic>.ts` through the registrar
(wired in `src/tools/index.ts`). Reference — `analytics_element_bottleneck` from
`src/tools/element.ts`:

```ts
type Register = ReturnType<typeof createToolRegistrar<PrometheusClient>>

export function registerElementTools(
  register: Register,
  engineScope: AnalyticsEngineScope,
  profileStore?: ProfileSource,
) {
  register({
    name: "analytics_element_bottleneck",
    category: "analytics",
    description: "Rank activities by execution-time contribution and incident rate …",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      ...schemas.elementBottleneckInput.shape,
      period: optionalPeriod,
      minBucketSize: optionalMinBucketSize,
    },
    handler: async (ch, args, ctx) => {
      const settings = await settingsFor(profileStore, ctx)
      return queries.elementBottleneck(ch, {
        ...withEngineScope(engineScope, args),
        period: args.period ?? settings.defaultPeriod,
        minBucketSize: args.minBucketSize ?? settings.minBucketSize,
      })
    },
  })
}
```

**Engine scope:** analytics reads only the server's configured engine ids
(`src/engine-ids.ts`) — a shared Prometheus holds other teams' engines too. Every handler
passes its args through `withEngineScope(engineScope, args)` (omitted `engine` = all configured
engines, any other id refused; with none configured it refuses fail-closed); a tool that takes
engine ids by another name resolves each with `engineScope.require(id, "<field>")` (see
`analytics_engine_compare`). Never hand `args` to a query unscoped.
`src/engine-scope.test.ts` sweeps every registered Prometheus-reading tool: add the new tool
to its `ARGS` map (total over the registered surface) with valid arguments minus `engine`.

Analytics tools are read-only by nature and talk to an external Prometheus:
`{ readOnlyHint: true, idempotentHint: true, openWorldHint: true }`. The analytics registrar
is not toolset-filtered — `analytics:read-only`, the default without OAuth, stays honest only
while every registrar tool is a read. Anything that writes durably gates itself like
`analytics_save_settings` (`allowsDurableWrites` in `src/toolsets.ts`).
New domain file → add the `registerXyzTools(register, engineScope, profileStore)` call to
`registerTools` in `src/tools/index.ts`. Name the description honestly about metric
limitations (e.g. "queue/wait time is not available from metrics").

## Step 5 — dashboard widget (only for UI features)

The widget chain mirrors the camunda7 module:

1. Component in `packages/connectors/analytics/analytics-connector/src/widgets/`, taking a `data` prop.
2. Register it in `src/widgets/index.ts` in `analyticsWidgets` via
   `adaptDataWidget(MyWidget, "analytics:<dataType>")` (from
   `@miragon/pulse-widget-shell/ui`).
3. Add the widget entry (`id`, `description`, `requires`/`consumes`, `size`, optional
   `propsSchema`) to `src/definition.ts`, with `...builderText("widget.<slug>")` — the view
   builder's title and one-line summary for people, `builder.widget.<slug>.title|summary`
   in `messages/{en,de}.builder.ts` — and `.meta(fieldText("<schema>.<field>"))` on every
   top-level `propsSchema` field (`builder.field.*`, the props sheet's label and help
   line; never a nested one, whose text the toolkit would hand to the model);
   `description` stays the model's text. `src/builder-texts.test.ts` fails on anything
   the builder would still show by its id and on any builder text the model would read.
4. The host map `apps/mcp-server-camunda7/src/ui/widget-registry.ts` spreads
   `analyticsWidgets` — verify your widget arrives there.
5. Register an `analytics_show_*` tool in `src/widget-tools.ts` with
   `inputSchema: strictToolInput({ … })` (strict like the registrar's `strictInput`: an
   unknown key is a tool error listing the valid ones — naming per the guide in the
   add-bpm-feature skill, e.g. `maxResults`, never `limit`; `activityId`, never `elementId`) and spread `...showToolBinding(TOOL_NAME, "Title")` (from
   `@miragon/pulse-widget-shell/server` — native `view` binding named after the tool + required
   passthrough `outputSchema` + the Apps-SDK `_meta` half; never hand-write
   `_meta.ui` keys, mcp-use owns them), returning `buildComposedView(...)` /
   `buildSingleWidgetView(...)` from `@miragon/pulse-widget-shell/server` (see
   `analytics_show_dashboard`). An app-only `*_data` feed spreads `...appOnly`
   (`visibility: "app"` + `openai/widgetAccessible`, **no** view binding) and returns
   `buildDataFeedResult(data)`. Both resolve `engine` through `withEngineScope` like the
   registrar tools, and the payload echoes the resolved `engines` so the widget's
   `describeForModel` names the scope from the DATA (`src/widgets/model-descriptions.ts`).
   A pipeline step (`src/steps/`) reads its keys through the strict readers in
   `steps/app-config.ts` (`stepEngines`, `stepPeriod`, …) — step keys arrive unchecked, and a
   malformed one is refused, never read as "omitted".

Rules while building:

- Compose the component from `@miragon/pulse-widget-shell/widgets` and the toolkit
  `@miragon/mcp-toolkit-ui` — `ViewDataState` for the loading/error/no-data guard
  (`onRetry` required, a `skeleton` slot under a polite sr-only status),
  `Section`, `Th`/`Td`, `WidgetShell` from the kit; `WidgetHeader` (no
  icon tile, `as` for the heading level), `KpiGrid` (incl. `variant="soft"`),
  `StatusBadge`/`CountPill`, the `TONE_*` maps and `cn` from the toolkit;
  formatting via `formatTimestamp`/`formatNumber`/`formatPercent`/`formatPercentPoints`/
  `formatPeriod`/`formatDuration`/`truncate` (canonical duration style "3m 7s", German
  "3 Min. 7 s"; "3,7 %", "+0,2 Pp.", "7 Tage"). Never re-inline these primitives, write
  local format helpers, or call `toFixed`, a `toLocaleString()` without a locale or a
  hand-built `Intl.NumberFormat`.
- Tables: the kit's `ListTable` (a named, keyboard-reachable scroll region with a
  required `ariaLabel`, so a wide breakdown never widens the document at 760 px;
  `hideBelow: "sm" | "md" | "lg"` on a column a narrow view can do without, by the
  region's width; `sticky: true` on the last column when it holds row actions; `sort` on
  the column the rows are ordered by; `groups` to head adjacent columns, like the
  landscape's "Load" and "Job backlog"; rows stay `<tr>` + `Td`, one cell per column,
  numbers `tabular-nums` right-aligned). Order columns by priority: the identifying
  column, then the sort key, then what can give way (`hideBelow`); the host simulation
  (`apps/mcp-server-camunda7/test-host/analytics.spec.ts`, against `stub-prometheus.ts`)
  checks at 760 px that the promised columns show inside their region. Nothing to
  show: `TableEmptyState` (`variant="done"` for "nothing failing", the quiet default for
  no data, the next step as `description`). Type on the toolkit's scale: `text-section`
  for a card heading, `text-dense` for table text, `text-small` (13 px, the floor) for
  captions, never `text-xs` (`scanTypeScale` in `src/brand-gates.test.ts`).
- Names before ids (U13): metrics carry ids only; a view that lists processes or
  activities passes its payload through `src/named-views.ts` in the show tool, its feed
  AND its step (one function each), which adds `names` from the injected BPMN lookup
  (`createNameLookup` in `src/bpmn-name-lookup.ts`, reading each diagram through the kit's
  `parseBpmnNames`, the rule camunda7 names the same model by). Each model is read on the engines
  the view's rows come from (`engines`, or `enginesByKey` per process), in order, until
  one has it, so a process that runs only on a later engine is named too. An engine's
  answer is kept five minutes PER CALLER (`callerCacheKey` from widget-shell: under
  passthrough auth the engine answers with the caller's own permissions, so one caller's names never reach
  another); `null` from the injected `FetchBpmnXml` means "not deployed there" and is
  kept, a failed read REJECTS and is never kept. A view waits 2 s at most and reads up
  to 40 keys, named by priority (the dashboard: its scope, then the activities'
  processes, then the breakdown's). The widget shows the kit's `NamedId`
  (`@miragon/pulse-widget-shell/widgets`: the name first, the id quiet in mono below, the id
  alone in mono without a name; one look with camunda7) and an activity's type in words
  (`activityTypeLabel`, `src/widgets/names.ts`).
- A count nobody measured is `null` and renders "—" through `Figure`
  (`src/widgets/figure.tsx`: the reason is read out in its place and is its tooltip),
  one meaning everywhere, and the table puts `FigureLegend` under it (the reasons that
  occur, one line each), so keyboard and touch readers get the meaning too; a silent
  engine's counts are null, never 0. A known "none" is words, never "—" ("Kein
  Prozess"). A different state (a process not deployed on an engine) gets its own sign
  and a legend line.
- The heatmap is the kit's `BpmnHeatmapWidget`: ONE hue from `--cd-info-soft` to
  `--cd-blau` (red is for incidents), every element above zero at a visible minimum, a
  legend with the smallest and largest value (`HeatmapLegend` `min`/`max`, formatted),
  the values per element as a table under the diagram (`HeatValuesTable`), the frame
  height from the diagram's size (its height at the scale bpmn-js draws it, 240–560 px)
  and the paper light in every theme; the legend's ends are exact: the ramp maps the
  range linearly (`heatIntensity`).
- Status and comparison colour come from the toolkit's tone model (`ToneVariant`, `TONE_*`
  maps, `resolveTone` for a tone from the wire, CLAUDE.md invariant 6): a dot, edge or icon next to neutral digits, black text on a tint
  (`TONE_SOFT`), `TONE_INK` only for words in a tone directly on the card (an inline error);
  volume (starts) and suppressed comparisons stay `neutral`, red is `danger` and only for
  incidents/failures. A count of what happened (new incidents included) carries no tone;
  the open incident and the job without retries (dead jobs, an engine's failed jobs) are the
  states: a danger dot on its KPI, `StateCount` in a table (`src/widgets/figure.tsx`: a danger
  `CountPill` while there is any, by the kit's `countTone`, the ladder camunda7 edges the same
  counts by; none is a plain number). A rate is judged only against a reference, never on its own: the dashboard's
  incident rate against the period before (`previous` in `dashboardData`, the trend of its
  `KpiCell`, `deltaVerdict` with the comparisons' threshold, "not reliable" under the
  saved `minBucketSize`), and only with the process held fixed: over several processes
  the rate is a total over their mix and moves with it, so the trend names the previous
  rate without a verdict, direction or colour (`incidentRateTrend`). A bar scales to the largest value in its table, never to 100, and is a magnitude
  in the data-viz blue (`TONE_DOT.info`), never a state colour.
  No palette classes or raw colours.
- Icons are Lucide via `Icon` (devDependency `lucide-react` `1.61.0`, see invariant 6), never
  glyphs or emoji, at 16 px (`dense` in rows and chips; no `size` other than 16 or 24). A chat
  hand-off is the kit's `<HandOffButton action="findCause" prompt={ask(…)} />`: the product's
  one table of functions with their Lucide icon and a label that names the chat, the same as
  camunda7's (`AskAiButton` is banned in connector widgets; a new function goes into the
  kit). Copy follows the brand voice in en + de; the package's brand-gate test
  runs `catalogTextFindings` over both catalogs, `scanGlyphs` over `src/widgets` +
  `src/messages`, `scanIconSizes` and `scanColors` over `src/widgets`
  (`@miragon/pulse-widget-shell/testing`). The words come from `src/messages/GLOSSARY.md`
  ("nicht belastbar", "Zeitraum" …, plus the kit's `PRODUCT_GLOSSARY` shared with camunda7:
  "Incident", "Jobs ohne Versuche", "bereitgestellt" …; `glossary.test.ts` rejects the
  synonyms both rule out), counted entries are `plural(…)` and take the count formatted.
- A show tool words its result with `const { t, title } = await localizeViewFor(store, ctx)`:
  `title("…")` for the view title (none while the profile follows the host),
  `t("…")` for the model summary; `src/view-title.test.ts` sweeps every show tool.
- Every data view states its reference frame under its title with the kit's `ViewMeta`:
  `formatLookback(data.period)`, `enginesMeta(data.engines, reporting)`
  (`src/widgets/view-meta.ts`) and the result's `asOf` (every analytics-client view
  result carries it). A comparison judges only quality metrics, from their threshold on
  (`deltaVerdict` in `src/widgets/comparison-shared.tsx`); volume stays neutral and a
  suppressed comparison reads "nicht belastbar".
- Self-fetching widgets guard skeleton + error via `QueryFallback` (+ `TableSkeleton`):
  a missing `isError` branch means an eternal skeleton, and `onRetry` (the query's
  `refetch`) is required. The error words itself through the kit's `describeError`:
  "Prometheus ist nicht erreichbar", a timeout, a tool this server lacks … each with
  what you can do, the raw text collapsed under the toolkit `ErrorState`'s "Details";
  `errorTitle` (`aCommon.loadError` in `QueryGate`) heads only a failure the kit cannot
  classify. The heatmap's import error is an inline `ErrorState` (`errorTitle`,
  `errorHint`, the parser's text under Details).
- A save confirms in a toast and says why it failed there too (the kit's
  `useActionFeedback().succeeded/failed`, reference: `settings-section.tsx`).
- The model description (`adaptDataWidget`'s third argument, in
  `src/widgets/model-descriptions.ts`) returns `modelContextText(…)` with
  `surface: ANALYTICS_ONLY_SURFACE` — a static `summary`, data only in
  `ids`/`facts`/`untrusted`, tools only in `tools`; Ask-AI hand-offs go through
  `useHandOff()` (`src/widgets/hand-off.ts`). Both state the scope of the data on
  screen: `engine: engineIdsOf(data.engines)` (the resolved, configured ids — never
  the cell's `engine` prop, which only feeds the self-fetch), `period`/key from the
  echo; a null figure is left out, never sent as 0. CLAUDE.md invariant 6;
  `apps/mcp-server-camunda7/test/hand-off-surface.test.ts` rejects a hand-written text.
- Naming is load-bearing: `apps/mcp-server-camunda7/test/widget-contract.e2e.test.ts` enforces
  the widget `_meta` on every `*_show_*` tool and app-only visibility on every `*_data`
  feed **by name**; `src/widgets/catalogue-sync.test.ts` keeps `definition.ts` ↔
  `analyticsWidgets` in sync.

## Step 6 — verify

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

A new or changed tool changes the wire surface: add its name to
`apps/mcp-server-camunda7/test/expected-tools.ts`, then refresh the per-toolset goldens with
`GOLDEN_UPDATE=1 pnpm --filter @miragon/pulse-mcp-server-camunda7 test` and commit the
`test/__golden__/` diff. If `char-budgets.json` grew, `pnpm lint` fails until the commit
carries a `Ratchet-Exception: <why the model must read more>` trailer — trim wording first.
A camunda7 widget that names an analytics feed by raw string is checked against the booted
surface by `test/tool-name-refs.test.ts` — renaming a feed fails there.

`pnpm test` runs the query snapshot tests; `pnpm typecheck` is the **only** check that
covers widget `.tsx` code (`tsc -p tsconfig.widgets.json`). For end-to-end verification:
`docker compose -f playground/docker/docker-compose.yml up -d` (engines + Prometheus emit real
metrics), `pnpm dev`, then call the tool in the inspector at
`http://localhost:8400/mcp/inspector`. Run `pnpm format:check` before committing.
