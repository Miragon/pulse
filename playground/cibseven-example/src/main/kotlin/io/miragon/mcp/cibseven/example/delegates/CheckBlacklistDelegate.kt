package io.miragon.mcp.cibseven.example.delegates

import io.miragon.mcp.cibseven.example.seeders.SeedClock
import org.cibseven.bpm.engine.delegate.BpmnError
import org.cibseven.bpm.engine.delegate.DelegateExecution
import org.cibseven.bpm.engine.delegate.JavaDelegate
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component

@Component("checkBlacklistDelegate")
class CheckBlacklistDelegate : JavaDelegate {

    private val log = LoggerFactory.getLogger(CheckBlacklistDelegate::class.java)

    override fun execute(execution: DelegateExecution) {
        SeedClock.maybeAdvanceForActivity()
        val customerId = execution.getVariable("customerId") as? String ?: ""
        log.info("Blacklist check for customer {}", customerId)

        // Pre-fix bug era: MiraveloLeasingSeeder marks instances in the legacy
        // window with `_simulateBlacklistOutage=true`, the upstream blacklist
        // provider was unreachable. Surfaces as a job-level incident on
        // Activity_CheckBlacklist (asyncBefore), so the incident history shows
        // the fix for UC5 IMPROVED once the cutoff has passed.
        val outage = execution.getVariable("_simulateBlacklistOutage") as? Boolean ?: false
        if (outage) {
            log.warn("Simulated blacklist provider outage for customer {} (pre-fix era)", customerId)
            throw RuntimeException("Blacklist provider unreachable (simulated)")
        }

        if (BLACKLISTED_CUSTOMERS.contains(customerId)) {
            execution.setVariable("creditworthy", false)
            throw BpmnError("BLACKLIST_HIT", "Customer $customerId is on the blacklist")
        }

        // Reaching this point means none of the three checks raised: the
        // customer is creditworthy. Set the flag so the parent process gateway
        // can route to policy delivery.
        execution.setVariable("creditworthy", true)
    }

    companion object {
        private val BLACKLISTED_CUSTOMERS = setOf("CUST-666", "CUST-1337")
    }
}
