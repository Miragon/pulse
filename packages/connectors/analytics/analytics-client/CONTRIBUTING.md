# Developing @miragon/pulse-analytics-client

The Prometheus client and PromQL query layer of [Pulse](../../../../README.md): a thin HTTP client
for the Prometheus query API, one typed query function per analysis in `src/queries/`, and the
**metrics contract**. Used by [`@miragon/pulse-analytics-connector`](../analytics-connector) to
power the `analytics_*` MCP tools; adding a capability starts with the
[`add-analytics-feature`](../../../../.claude/skills/add-analytics-feature) skill. Setup and the
repository's bar: [CONTRIBUTING.md](../../../../CONTRIBUTING.md).

## Metrics contract

[`metrics-contract.json`](metrics-contract.json) is the **single source of truth** for metric names
and labels: when changing a metric, change it here first. The Kotlin plugin emits the OTEL
instruments (`otelName`) that surface in Prometheus as `engine_*` series (`promName`), and the
queries reference them through `METRIC_NAMES` ([`src/metric-names.ts`](src/metric-names.ts)),
**never raw strings**. Both sides are verified against the contract:

- TypeScript: [`src/metrics-contract.test.ts`](src/metrics-contract.test.ts) (vitest) checks the
  metric names; [`src/metrics-contract-labels.test.ts`](src/metrics-contract-labels.test.ts) runs
  every exported query function and checks each label its PromQL names (matchers, `by`/`without`,
  `on`/`ignoring`/`group_*`) against the labels the contract declares for that series, alert
  rules and Grafana dashboards included (a new query export needs a `SCENARIOS` entry)
- Kotlin: `MetricsContractTest.kt` (Gradle), incl. the millisecond bucket bounds each histogram
  registers

The contract also sets how a series is READ, and the same tests check every query, alert rule and
dashboard panel against it: counters and histograms through `increaseIn`, a gauge folded over a
clustered engine's nodes with `max by (<its labels>)` (`engineState`, internal) before anything
sums it. A rename that skips the contract, or a consumer (queries, alert rules, Grafana
dashboards), fails one of these tests.

## Publishing

Published to npm (public, with provenance) by the release-please train. The
`metrics-contract.json` ships in the package so downstream consumers can validate against it.
