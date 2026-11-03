package io.miragon.mcp.cibseven

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties(prefix = "miragon.mcp.cibseven.history.metrics")
class MetricsProperties {
    var enabled: Boolean = true

    /**
     * Stable identifier for this engine instance, attached as the `engine_id`
     * tag on every metric so Prometheus/analytics can attribute and compare
     * data when several engines share one metrics backend. Defaults to
     * "default" so a single-engine setup works without extra config.
     */
    var engineId: String = "default"

    /**
     * Interval between engine-state gauge refreshes ([EngineStateMetrics]).
     * Each tick issues a handful of engine queries; widen it if the definition
     * count is very large. With the OTEL API this rode on the export interval;
     * Micrometer has no export tick, so it is an explicit knob.
     */
    var stateInterval: Duration = Duration.ofSeconds(15)
}
