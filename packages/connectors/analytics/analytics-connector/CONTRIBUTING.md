# Developing @miragon/pulse-analytics-connector

The **analytics module** for [Pulse](../../../../README.md): Prometheus-backed process analytics as
`analytics_*` MCP tools, plus dashboard and comparison widgets. Built on
[`@miragon/pulse-analytics-client`](../analytics-client), `@miragon/pulse-ui` and
`@miragon/pulse-widget-shell`. The server loads it as `analytics` via `analyticsModule`
(`src/module.ts`), which conforms structurally to the `ComposableModule` port of
`@miragon/pulse-widget-shell/server`. Setup and the repository's bar:
[CONTRIBUTING.md](../../../../CONTRIBUTING.md).

Every analytics tool is a read (`src/module.test.ts` pins it), so the module declares no toolset
vocabulary. The dashboard and the landscape read the process and activity names behind their ids
through the injected BPMN lookup (`bpmn-name-lookup.ts`).

## Cross-module wiring

- **Host widgets** (`analyticsHostWidgets` from `./widgets`): what another module renders by raw
  id, each fetching its own data. The engine module's fleet view shows
  `analytics:engine-landscape`; its process flow shows the heat of one process on its own diagram
  with `analytics:process-heatmap` (`processDefinitionKey`, `engine`, `mode`, the diagram's
  `bpmnXml` and an `onUnavailable` fallback) and `analytics:process-heatmap-legend` (`mode`).
  A composition root spreads them into its `hostWidgets`.
- **The BPMN lookup:** the heatmap gets its diagram XML via an injected `fetchBpmnXml` shared
  resource (wired by the host app from the engine module). `fetchBpmnXml(key, engineId?)` reads on
  the named engine (without one, the engine module's precedence: `ENGINE_DEFAULT`, else its only
  engine, else it rejects), resolves `null` for a key not deployed there and rejects a failed
  read; the views ask the engines their rows come from, and the names are cached per caller
  (under passthrough auth the engine answers with each caller's own permissions).
- **Engine scope:** `createPlugin({ engineIds })` (a composed server injects the engine module's
  engines through `analyticsModule`'s shared `engineIds`), else `ANALYTICS_ENGINE_IDS` for a
  standalone boot. Analytics are session-independent.

## Adding an analytics capability

Read the [`add-analytics-feature`](../../../../.claude/skills/add-analytics-feature) skill first. The house
pattern: add a PromQL query function in [`@miragon/pulse-analytics-client`](../analytics-client) (using
`METRIC_NAMES`, never raw metric strings), then the tool's Zod input schema in `src/schemas/` and
one show tool and its view here (a registrar tool only for a read that needs no view). Metric names
and labels are governed by the
[metrics contract](../analytics-client/metrics-contract.json). Change it there first.

## Layout

| Path                  | Contents                                                    |
| --------------------- | ----------------------------------------------------------- |
| `src/schemas/`        | The tools' Zod input schemas                                |
| `src/tools/`          | The engine health read (`index.ts` wires it)                |
| `src/widget-tools.ts` | `show_*` dashboard/comparison widget tools                  |
| `src/widgets/`        | React dashboard + comparison widgets                        |
| `src/module.ts`       | `analyticsModule` (env mapping, `PROMETHEUS_URL` boot hint) |
| `src/plugin.ts`       | `createPlugin`: the module's `register(server)`             |
