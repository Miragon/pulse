# Engine plugins: Kotlin Micrometer metrics for CIB Seven

Multi-module Gradle build (Java 21) containing the CIB Seven process-metrics plugin
(`cibseven-history-metrics`). It runs inside the CIB Seven runtime and records Micrometer metrics
into the global registry, so any Micrometer export path surfaces them in Prometheus as `engine_*`
series: an OTLP push via `micrometer-registry-otlp` through the OTEL Collector (the playground
default), an Actuator Prometheus scrape, or the OTEL Java agent's Micrometer bridge. There is no
engine-side database. Those series are what the [analytics module](../packages/connectors/analytics/analytics-connector) of
[Pulse](../README.md) queries.

From 0.25 every meter is named `engine.*` (Prometheus `engine_*`); up to 0.24 the names started
with `camunda`. Upgrade the plugin and the Pulse server together, and port your own alert rules and
dashboards: [Upgrading](../docs/mcp/upgrading.md) lists every old name and a scrape-time rename
for engines that upgrade later.

Published to **Maven Central** as `io.miragon.mcp:cibseven-history-metrics` (released via
release-please together with the server image). A runnable showcase that consumes this plugin lives
in [`../playground/cibseven-example/`](../playground/cibseven-example/) as a separate Gradle build
(composite via `includeBuild`).

The metric names and labels it emits are governed by the
[metrics contract](../packages/connectors/analytics/analytics-client/metrics-contract.json). Change a metric there first;
`MetricsContractTest.kt` verifies this side against it.

## What it records

- **Counters and duration histograms** from the history-event stream, recorded only once the
  engine command's transaction committed: a job attempt that fails and rolls back counts
  nothing, the attempt that succeeds counts once (`CommitBoundaryTest` runs a real in-memory
  engine against this). Incidents carry the definition version, like the process series.
- **Durations in whole milliseconds** (`*_duration_milliseconds`), with explicit buckets from
  10 ms to 30 days (user tasks from 10 s): Micrometer rounds an observation up to a whole base
  unit before bucketing, so seconds emptied every sub-second bucket. The bounds are part of the
  contract.
- **Engine-state gauges** (running instances, open incidents, job and task backlog) from engine
  queries every `state-interval` (default 15 s).

On a **clustered engine** every node reports the same engine-wide gauges and counts its own
events. Consumers fold the gauges with `max` over their labels (the contract's reading rules), and
the counters stay correct only while every node exports as its own series: on the OTLP path give
each node a unique `service.instance.id`, e.g.
`OTEL_RESOURCE_ATTRIBUTES=service.instance.id=<pod name>`; an Actuator scrape keys series by the
target's `instance` label already.

## Consume it

Available from Maven Central, no credentials or extra repository needed:

```kotlin
repositories {
    mavenCentral()
}

dependencies {
    implementation("io.miragon.mcp:cibseven-history-metrics:0.5.0")
}
```

`micrometer-core` resolves transitively; the engine/Spring stack is `compileOnly`
(provided by the CIB Seven runtime).

For the OTLP push path on Spring Boot 4, additionally add
`spring-boot-starter-actuator`, `io.micrometer:micrometer-registry-otlp` and
`org.springframework.boot:spring-boot-opentelemetry`: Boot 4 gates the OTLP
export auto-configuration on that last module's `OpenTelemetryProperties`, so
without it the export silently never activates. Then set
`management.otlp.metrics.export.url`; see
[`../playground/cibseven-example/`](../playground/cibseven-example/) for a
working setup.

## Quality gates

Phase 1 guardrails are **warn-not-error**: ktlint reports findings but does not fail the build. Only compile errors, failing unit tests, and Konsist assertion failures block CI.

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `./gradlew build`        | Compile + unit tests (includes Konsist architecture tests) |
| `./gradlew test`         | Run all tests (Konsist scoped per module)                  |
| `./gradlew ktlintCheck`  | Report ktlint findings (warn-only)                         |
| `./gradlew ktlintFormat` | Auto-fix ktlint findings in place                          |

### ktlint

Configured via `.editorconfig` at the repo root. Runs on every subproject. Phase 1 is warn-only; Phase 2 will flip `ignoreFailures` to `false` once the baseline is clean.

### Konsist architecture tests

See `konsist/README.md` for details on the shared test-base module and how to add new architecture rules.

## Pre-commit

Kotlin stays out of the pre-commit pipeline in Phase 1. `lint-staged` only handles TypeScript/JS/JSON. Gradle invocations are too slow to block every commit; we widen this in Phase 2 once detekt starts blocking and a standalone ktlint CLI can back a fast hook.
