package io.miragon.mcp.cibseven

import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.DistributionSummary
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Tags

/**
 * Micrometer meters for process analytics, emitted straight from the engine's
 * history-event stream (100 % coverage, never sampled). Records into the given
 * [MeterRegistry]: the plugin passes Micrometer's global composite registry,
 * so any export path the host application configures (Spring Boot Actuator
 * scrape or OTLP push, the OTEL Java agent's Micrometer bridge) receives the
 * meters. Without any export registry every recording is a no-op, so the
 * plugin is safe to load unconditionally.
 *
 * ## Resulting Prometheus names
 * Both export paths converge on the same Prometheus series: the OTEL
 * Collector's Prometheus exporter and Micrometer's own Prometheus registry
 * lowercase, replace `.` with `_`, append the unit and `_total` to monotonic
 * counters. So `engine.process.instance.duration` (base unit `milliseconds`)
 * surfaces as `engine_process_instance_duration_milliseconds{_bucket,_sum,_count}`
 * and `engine.process.instance.started` as
 * `engine_process_instance_started_total`. The base unit is deliberately the
 * spelled-out `milliseconds` (not UCUM `ms`) because both exporters append it
 * verbatim.
 *
 * ## Why whole milliseconds
 * Durations are a [DistributionSummary] of the engine's own `durationInMillis`,
 * not a Micrometer `Timer` (whose base time unit varies per registry). Micrometer
 * rounds a summary observation UP to a whole base unit before it picks the
 * histogram bucket, so in seconds every sub-second duration landed in the 1 s
 * bucket; in milliseconds the rounding is a no-op. The bucket bounds reach 30
 * days, so a long process or a slow user task stays below the top bucket instead
 * of capping every quantile at it. Both bucket lists are part of the metric
 * contract (`buckets` in `metrics-contract.json`).
 *
 * ## Cardinality contract
 * Only model-bounded tags are attached (definition key/version, activity
 * id/type, task key, incident type, engine id, tenant, instance state). NEVER
 * attach instance ids, business keys, variable values or raw incident messages:
 * they explode the time-series count. See [MetricsHistoryEventHandler].
 */
class ProcessMetrics(private val registry: MeterRegistry) {

    // --- Process instance ---
    fun processStarted(tags: Tags) = counter("engine.process.instance.started", "Process instances started", tags)

    fun processEnded(tags: Tags) = counter("engine.process.instance.ended", "Process instances ended, by terminal state", tags)

    fun processDuration(millis: Long, tags: Tags) =
        durationSummary("engine.process.instance.duration", "End-to-end process instance duration", FLOW_BUCKETS_MS, tags)
            .record(millis.toDouble())

    // --- Activity instance (heatmap + bottleneck) ---
    fun activityEnded(tags: Tags) = counter("engine.activity.ended", "Activity instances completed", tags)

    fun activityDuration(millis: Long, tags: Tags) =
        durationSummary("engine.activity.duration", "Activity instance execution time", FLOW_BUCKETS_MS, tags)
            .record(millis.toDouble())

    // --- User task ---
    fun taskCreated(tags: Tags) = counter("engine.usertask.created", "User tasks created", tags)

    fun taskCompleted(tags: Tags) = counter("engine.usertask.completed", "User tasks completed", tags)

    fun taskDuration(millis: Long, tags: Tags) = durationSummary("engine.usertask.duration", "User task cycle time", TASK_BUCKETS_MS, tags)
        .record(millis.toDouble())

    // --- Incident (failure analysis) ---
    fun incidentCreated(tags: Tags) = counter("engine.incident.created", "Incidents created", tags)

    fun incidentResolved(tags: Tags) = counter("engine.incident.resolved", "Incidents resolved", tags)

    // `register` is idempotent: it returns the existing meter for a known
    // (name, tags) pair, so the per-event lookup is a cheap map hit.
    private fun counter(name: String, description: String, tags: Tags) = Counter.builder(name)
        .description(description)
        .tags(tags)
        .register(registry)
        .increment()

    private fun durationSummary(name: String, description: String, buckets: DoubleArray, tags: Tags): DistributionSummary =
        DistributionSummary.builder(name)
            .description(description)
            .baseUnit("milliseconds")
            // SLOs materialise as explicit histogram buckets on every export
            // path (Micrometer's OTLP registry never falls back to an
            // exponential histogram when SLOs are set).
            .serviceLevelObjectives(*buckets)
            .tags(tags)
            .register(registry)

    private companion object {
        const val SECOND = 1_000.0
        const val MINUTE = 60 * SECOND
        const val HOUR = 60 * MINUTE
        const val DAY = 24 * HOUR

        /** Process/activity durations: a 10 ms service task up to a month-long process. */
        val FLOW_BUCKETS_MS = doubleArrayOf(
            10.0, 50.0, 100.0, 250.0, 500.0,
            SECOND, 2.5 * SECOND, 5 * SECOND, 10 * SECOND, 30 * SECOND,
            MINUTE, 5 * MINUTE, 15 * MINUTE,
            HOUR, 4 * HOUR, 12 * HOUR,
            DAY, 3 * DAY, 7 * DAY, 30 * DAY,
        )

        /** Human task cycle times: seconds to a month. */
        val TASK_BUCKETS_MS = doubleArrayOf(
            10 * SECOND,
            MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE,
            HOUR, 4 * HOUR, 12 * HOUR,
            DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY,
        )
    }
}
