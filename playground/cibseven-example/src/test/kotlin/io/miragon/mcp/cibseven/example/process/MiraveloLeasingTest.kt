package io.miragon.mcp.cibseven.example.process

import org.assertj.core.api.Assertions.assertThat
import org.cibseven.bpm.engine.ProcessEngine
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
 * Drives the Miravelo bike-leasing showcase end-to-end. Each test models one
 * intended path through the process. Failures here map 1:1 to defects in the
 * BPMN model (missing delegate wiring, missing condition expressions, empty
 * timer definitions, etc.) and are documented in the test name.
 *
 * The two BPMN resources are deployed together because the parent process
 * calls the credit-check sub-process via `<callActivity calledElement="..."/>`.
 */
class MiraveloLeasingTest {

    @JvmField
    @RegisterExtension
    val extension: ProcessEngineExtension = ProcessEngineExtension.builder().build()

    private lateinit var engine: ProcessEngine

    @BeforeEach
    fun setUp() {
        engine = extension.processEngine

        // Stand-in delegates: the showcase BPMN currently has no `camunda:class`
        // / `camunda:expression` on its service tasks, but if the user wires
        // them up by *name* later, these mocks will satisfy them.
        Mocks.register("createOrResolveCustomerDelegate", noopDelegate())
        Mocks.register("deliverLeasingPolicyDelegate", noopDelegate())
        Mocks.register("rejectLeasingPolicyDelegate", noopDelegate())
        Mocks.register("sendPolicyDelegate", noopDelegate())
        Mocks.register("sendRejectionDelegate", noopDelegate())
        Mocks.register("checkCreditScoreDelegate", creditworthyDelegate(true))
        Mocks.register("checkPostalCodeDelegate", noopDelegate())
        Mocks.register("checkBlacklistDelegate", noopDelegate())
    }

    @AfterEach
    fun tearDown() {
        Mocks.reset()
    }

    @Test
    @Deployment(resources = ["miravelo-leasing.bpmn", "miravelo-creditworthiness.bpmn"])
    fun `deploys both showcase processes`() {
        val definitions = engine.repositoryService
            .createProcessDefinitionQuery()
            .list()
            .map { it.key }
        assertThat(definitions).contains(LEASING_KEY, CREDIT_KEY)
    }

    @Test
    @Deployment(resources = ["miravelo-leasing.bpmn", "miravelo-creditworthiness.bpmn"])
    fun `creditworthy customer ends at Leasing Policy issued`() {
        val instance = engine.runtimeService.startProcessInstanceByKey(LEASING_KEY)
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()

        assertThat(historic).`as`("process instance should be ended").isNotNull
        assertThat(historic.endActivityId)
            .`as`("creditworthy customer should reach the 'Leasing Policy issued' end event")
            .isEqualTo("Event_PolicyIssued")
    }

    @Test
    @Deployment(resources = ["miravelo-leasing.bpmn", "miravelo-creditworthiness.bpmn"])
    fun `risk identified then positive decision ends at Leasing Policy issued`() {
        // Force the sub-process to produce a "risk identified" outcome by
        // throwing the BPMN error from the credit-score check.
        Mocks.register("checkCreditScoreDelegate", creditworthyDelegate(false))

        val instance = engine.runtimeService.startProcessInstanceByKey(LEASING_KEY)
        drainJobs(instance.id)

        val decisionTask = engine.taskService.createTaskQuery()
            .processInstanceId(instance.id)
            .taskDefinitionKey("Activity_DecideOnApplication")
            .singleResult()
        assertThat(decisionTask)
            .`as`("'Decide on application' user task should be active when sub-process flagged risk")
            .isNotNull

        engine.taskService.complete(decisionTask.id, mapOf("decision" to "positive"))
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId)
            .`as`("positive decision should reach the 'Leasing Policy issued' end event")
            .isEqualTo("Event_PolicyIssued")
    }

    @Test
    @Deployment(resources = ["miravelo-leasing.bpmn", "miravelo-creditworthiness.bpmn"])
    fun `risk identified then negative decision ends at Leasing Policy Rejected`() {
        Mocks.register("checkCreditScoreDelegate", creditworthyDelegate(false))

        val instance = engine.runtimeService.startProcessInstanceByKey(LEASING_KEY)
        drainJobs(instance.id)

        val decisionTask = engine.taskService.createTaskQuery()
            .processInstanceId(instance.id)
            .taskDefinitionKey("Activity_DecideOnApplication")
            .singleResult()
        assertThat(decisionTask).isNotNull

        engine.taskService.complete(decisionTask.id, mapOf("decision" to "negative"))
        drainJobs(instance.id)

        val historic = engine.historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(instance.id)
            .singleResult()
        assertThat(historic.endActivityId)
            .`as`("negative decision should reach the 'Leasing Policy Rejected' end event")
            .isEqualTo("Event_PolicyRejected")
    }

    // The blacklist check (sub-process) and the policy send-task (parent) are
    // asyncBefore so the simulated outage flags from MiraveloLeasingSeeder
    // become job-level incidents. Tests must execute the resulting jobs
    // manually to drive the process to completion.
    //
    // We drain *all* jobs (not by processInstanceId) because the call activity
    // runs the sub-process under a separate processInstanceId, and its
    // asyncBefore job belongs to that one. Each test gets a fresh engine, so
    // the global query is safe here.
    @Suppress("UNUSED_PARAMETER")
    private fun drainJobs(processInstanceId: String) {
        var guard = 0
        while (guard++ < 8) {
            // .executable() skips the 2h non-interrupting boundary timer on
            // Activity_DecideOnApplication: without this filter the test would
            // force-fire the timer, spawn the "Accelerate decision making"
            // branch, and the parallel user task would keep the instance from
            // ending.
            val jobs = engine.managementService.createJobQuery().executable().list()
            if (jobs.isEmpty()) return
            jobs.forEach { engine.managementService.executeJob(it.id) }
        }
    }

    private fun noopDelegate(): JavaDelegate = JavaDelegate { /* no-op */ }

    private fun creditworthyDelegate(creditworthy: Boolean): JavaDelegate = JavaDelegate { execution: DelegateExecution ->
        execution.setVariable("creditworthy", creditworthy)
        if (!creditworthy) {
            // The "bad credit score" boundary error in the sub-process expects
            // an error to be thrown. Surface it the BPMN-error way.
            throw org.cibseven.bpm.engine.delegate.BpmnError("BAD_CREDIT_SCORE")
        }
    }

    companion object {
        private const val LEASING_KEY = "miraveloLeasing"
        private const val CREDIT_KEY = "assessCreditworthiness"
    }
}
