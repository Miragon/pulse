package io.miragon.mcp.cibseven.example.delegates

import io.miragon.mcp.cibseven.example.seeders.SeedClock
import org.cibseven.bpm.engine.delegate.DelegateExecution
import org.cibseven.bpm.engine.delegate.JavaDelegate
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Component("sendPolicyDelegate")
class SendPolicyDelegate : JavaDelegate {

    private val log = LoggerFactory.getLogger(SendPolicyDelegate::class.java)

    override fun execute(execution: DelegateExecution) {
        SeedClock.maybeAdvanceForActivity()
        // Narrow rollback regression band: MiraveloLeasingSeeder marks instances
        // in the rollback window with `_simulatePolicyRenderFailure=true`, when
        // the policy template was mis-rendered. Surfaces as a job-level
        // incident on Activity_SendPolicy (asyncBefore), so the incident
        // history shows the regression for UC5 REGRESSED.
        val rollbackFail = execution.getVariable("_simulatePolicyRenderFailure") as? Boolean ?: false
        if (rollbackFail) {
            log.warn(
                "Simulated rollback-era policy template render failure for instance {}",
                execution.processInstanceId,
            )
            throw RuntimeException("Policy template mis-rendered (simulated rollback regression)")
        }

        log.info(
            "Sending policy {} to customer {}",
            execution.getVariable("policyId"),
            execution.getVariable("customerId"),
        )
        execution.setVariable("policySent", true)
    }
}
