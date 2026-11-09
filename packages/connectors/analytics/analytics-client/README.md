# @miragon/pulse-analytics-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-analytics-client)](https://www.npmjs.com/package/@miragon/pulse-analytics-client)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](LICENSE)

Typed PromQL queries over the `engine_*` metrics of the Pulse engine plugin, with a Prometheus
client and the metrics contract, for Camunda 7 and CIB seven process analytics. Below 1.0: pin the
exact version and update all `@miragon/pulse-*` packages together.

In a Pulse server you get it through
[`@miragon/pulse-analytics-connector`](https://www.npmjs.com/package/@miragon/pulse-analytics-connector),
which depends on it; install it yourself when your own code reads these metrics from Prometheus.
The series come from the
[engine metrics plugin](https://github.com/Miragon/pulse/blob/main/engine-plugins/README.md).

## Install

```sh
npm install @miragon/pulse-analytics-client
```

It has no runtime dependency and no peers.

## Minimal example

```ts
import { createPrometheusClient, queries } from "@miragon/pulse-analytics-client"

const prom = createPrometheusClient({ url: "http://localhost:9090" })
const dashboard = await queries.dashboardData(prom, {
  processDefinitionKey: "loanApproval",
  period: "7d",
})
```

`createPrometheusClient` also takes auth (`bearerToken`, or `username` + `password`; userinfo in
`url` moves into the Basic header), extra `headers` (e.g. a tenant id) and a per-query `timeoutMs`
(default 30 000 ms); ambiguous auth throws at construction. `withCallerSignal(client, signal)`
makes every query abort with the caller's signal as well.

## What it provides

| Query (`queries.*`) | Answers                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `dashboardData`     | A period's flows, durations and live state, per process definition and per (process, activity) |
| `periodCompare`     | Two periods side by side, e.g. around a deployment                                             |
| `versionCompare`    | Two versions of one process side by side                                                       |
| `engineCompare`     | One process on two engines side by side                                                        |
| `engineLandscape`   | Which process runs on which engine, load and job backlog per engine                            |
| `elementHeat`       | The per-element heat of a process (frequency and average duration)                             |
| `engineHealth`      | A live snapshot: running WIP, open incidents, failed jobs, backlog, alerts                     |

Each returns a typed result rather than a raw Prometheus matrix. Next to `queries` the entry
exports the client (`createPrometheusClient`, `withCallerSignal`, `PrometheusRequestError`), the
result types, `PERIODS` (the periods a query takes), `increaseIn` and `ENGINE_METRICS_STATE_RULE`
(how `engineHealth` reaches its `metricsState`).

Query errors are `PrometheusRequestError`s whose `kind` tells you which of your settings to name.
They never carry the URL or a credential (an upstream's text is echoed with both masked), truncate
upstream bodies and leave out a web page from a service that is not Prometheus, so they are safe
to show a model.

## Metrics contract

[`metrics-contract.json`](metrics-contract.json) ships in the package and is the single source of
truth for the `engine_*` metric names and labels, so you can validate your own queries, alert rules
or dashboards against it. PromQL of your own follows its reading rules:

- Read a counter or histogram with `increaseIn(series, { range })`: a series is created on its
  first event, and `increase()`/`rate()` never count a series' first sample, so the first incident
  of a type at an activity would read 0. A series born inside the window counts with its whole
  value.
- Fold a gauge over the nodes of a clustered engine with `max by (<its labels>)` before you sum it:
  every node reports the same engine-wide rows.
- Durations are whole milliseconds (`*_duration_milliseconds`).
- Attach only model-bounded labels (definition key, activity id, engine id), never instance ids,
  business keys or variable values.
- Never aggregate a rate across engines: engines host different processes, so compare one process
  across engines, or report absolute counts and the engine-owned backlog gauges.

## Help and feedback

- **Documentation:** the analytics tools and the metrics plugin are explained at [miragon.github.io/pulse](https://miragon.github.io/pulse/).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How the queries are checked against the metrics contract is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Miragon GmbH
