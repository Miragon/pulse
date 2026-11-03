# @miragon/pulse-analytics-connector

[![npm](https://img.shields.io/npm/v/@miragon/pulse-analytics-connector?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-analytics-connector)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Process analytics for Camunda 7 engines in any MCP host: KPIs, bottlenecks and engine
comparisons from Prometheus as `analytics_*` tools and dashboards.

## Install

```sh
npm install @miragon/pulse-analytics-connector @miragon/pulse-widget-shell
npm install react react-dom zod lucide-react bpmn-js@18.31.1 @miragon/pulse-ui mcp-use@2.12.2
```

To build your own MCP server on it, start from [pulse-starter](https://github.com/Miragon/pulse-starter).

## Overview

The **analytics module** for [Pulse](../../../../README.md): Prometheus-backed process analytics as
`analytics_*` MCP tools, plus dashboard and comparison widgets. Built on
[`@miragon/pulse-analytics-client`](../analytics-client), `@miragon/pulse-ui` and
`@miragon/pulse-widget-shell`.

The server loads this module as `analytics` via `analyticsModule` (`src/module.ts`), which conforms
structurally to the `ComposableModule` port of `@miragon/pulse-widget-shell/server`. The package is
published to npm in lockstep with the other `@miragon/pulse-*` packages (pin them all to one
version); the [pulse-starter](https://github.com/Miragon/pulse-starter) template shows how to
compose it into your own MCP server.

The consumer-shared libraries are ranged **peer dependencies** so they dedupe against your app's
copy: `react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/pulse-ui` and
`@miragon/pulse-widget-shell` `^<this release>` (the design kit the widgets compose from, and the
view runtime and boot your server shares with every module), `lucide-react` `^0.562.0 || ^1.0.0`
(the widgets' icons; pin a 1.x copy (this repo pins 1.61.0): widget-shell's view root imports
`LucideProvider`, which 0.x lacks, so a deduped 0.x copy fails the bundle build). Your view
bundle's Vite config spreads widget-shell's `VIEW_BUNDLE_DEDUPE` into `resolve.dedupe`. `bpmn-js`
is a peer (`^18.31.1`): the widgets draw BPMN diagrams. **`mcp-use` is exactly pinned**: pin
it to `mcp-use@2.12.2` in your app. A duplicate `mcp-use` instance breaks the React context and
hangs every in-widget query on "Loading…".

## What it provides

- **One tool per question**, each running PromQL through
  [`@miragon/pulse-analytics-client`](../analytics-client): `show_dashboard` (a period's flows,
  durations and live state per process and per activity), `show_period_compare` (two periods,
  e.g. around a deployment), `show_version_compare`, `show_engine_compare`,
  `show_engine_landscape` and `show_bpmn_heatmap`. Each renders a view (`src/widgets/`) and
  returns its figures to the model as compact JSON (the heatmap: a summary).
- **`analytics_engine_health`** (`src/tools/`) returns JSON without a view: a live WIP, incidents, backlog
  and alerts snapshot. The incidents open right now and their instances are the
  [engine module](../../engine/engine-connector)'s.
- **Configured engines only:** analytics reads exactly the server's configured engine ids:
  `createPlugin({ engineIds })` (a composed server injects the engine module's engines through
  `analyticsModule`'s shared `engineIds`), else `ANALYTICS_ENGINE_IDS` for a standalone boot.
  Without either, every analytics tool refuses (fail-closed) instead of reading every `engine_id`
  a shared Prometheus holds. Every tool takes an optional `engine` filter (one configured id or a
  list); omitted, it covers all configured engines and the result's `engines` names them; any
  other id is refused. Analytics are session-independent.
- **No toolsets:** every analytics tool is a read (`src/module.test.ts` pins it), so the module
  declares no toolset vocabulary and a suffix on it (`:read-only`, `:standard`) is ignored with a
  warning.

### Cross-engine: overview, not scoreboard

Engines host different process definitions, so a failure rate, incident rate or duration aggregated
per engine describes that engine's **process mix**, not the engine. The same aggregation can even
invert the per-process truth. Two consequences run through the module:

- `show_engine_landscape` is the cross-engine view. It reports the process × engine inventory, absolute
  counts (running instances, open incidents, failed jobs) and the engine-owned job backlog
  (`jobs_executable`, `jobs_suspended`, `jobs_due_future`, `external_tasks_open`), the one metric
  family whose contract labels are `engine_id` only, so no process mix can confound it. It covers
  every configured engine, so one that reports nothing still gets a row (`reporting: false`).
- `show_engine_compare` **requires** a `processDefinitionKey`. Holding the process fixed on both
  sides is what makes a delta attributable to the engine; the landscape's `sharedProcessKeys`
  lists the definitions that qualify.

These tools read the `engine_*` series emitted by the
[engine metrics plugin](../../../../engine-plugins). Per-instance drill-down (search by variable) is **not**
metric-backed: use the `engine_query_historic_*` tools in the [engine module](../../engine/engine-connector).

The BPMN heatmap gets its diagram XML via an injected `fetchBpmnXml` shared resource (wired by the
host app from the engine module), and the dashboard and the landscape read
the process and activity names behind their ids through the same lookup (`bpmn-name-lookup.ts`).
This package has **no** engine-SDK dependency: the heatmap
degrades gracefully without it and the views show ids. `fetchBpmnXml(key, engineId?)` reads on the
named engine (the default one without), resolves `null` for a key not deployed there and rejects a
failed read; the views ask the engines their rows come from, and the names are cached per caller
(under passthrough auth the engine answers with each caller's own permissions).

## Adding an analytics capability

Read the [`add-analytics-feature`](../../../../.claude/skills/add-analytics-feature) skill first. The house
pattern: add a PromQL query function in [`@miragon/pulse-analytics-client`](../analytics-client) (using
`METRIC_NAMES`, never raw metric strings), then one show tool and its view here (a registrar tool
only for a read that needs no view). Metric names
and labels are governed by the
[metrics contract](../analytics-client/metrics-contract.json). Change it there first.

## Layout

| Path                  | Contents                                                    |
| --------------------- | ----------------------------------------------------------- |
| `src/tools/`          | The engine health read (`index.ts` wires it)                |
| `src/widget-tools.ts` | `show_*` dashboard/comparison widget tools                  |
| `src/widgets/`        | React dashboard + comparison widgets                        |
| `src/module.ts`       | `analyticsModule` (env mapping, `PROMETHEUS_URL` boot hint) |
| `src/plugin.ts`       | `createPlugin`: the module's `register(server)`             |
