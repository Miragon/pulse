package io.miragon.mcp.cibseven.example.traffic

import org.cibseven.bpm.engine.RuntimeService
import org.cibseven.bpm.engine.TaskService
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling
import org.springframework.scheduling.annotation.Scheduled
import java.util.concurrent.atomic.AtomicLong
import kotlin.random.Random

/**
 * Continuously starts (and completes) `miraveloLeasing` instances at real wall
 * time, so the metric-first analytics light up without manual nudging.
 *
 * The `seed-presentation` profile bulk-loads ~600 backdated instances in one
 * startup burst: great for historical depth, but invisible to
 * `increase()`/`rate()` over a window (the counters jump faster than a scrape).
 * This generator adds the missing *live pulse*: a steady trickle of real-time
 * instances (same variable mix as the seed, including the ~20 % blacklist
 * failures) plus task completions, so throughput, p95 durations, incident
 * rates, and version/period comparisons all populate naturally.
 *
 * Opt-in and self-contained: `@EnableScheduling` is only switched on when
 * `live-traffic.enabled=true`. The job executor runs the async service tasks,
 * so no [io.miragon.mcp.cibseven.example.seeders.JobDrainer] is needed here.
 */
@Configuration
@EnableScheduling
@ConditionalOnProperty(prefix = "live-traffic", name = ["enabled"], havingValue = "true")
class LiveTrafficGenerator(
    private val runtimeService: RuntimeService,
    private val taskService: TaskService,
    @Value("\${live-traffic.batch-size:2}") private val batchSize: Int,
    @Value("\${live-traffic.complete-per-tick:4}") private val completePerTick: Int,
    @Value("\${live-traffic.blacklist-failure-rate:0.2}") private val failureRate: Double,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val seq = AtomicLong()

    private val regions = listOf("EU", "US", "APAC")
    private val bikeModels = listOf("city", "cargo", "trail", "road")
    private val segments = listOf("PRIVATE", "BUSINESS", "STUDENT")
    private val leaseTerms = listOf(12, 24, 36, 48)

    // Default 5min: a steady trickle that keeps the analytics lit without piling
    // up tens of thousands of instances/day in the in-memory engine. Override via
    // live-traffic.interval-ms (env LIVE_TRAFFIC_INTERVAL_MS) for a denser pulse.
    @Scheduled(
        fixedDelayString = "\${live-traffic.interval-ms:300000}",
        initialDelayString = "\${live-traffic.initial-delay-ms:20000}",
    )
    fun tick() {
        try {
            startBatch()
            completePendingDecisions()
        } catch (e: Exception) {
            // Process may not be deployed yet on the first ticks; retry next tick.
            log.debug("live-traffic tick skipped: {}", e.message)
        }
    }

    private fun startBatch() {
        repeat(batchSize.coerceAtLeast(1)) {
            val n = seq.incrementAndGet()
            val bikeModel = bikeModels.random()
            val vars = mutableMapOf<String, Any>(
                "region" to regions.random(),
                "bikeModel" to bikeModel,
                "leaseTermMonths" to if (bikeModel == "cargo") 24 else leaseTerms.random(),
                "customerSegment" to segments.random(),
                "priorityFlag" to (Random.nextDouble() < 0.2),
                "postalCode" to "80331",
                "customerId" to "LIVE-$n",
            )
            if (Random.nextDouble() < failureRate) {
                vars["_simulateBlacklistOutage"] = true
            }
            // Latest deployed version (v2): live traffic on the current rollout.
            runtimeService.startProcessInstanceByKey("miraveloLeasing", "LIVE-$n", vars)
        }
    }

    private fun completePendingDecisions() {
        // Only this generator's own instances (businessKey `LIVE-…`), never the
        // backdated seed's leftover tasks, whose completion would emit a huge
        // (now − backdated-create-time) duration and pollute the live metrics.
        val tasks = taskService.createTaskQuery()
            .processDefinitionKey("miraveloLeasing")
            .taskDefinitionKey("Activity_DecideOnApplication")
            .processInstanceBusinessKeyLike("LIVE-%")
            .active()
            .listPage(0, completePerTick.coerceAtLeast(1))
        for (task in tasks) {
            try {
                val decision = if (Random.nextDouble() < 0.7) "positive" else "negative"
                taskService.complete(task.id, mapOf<String, Any>("decision" to decision))
            } catch (e: Exception) {
                log.debug("could not complete task {}: {}", task.id, e.message)
            }
        }
    }
}
