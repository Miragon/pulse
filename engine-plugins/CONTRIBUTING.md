# Developing the engine plugins

Multi-module Gradle build (Java 21) with the CIB seven process-metrics plugin
(`cibseven-history-metrics`), published to Maven Central as
`io.miragon.mcp:cibseven-history-metrics` by the release train of the repository
([CONTRIBUTING.md](../CONTRIBUTING.md#releases)). A runnable showcase that consumes it lives in
[`../playground/cibseven-example/`](../playground/cibseven-example/) as a separate Gradle build
(composite via `includeBuild`).

The metric names and labels it emits are governed by the
[metrics contract](../packages/connectors/analytics/analytics-client/metrics-contract.json). Change a metric there first;
`MetricsContractTest.kt` verifies this side against it. `CommitBoundaryTest` runs a real in-memory
engine to hold the commit rule: a job attempt that fails and rolls back counts nothing, the attempt
that succeeds counts once. Micrometer rounds an observation up to a whole base unit before
bucketing, so seconds emptied every sub-second bucket: durations are whole milliseconds, and the
bucket bounds are part of the contract.

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
