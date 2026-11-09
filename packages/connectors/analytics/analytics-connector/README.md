# @miragon/pulse-analytics-connector

[![npm](https://img.shields.io/npm/v/@miragon/pulse-analytics-connector)](https://www.npmjs.com/package/@miragon/pulse-analytics-connector)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

The analytics module of Pulse for your own MCP server: KPIs, bottlenecks and engine comparisons
for Camunda 7 engines from Prometheus, as `analytics_*` tools and dashboards. Below 1.0: pin the
exact version and update all `@miragon/pulse-*` packages together.

## Install

```sh
npm install @miragon/pulse-analytics-connector @miragon/pulse-widget-shell zod bpmn-js@18.31.1
npm install react react-dom @miragon/pulse-ui lucide-react@1.67.0
```

`zod`, `bpmn-js` and `@miragon/pulse-widget-shell` are required peers, the second line is for the
view bundle; the module needs no MCP SDK package and no engine SDK of its own. Its data comes from
the `engine_*` series the
[engine metrics plugin](https://github.com/Miragon/pulse/blob/main/engine-plugins/README.md)
writes to Prometheus. The [pulse-starter](https://github.com/Miragon/pulse-starter) composes this
module already: [Build your own server](https://miragon.github.io/pulse/mcp/build-your-own).

## Minimal use

Hand `analyticsModule` to widget-shell's boot (`createComposedServer({ modules: [analyticsModule], … })`),
and its views and host widgets to the view bundle:

```ts
import { mountViews } from "@miragon/pulse-widget-shell/widgets"
import { analyticsHostWidgets, analyticsViews } from "@miragon/pulse-analytics-connector/widgets"

mountViews({ views: { ...analyticsViews }, hostWidgets: { ...analyticsHostWidgets } })
```

Your stylesheet scans the module's widget sources, since it ships them as TypeScript:
`@source "../node_modules/@miragon/pulse-analytics-connector/src";`. Point it at Prometheus with
`PROMETHEUS_URL` (default `http://localhost:9090`); every variable is in the
[configuration reference](https://miragon.github.io/pulse/mcp/reference#configuration).

Analytics reads only the engines you configured. Next to the engine module, your `shared` wiring
hands it that module's `engineIds` and its `fetchBpmnXml` lookup, as
[`@miragon/pulse-engine-connector`](https://www.npmjs.com/package/@miragon/pulse-engine-connector)
shows; on its own it reads `ANALYTICS_ENGINE_IDS`. Without either, every analytics tool refuses
instead of reading every `engine_id` a shared Prometheus holds.

## What it provides

- **One tool per question.** `show_dashboard` (a period's flows, durations and live state per
  process and per activity), `show_period_compare` (two periods, e.g. around a deployment),
  `show_version_compare`, `show_engine_compare`, `show_engine_landscape` and `show_bpmn_heatmap`;
  each renders a view and returns its figures to the model as compact JSON (the heatmap: a summary).
- **A live snapshot.** `analytics_engine_health` returns WIP, incidents, backlog and alerts as JSON
  without a view, its state from the alert rules as `metricsState`.
- **Widgets for other modules.** `analyticsHostWidgets` renders `analytics:engine-landscape` in the
  engine module's fleet view, and `analytics:process-heatmap` with `analytics:process-heatmap-legend`
  on its process diagram, each fetching its own data.
- **An engine filter on every tool.** The optional `engine` takes one configured id or a list;
  omitted, a tool covers every configured engine and names them in the result's `engines`.
- **Reads only.** Every analytics tool is a read, so the module declares no toolsets, and a suffix
  on it (`:read-only`, `:standard`) is ignored with a warning.

The BPMN heatmap and the process and activity names in the views come from the injected
`fetchBpmnXml(key, engineId?)`: it resolves `null` for a key not deployed on that engine, rejects
a failed read, and is cached per caller. Without it the heatmap degrades and the views show ids.

## Comparing engines

Engines host different process definitions, so a failure rate, incident rate or duration
aggregated per engine describes that engine's process mix, not the engine, and can even invert
the per-process truth:

- `show_engine_landscape` is the cross-engine view: the process × engine inventory, absolute
  counts (running instances, open incidents, failed jobs) and the engine-owned job backlog
  (`jobs_executable`, `jobs_suspended`, `jobs_due_future`, `external_tasks_open`). An engine that
  reports nothing still gets a row (`reporting: false`).
- `show_engine_compare` **requires** a `processDefinitionKey`, so a delta is attributable to the
  engine; the landscape's `sharedProcessKeys` lists the definitions that qualify.

A drill-down to single instances (search by variable) is not metric-backed: use the
`engine_query_historic_*` tools of the engine module.

## Help and feedback

- **Documentation:** every tool, setting and the metrics plugin are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to add an analytics capability and where the parts live is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
