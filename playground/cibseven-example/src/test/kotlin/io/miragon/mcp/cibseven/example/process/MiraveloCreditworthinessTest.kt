package io.miragon.mcp.cibseven.example.process

import org.assertj.core.api.Assertions.assertThat
import org.cibseven.bpm.engine.ProcessEngine
import org.cibseven.bpm.engine.delegate.BpmnError
import org.cibseven.bpm.engine.delegate.DelegateExecution
import org.cibseven.bpm.engine.delegate.JavaDelegate
import org.cibseven.bpm.engine.test.Deployment
import org.cibseven.bpm.engine.test.junit5.ProcessEngineExtension
import org.cibseven.bpm.engine.test.mock.Mocks
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.RegisterExtension

/**
 * Stand-alone tests for the credit-worthiness sub-process. These exercise the
 * happy path plus each of the three "risk identified" error boundaries.
 *
 * The sub-process declares three error boundary events without an `errorRef`
 * attribute. This is one of the BPMN-modelling defects we expect these tests
 * to surface (Camunda treats missing errorRef as catch-all, but with no
 * `<bpmn:error>` declaration the error code propagation is brittle).
 */
class MiraveloCreditworthinessTest {

    @JvmField
    @RegisterExtension
    val extension: ProcessEngineExtension = ProcessEngineExtension.builder().build()

    private lateinit var engine: ProcessEngine

    @BeforeEach
    fun setUp() {
        engine = extension.processEngine
        Mocks.register("checkCreditScoreDelegate", noopDelegate())
        Mocks.register("checkPostalCodeDelegate", noopDelegate())
        Mocks.register("checkBlacklistDelegate", noopDelegate())
    }

    @AfterEach
    fun tearDown() {
        Mocks.reset()
    }

    @Test
    @Deployment(resources = ["miravelo-creditworthiness.bpmn"])
    fun `all checks pass ends at Customer creditworthy`() {
        val instance = engine.runtimeService.startProcessInstanceByKey(CREDIT_KEY)
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId)
            .`as`("happy path should end at 'Customer creditworthy'")
            .isEqualTo("Event_CustomerCreditworthy")
    }

    @Test
    @Deployment(resources = ["miravelo-creditworthiness.bpmn"])
    fun `bad credit score ends at Risk identified`() {
        Mocks.register("checkCreditScoreDelegate", throwing("BAD_CREDIT_SCORE"))

        val instance = engine.runtimeService.startProcessInstanceByKey(CREDIT_KEY)
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId)
            .`as`("bad credit score should be caught and reach 'Risk identified'")
            .isEqualTo("Event_RiskIdentified")
    }

    @Test
    @Deployment(resources = ["miravelo-creditworthiness.bpmn"])
    fun `undeliverable postal code ends at Risk identified`() {
        Mocks.register("checkPostalCodeDelegate", throwing("UNDELIVERABLE_POSTAL_CODE"))

        val instance = engine.runtimeService.startProcessInstanceByKey(CREDIT_KEY)
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId).isEqualTo("Event_RiskIdentified")
    }

    @Test
    @Deployment(resources = ["miravelo-creditworthiness.bpmn"])
    fun `blacklist hit ends at Risk identified`() {
        Mocks.register("checkBlacklistDelegate", throwing("BLACKLIST_HIT"))

        val instance = engine.runtimeService.startProcessInstanceByKey(CREDIT_KEY)
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId).isEqualTo("Event_RiskIdentified")
    }

    // Activity_CheckBlacklist is asyncBefore in production so the simulated
    // outage from MiraveloLeasingSeeder surfaces as a job-level incident.
    // Tests have to execute the resulting job manually. Each test gets a fresh
    // engine, so a global job query is safe here.
    @Suppress("UNUSED_PARAMETER")
    private fun drainJobs(processInstanceId: String) {
        var guard = 0
        while (guard++ < 8) {
            val jobs = engine.managementService.createJobQuery().executable().list()
            if (jobs.isEmpty()) return
            jobs.forEach { engine.managementService.executeJob(it.id) }
        }
    }

    private fun noopDelegate(): JavaDelegate = JavaDelegate { /* no-op */ }

    private fun throwing(errorCode: String): JavaDelegate = JavaDelegate { _: DelegateExecution ->
        throw BpmnError(errorCode)
    }

    companion object {
        private const val CREDIT_KEY = "assessCreditworthiness"
    }
}
