# Pulse engine metrics plugin

[![Maven Central](https://img.shields.io/maven-central/v/io.miragon.mcp/cibseven-history-metrics)](https://central.sonatype.com/artifact/io.miragon.mcp/cibseven-history-metrics)
[![CI](https://github.com/Miragon/pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/Miragon/pulse/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/Miragon/pulse)](../LICENSE)

A Micrometer plugin for your CIB seven engine that records process metrics, so the
[Pulse](../README.md) MCP server can show process KPIs, bottlenecks and engine comparisons from
Prometheus, without a query on the engine database. Run it at the same version as your Pulse
server: below 1.0 a release can rename a metric or a label ([changelog](../CHANGELOG.md)).

## Why

Process analytics usually means queries against the engine's history tables, which load the
database the engine needs for its work. The plugin records the numbers while the engine runs, and
Prometheus keeps them.

## What you get

- **Counts you can trust.** Counters and duration histograms from the history-event stream,
  recorded only once the engine command committed: a failed job attempt that rolls back counts
  nothing.
- **Durations in milliseconds.** Explicit buckets from 10 ms to 30 days (user tasks from 10 s).
- **The engine's backlog.** Gauges for running instances, open incidents and the job and task
  backlog, every `state-interval` (default 15 s).
- **Any export path.** The meters land in Micrometer's global registry: an OTLP push through an
  OTEL Collector, an Actuator Prometheus scrape or the OTEL Java agent's Micrometer bridge.

The metric names and labels are listed in the [metrics contract](https://github.com/Miragon/pulse/blob/main/packages/connectors/analytics/analytics-client/metrics-contract.json).

## Install

Add the plugin from Maven Central to your engine project (Java 21), at the version of your Pulse
server (the badge above shows the latest):

```kotlin
repositories {
    mavenCentral()
}

dependencies {
    implementation("io.miragon.mcp:cibseven-history-metrics:<version>")
}
```

`micrometer-core` resolves transitively; the engine and Spring stack is `compileOnly`, provided by
the CIB seven runtime.

For the OTLP push path on Spring Boot 4, additionally add
`spring-boot-starter-actuator`, `io.micrometer:micrometer-registry-otlp` and
`org.springframework.boot:spring-boot-opentelemetry`: Boot 4 gates the OTLP
export auto-configuration on that last module's `OpenTelemetryProperties`, so
without it the export silently never activates. Then set
`management.otlp.metrics.export.url`; see
[`../playground/cibseven-example/`](../playground/cibseven-example/) for a
working setup.

## Clustered engines

On a clustered engine every node reports the same engine-wide gauges and counts its own events.
Pulse folds the gauges with `max` over their labels; the counters stay correct only while every
node exports as its own series: on the OTLP path give each node a unique `service.instance.id`,
e.g. `OTEL_RESOURCE_ATTRIBUTES=service.instance.id=<pod name>`; an Actuator scrape keys series by
the target's `instance` label already.

## Help and feedback

- **Documentation:** how the server reads the metrics is in [Architecture](https://miragon.github.io/pulse/mcp/architecture) and the [Reference](https://miragon.github.io/pulse/mcp/reference#engine-metrics-plugin).
- **Bugs and ideas:** found a bug or missing something? [Open an issue](https://github.com/Miragon/pulse/issues).

## Contributing

How to build and test the plugin is in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](../LICENSE) © Miragon GmbH
