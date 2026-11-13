package io.miragon.mcp.cibseven.example.delegates

import io.miragon.mcp.cibseven.example.seeders.SeedClock
import org.cibseven.bpm.engine.delegate.DelegateExecution
import org.cibseven.bpm.engine.delegate.JavaDelegate
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

/**
 * v2-only happy-path service task. Simulates a postal-address verification
 * lookup before the credit subprocess. The delegate body is deliberately
 * lightweight: its purpose is to make v2's avg/p95 measurably higher than
 * v1's, a real duration delta between the versions in the history.
 */
@Component("verifyAddressDelegate")
class VerifyAddressDelegate : JavaDelegate {

    private val log = LoggerFactory.getLogger(VerifyAddressDelegate::class.java)

    override fun execute(execution: DelegateExecution) {
        SeedClock.maybeAdvanceForActivity()
        val postalCode = execution.getVariable("postalCode") as? String ?: ""
        val region = execution.getVariable("region") as? String ?: ""
        log.info("Verifying address postal={} region={}", postalCode, region)
        execution.setVariable("addressVerified", true)
    }
}
