package io.miragon.mcp.cibseven

import io.micrometer.core.instrument.Metrics
import org.cibseven.bpm.engine.ProcessEngine
import org.cibseven.bpm.engine.impl.cfg.AbstractProcessEnginePlugin
import org.cibseven.bpm.engine.impl.cfg.ProcessEngineConfigurationImpl
import org.cibseven.bpm.engine.impl.history.handler.CompositeDbHistoryEventHandler
import org.cibseven.bpm.engine.impl.history.handler.CompositeHistoryEventHandler
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component

/**
 * Wires the engine's metric emitters:
 *  - [MetricsHistoryEventHandler] for event-driven counters/histograms (in
 *    `postInit`), recorded once the command's transaction committed.
 *  - [EngineStateMetrics] for point-in-time gauges (in `postProcessEngineBuild`,
 *    where the built [ProcessEngine] and its query services are available).
 *
 * Both record into [Metrics.globalRegistry] rather than a Spring-injected
 * `MeterRegistry` bean: Spring Boot adds every auto-configured registry to the
 * global composite (`management.metrics.use-global-registry`, default on), the
 * OTEL Java agent's Micrometer bridge registers there too, and composite
 * meters are bound into child registries added later, so the export path
 * needs no wiring here and the engine can boot before the registries exist.
 *
 * The history handler is added to the engine's existing
 * [CompositeHistoryEventHandler] (order-independent; does NOT wrap an existing
 * composite in a second [CompositeDbHistoryEventHandler], which would register a
 * duplicate DB handler and double-persist history).
 */
@Component
class CibSevenMetricsPlugin(private val properties: MetricsProperties) :
    AbstractProcessEnginePlugin(),
    DisposableBean {

    // Held so the gauge refresh scheduler can be stopped on context shutdown.
    private var engineState: EngineStateMetrics? = null

    override fun postInit(config: ProcessEngineConfigurationImpl) {
        val handler = MetricsHistoryEventHandler(properties.engineId, Metrics.globalRegistry)
        when (val existing = config.historyEventHandler) {
            is CompositeHistoryEventHandler -> existing.add(handler)
            null -> config.historyEventHandler = CompositeDbHistoryEventHandler(listOf(handler))
            else -> config.historyEventHandler = CompositeDbHistoryEventHandler(listOf(existing, handler))
        }
    }

    override fun postProcessEngineBuild(processEngine: ProcessEngine) {
        engineState = EngineStateMetrics(processEngine, properties.engineId, Metrics.globalRegistry)
            .also { it.start(properties.stateInterval) }
    }

    override fun destroy() {
        engineState?.close()
        engineState = null
    }
}
