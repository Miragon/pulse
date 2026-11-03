package io.miragon.mcp.cibseven.example.seeders

import org.cibseven.bpm.engine.ManagementService
import org.slf4j.LoggerFactory
import org.springframework.context.annotation.Profile
import org.springframework.stereotype.Component

/**
 * Synchronously runs every executable job for a given process instance (and
 * every sub-process reached via call activity) until the list is empty or the
 * retry counter drains. Split out of [SeedOrchestrator] so the seeders can
 * inject it without forming a constructor-injection cycle (orchestrator →
 * seeders → orchestrator).
 *
 * Queries by `rootProcessInstanceId` instead of `processInstanceId` so the
 * asyncBefore blacklist job in `assessCreditworthiness` (which runs under the
 * *sub-process* PI) is drained alongside the parent's SendPolicy job.
 *
 * `.executable()` skips timer jobs whose due date is still in the future: a
 * must for `Activity_DecideOnApplication`, whose 2 h non-interrupting boundary
 * timer the normal path must *not* fire.
 */
@Component
@Profile("seed", "seed-minimal", "seed-presentation")
class JobDrainer(private val managementService: ManagementService) {

    private val log = LoggerFactory.getLogger(JobDrainer::class.java)

    fun drainJobsForInstance(rootProcessInstanceId: String) {
        var guard = 0
        while (guard < 8) {
            val jobs = managementService.createJobQuery()
                .rootProcessInstanceId(rootProcessInstanceId)
                .executable()
                .list()
            if (jobs.isEmpty()) return
            for (job in jobs) {
                // Advance the simulated clock before the job runs so the
                // resulting activity_instance row gets a non-zero
                // (end_time - start_time). Without this every Java-delegate
                // execution shares the same SeedClock instant and every
                // bottleneck-row duration is 0.
                SeedClock.advanceMillis(SeedClock.sampleServiceTaskLatencyMillis())
                try {
                    managementService.executeJob(job.id)
                } catch (ex: RuntimeException) {
                    log.debug("Job {} failed (retries left will decrement): {}", job.id, ex.message)
                }
            }
            guard++
        }
    }
}
