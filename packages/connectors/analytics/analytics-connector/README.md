# @miragon/pulse-analytics-connector

[![npm](https://img.shields.io/npm/v/@miragon/pulse-analytics-connector?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-analytics-connector)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Process analytics for Camunda 7 engines in any MCP host: KPIs, bottlenecks, failures and engine
comparisons from Prometheus as `analytics_*` tools and dashboards.

## Install

```sh
npm install @miragon/pulse-analytics-connector @miragon/pulse-widget-shell
npm install react react-dom zod lucide-react bpmn-js@18.31.0 @miragon/mcp-toolkit-core @miragon/mcp-toolkit-ui mcp-use@2.7.3
```

To build your own MCP server on it, start from [pulse-starter](https://github.com/Miragon/pulse-starter).

## Overview

The **analytics module** for [Pulse](../../../../README.md): Prometheus-backed process analytics as
`analytics_*` MCP tools, plus dashboard and comparison widgets. Built on
[`@miragon/pulse-analytics-client`](../analytics-client) and the `@miragon/mcp-toolkit-*` packages.

The server loads this module as `analytics` via `analyticsModule` (`src/module.ts`), which conforms
structurally to the app's `ModuleDefinition` port. The package is published to npm in lockstep with
the other `@miragon/pulse-*` packages (pin them all to one version); the
[pulse-starter](https://github.com/Miragon/pulse-starter) template shows how to compose it
into your own MCP server.

The consumer-shared libraries are ranged **peer dependencies** so they dedupe against your app's
copy: `react`/`react-dom` `^19.2.0`, `zod` `^4.4.0`, `@miragon/mcp-toolkit-*` `~2.8.1`,
`lucide-react` `^0.562.0 || ^1.0.0` (the widgets' icons; add it to your `dedupe` list like the
widget-shell kit asks, and pin 1.47.0 or newer: the toolkit's chrome (2.7 and later) imports `LucideProvider`,
which 0.x lacks, so a deduped 0.x copy fails the bundle build). **`mcp-use` is exactly pinned**:
pin it to `mcp-use@2.7.3` in your app. A duplicate `mcp-use` instance breaks the React context and
hangs every in-widget query on "Loading…".

## What it provides

- **Analytics tools** (`src/tools/`): `analyze_process_performance`, `compare_execution_periods`,
  `element_bottleneck`, `find_failed_instances`, `cluster_compare`, `version_compare`,
  `engine_landscape`, `engine_compare`, and `engine_health` (a live WIP / incidents / backlog /
  alerts snapshot). All carry the `analytics` category and run PromQL through
  [`@miragon/pulse-analytics-client`](../analytics-client).
- **Widgets** (`src/widgets/`): `show_dashboard`, `show_failure_dashboard`, `show_cluster_compare`,
  `show_version_compare`, `show_engine_landscape`, `show_engine_compare`, `show_bpmn_heatmap`.
- **Configured engines only:** analytics reads exactly the server's configured engine ids:
  `createPlugin({ engineIds })` (a composed server injects camunda7's engines through
  `analyticsModule`'s shared `engineIds`), else `ANALYTICS_ENGINE_IDS` for a standalone boot.
  Without either, every analytics tool refuses (fail-closed) instead of reading every `engine_id`
  a shared Prometheus holds. Every tool takes an optional `engine` filter (one configured id or a
  list); omitted, it covers all configured engines and the result's `engines` names them; any
  other id is refused. Analytics are session-independent.
- **Toolsets** (`src/toolsets.ts`, declared as the module's `toolsets` vocabulary): `read-only`
  (every analytics tool and widget, no settings save) and `standard` (adds
  `analytics_save_settings`). With no `analytics:<toolset>` suffix the module runs `read-only` on an
  unauthenticated server and `standard` under OAuth; an empty or unknown suffix falls back to
  `read-only`.

### Cross-engine: overview, not scoreboard

Engines host different process definitions, so a failure rate, incident rate or duration aggregated
per engine describes that engine's **process mix**, not the engine. The same aggregation can even
invert the per-process truth. Two consequences run through the module:

- `engine_landscape` is the cross-engine view. It reports the process × engine inventory, absolute
  counts (running instances, open incidents, failed jobs) and the engine-owned job backlog
  (`jobs_executable`, `jobs_suspended`, `jobs_due_future`, `external_tasks_open`), the one metric
  family whose contract labels are `engine_id` only, so no process mix can confound it. It covers
  every configured engine, so one that reports nothing still gets a row (`reporting: false`).
- `engine_compare` **requires** a `processDefinitionKey`. Holding the process fixed on both sides is
  what makes a delta attributable to the engine; `engine_landscape.sharedProcessKeys` lists the
  definitions that qualify.

These tools read the `camunda_*` series emitted by the
[engine metrics plugin](../../../../engine-plugins). Per-instance drill-down (search by variable) is **not**
metric-backed: use the `camunda7_query_historic_*` tools in the [camunda7 module](../../camunda/camunda7-connector).

The BPMN heatmap gets its diagram XML via an injected `fetchBpmnXml` shared resource (wired by the
host app from the camunda7 module), and the dashboards, the failure dashboard and the landscape read
the process and activity names behind their ids through the same lookup (`bpmn-name-lookup.ts`).
This package has **no** engine-SDK dependency: the heatmap
degrades gracefully without it and the views show ids. `fetchBpmnXml(key, engineId?)` reads on the
named engine (the default one without), resolves `null` for a key not deployed there and rejects a
failed read; the views ask the engines their rows come from, and the names are cached per caller
(under passthrough auth the engine answers with each caller's own permissions).

## Adding an analytics capability

Read the [`add-analytics-feature`](../../../../.claude/skills/add-analytics-feature) skill first. The house
pattern: add a PromQL query function in [`@miragon/pulse-analytics-client`](../analytics-client) (using
`METRIC_NAMES`, never raw metric strings), then a tool here, then optionally a widget. Metric names
and labels are governed by the
[metrics contract](../analytics-client/metrics-contract.json). Change it there first.

## Layout

| Path                  | Contents                                                    |
| --------------------- | ----------------------------------------------------------- |
| `src/tools/`          | Analytics tools (`index.ts` wires them)                     |
| `src/widget-tools.ts` | `show_*` dashboard/comparison widget tools                  |
| `src/widgets/`        | React dashboard + comparison widgets                        |
| `src/definition.ts`   | Widget metadata                                             |
| `src/module.ts`       | `analyticsModule` (env mapping, `PROMETHEUS_URL` boot hint) |
| `src/steps/`          | Pipeline steps contributed to the server                    |
