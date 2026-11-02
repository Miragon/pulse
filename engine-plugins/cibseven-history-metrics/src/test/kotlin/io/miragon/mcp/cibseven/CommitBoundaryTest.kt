package io.miragon.mcp.cibseven

import io.micrometer.core.instrument.Metrics
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.cibseven.bpm.engine.ProcessEngine
import org.cibseven.bpm.engine.ProcessEngineConfiguration
import org.cibseven.bpm.engine.impl.cfg.ProcessEngineConfigurationImpl
import org.cibseven.bpm.model.bpmn.Bpmn
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import java.time.Duration
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/**
 * The plugin against a real in-memory engine: history events fire while a
 * command runs, so a job attempt that fails partway produced the events of
 * every step before the failure and then rolled back. Only committed work may
 * show in the metrics, and a failing job's incident carries its definition
 * version.
 */
class CommitBoundaryTest {

    private val engineId = "commit-test-${UUID.randomUUID()}"
    private val registry = SimpleMeterRegistry()
    private val charge = FlakyCharge()
    private lateinit var plugin: CibSevenMetricsPlugin
    private lateinit var engine: ProcessEngine

    @BeforeEach
    fun bootEngine() {
        Metrics.addRegistry(registry)
        plugin = CibSevenMetricsPlugin(
            MetricsProperties().apply {
                engineId = this@CommitBoundaryTest.engineId
                stateInterval = Duration.ofHours(1)
            },
        )
        val config = ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration() as ProcessEngineConfigurationImpl
        config.setJdbcUrl("jdbc:h2:mem:$engineId;DB_CLOSE_DELAY=-1")
        config.setDatabaseSchemaUpdate(ProcessEngineConfiguration.DB_SCHEMA_UPDATE_CREATE_DROP)
        config.setHistory(ProcessEngineConfiguration.HISTORY_FULL)
        config.setJobExecutorActivate(false)
        config.setMetricsEnabled(false)
        config.setBeans(mapOf<Any, Any>("charge" to charge))
        config.setProcessEnginePlugins(listOf(plugin))
        engine = config.buildProcessEngine()
        engine.repositoryService.createDeployment()
            .addModelInstance(
                "payment.bpmn",
                Bpmn.createExecutableProcess("payment")
                    .startEvent("start")
                    .serviceTask("prepare").camundaAsyncBefore().camundaExpression("\${true}")
                    .serviceTask("chargeCard").camundaExpression("\${charge.run()}")
                    .endEvent("end")
                    .done(),
            )
            .deploy()
    }

    @AfterEach
    fun closeEngine() {
        plugin.destroy()
        engine.close()
        Metrics.removeRegistry(registry)
    }

    @Test
    fun `a job attempt that rolls back counts nothing, the attempt that commits counts once`() {
        engine.runtimeService.startProcessInstanceByKey("payment")
        assertEquals(1.0, counter("engine.process.instance.started"), "the start committed at the async boundary")

        val jobId = engine.managementService.createJobQuery().singleResult().id
        charge.failuresLeft = 2
        repeat(2) {
            assertFailsWith<RuntimeException> { engine.managementService.executeJob(jobId) }
        }
        assertEquals(0.0, activityEnded("prepare"), "prepare ended in two attempts that both rolled back")

        engine.managementService.executeJob(jobId)
        assertEquals(1.0, activityEnded("prepare"))
        assertEquals(1.0, activityEnded("chargeCard"))
        assertEquals(1.0, counter("engine.process.instance.ended"))
        assertEquals(1L, registry.find("engine.process.instance.duration").tag("engine_id", engineId).summary()?.count())
    }

    @Test
    fun `an incident is counted once it is committed, with the definition version`() {
        engine.runtimeService.startProcessInstanceByKey("payment")
        val jobId = engine.managementService.createJobQuery().singleResult().id
        charge.failuresLeft = Int.MAX_VALUE
        // Three attempts exhaust the default retries; the third one raises the incident.
        repeat(3) {
            assertFailsWith<RuntimeException> { engine.managementService.executeJob(jobId) }
        }
        val created = registry.find("engine.incident.created").tag("engine_id", engineId).counter()
        assertEquals(1.0, created?.count(), "one failedJob incident")
        assertEquals("1", created?.id?.getTag("process_definition_version"))
        assertEquals("failedJob", created?.id?.getTag("incident_type"))

        charge.failuresLeft = 0
        engine.managementService.setJobRetries(jobId, 1)
        engine.managementService.executeJob(jobId)
        assertEquals(1.0, counter("engine.incident.resolved"))
        assertEquals(1.0, activityEnded("prepare"), "only the attempt that committed counted prepare")
    }

    private fun counter(name: String): Double = registry.find(name).tag("engine_id", engineId).counters().sumOf { it.count() }

    private fun activityEnded(activityId: String): Double =
        registry.find("engine.activity.ended").tag("engine_id", engineId).tag("activity_id", activityId).counters().sumOf { it.count() }

    /** The `charge` bean: throws while [failuresLeft] is positive. */
    class FlakyCharge {
        @Volatile
        var failuresLeft = 0

        fun run(): Boolean {
            if (failuresLeft > 0) {
                failuresLeft--
                throw IllegalStateException("card declined")
            }
            return true
        }
    }
}
