# @miragon/pulse-analytics-client

[![npm](https://img.shields.io/npm/v/@miragon/pulse-analytics-client?style=flat-square)](https://www.npmjs.com/package/@miragon/pulse-analytics-client)
[![CI](https://img.shields.io/github/actions/workflow/status/Miragon/pulse/ci.yml?style=flat-square&label=ci)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-miragon.github.io%2Fpulse-335DE5?style=flat-square)](https://miragon.github.io/pulse/)

Typed PromQL queries over the `engine_*` metrics of the Pulse engine plugin.

## Install

```sh
npm install @miragon/pulse-analytics-client zod
```

## Overview

Prometheus client and PromQL query layer for Camunda 7 / CIB Seven process analytics. It pairs a thin
HTTP client for the Prometheus query API with a set of typed, purpose-built query functions and the
**metrics contract**, the single source of truth for the `engine_*` metric names and labels the
[engine plugin](../../../../engine-plugins) emits.

Used by [`@miragon/pulse-analytics-connector`](../analytics-connector) to power the `analytics_*` MCP tools, but
usable by any project that reads Camunda process metrics from Prometheus.

## Exports

The package has one entry point, `.`: the Prometheus client (`createPrometheusClient`,
`withCallerSignal`), `queries`, `schemas` (Zod inputs), the result types, `PERIODS` (the periods a
query takes), `increaseIn` and `ENGINE_HEALTH_STATUS_RULE` (how `engineHealth` reaches its verdict).

## Query functions

`src/queries/` provides one composable function per analysis, each returning a typed result rather
than a raw Prometheus matrix:

- `dashboard`: a period's flows, durations and live state, per process definition and per
  (process, activity)
- `period-compare`, `version-compare`, `engine-compare`: side-by-side comparisons of two periods,
  two versions or two engines
- `engine-landscape`: which process runs on which engine, load and job backlog per engine
- `element`: the per-element heat of a process (frequency and average duration)
- `health`: live operational snapshot (running WIP, open incidents, failed jobs, backlog, alerts)

```ts
import { createPrometheusClient, queries } from "@miragon/pulse-analytics-client"

const prom = createPrometheusClient({ url: "http://localhost:9090" })
const dashboard = await queries.dashboardData(prom, {
  processDefinitionKey: "loanApproval",
  period: "7d",
})
```

`createPrometheusClient` also takes optional auth (`bearerToken`, or
`username` + `password`; userinfo in `url` is moved into the Basic header),
extra `headers` (e.g. a tenant id) and a per-query `timeoutMs` (default
30 000 ms). Ambiguous auth throws at construction. Query errors never carry
the URL or a credential and truncate upstream bodies, so they are safe to show
a model. `withCallerSignal(client, signal)` makes every query abort with the
caller's signal as well.

## Metrics contract

[`metrics-contract.json`](metrics-contract.json) is the **single source of truth** for metric names
and labels. The Kotlin plugin emits the OTEL instruments (`otelName`) that surface in Prometheus as
`engine_*` series (`promName`), and the queries reference them through `METRIC_NAMES`
([`src/metric-names.ts`](src/metric-names.ts)), **never raw strings**. Both sides are verified
against the contract:

- TypeScript: [`src/metrics-contract.test.ts`](src/metrics-contract.test.ts) (vitest) checks the
  metric names; [`src/metrics-contract-labels.test.ts`](src/metrics-contract-labels.test.ts) runs
  every exported query function and checks each label its PromQL names (matchers, `by`/`without`,
  `on`/`ignoring`/`group_*`) against the labels the contract declares for that series, alert
  rules and Grafana dashboards included
- Kotlin: `MetricsContractTest.kt` (Gradle), incl. the millisecond bucket bounds each histogram
  registers

The contract also sets how a series is READ, and the same tests check every query, alert rule and
dashboard panel against it. PromQL of your own uses the exported helper `increaseIn`:

- `increaseIn(series, window)` for a counter or histogram: a series is created on its first event,
  and `increase()`/`rate()` never count a series' first sample, so the first incident of a type at
  an activity would read 0. A series born inside the window counts with its whole value.
- A gauge is folded over the nodes of a clustered engine: every node reports the same engine-wide
  rows, so the queries fold them with `max by (<its labels>)` (`engineState`, internal) before
  anything sums them.
- Durations are whole milliseconds (`*_duration_milliseconds`).

A rename that skips the contract, or a consumer (queries, alert rules, Grafana dashboards), fails
one of these tests. Only attach model-bounded labels (definition key, activity id, engine id);
never instance ids, business keys, or variable values.

## Publishing

Published to npm (public, with provenance) by the release-please train. The
`metrics-contract.json` ships in the package so downstream consumers can validate against it.
