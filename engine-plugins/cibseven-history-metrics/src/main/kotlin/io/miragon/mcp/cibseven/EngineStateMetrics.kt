package io.miragon.mcp.cibseven

import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.MultiGauge
import io.micrometer.core.instrument.Tags
import org.cibseven.bpm.engine.ProcessEngine
import org.slf4j.LoggerFactory
import java.time.Duration
import java.util.Date
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Point-in-time engine-state gauges, complementing the event-driven counters in
 * [ProcessMetrics]. These answer "what is the state right now" (running WIP,
 * open incidents, job backlog, task backlog), which flow counters cannot derive
 * (a long-running instance shows in no `increase[period]`, but it is live WIP).
 *
 * Implemented as Micrometer [MultiGauge]s (the row set, e.g. per definition
 * key, is dynamic) refreshed by a single daemon-thread scheduler: unlike the
 * OTEL API, Micrometer has no per-export callback, and a poll-time gauge
 * function would run engine queries on every scrape of every registry.
 * `register(rows, overwrite = true)` swaps the full row set each tick, so rows
 * for vanished definition keys are removed rather than frozen at their last
 * value.
 *
 * Every gauge is an engine-wide figure (a query over the engine's database), so
 * each node of a clustered engine reports the same rows. Consumers therefore
 * read a gauge as `max by (<its contract labels>)` before aggregating further,
 * never as a sum over nodes (rule 3 of `metrics-contract.json`).
 *
 * Cost note: each tick issues a handful of engine queries: fine for typical
 * deployments; widen the `state-interval` property if the definition count is
 * very large.
 */
class EngineStateMetrics(private val engine: ProcessEngine, private val engineId: String, registry: MeterRegistry) : AutoCloseable {

    private val log = LoggerFactory.getLogger(javaClass)
    private val engineTags = Tags.of("engine_id", engineId)
    private var scheduler: ScheduledExecutorService? = null

    private val running = MultiGauge.builder("engine.process.instances.running")
        .description("Currently running (active) process instances")
        .register(registry)
    private val failedJobs = MultiGauge.builder("engine.jobs.failed")
        .description("Jobs with no retries left (dead), by process definition")
        .register(registry)
    private val openIncidents = MultiGauge.builder("engine.incidents.open")
        .description("Open incidents, by process definition and type")
        .register(registry)
    private val executableJobs = MultiGauge.builder("engine.jobs.executable")
        .description("Jobs ready to execute now")
        .register(registry)
    private val suspendedJobs = MultiGauge.builder("engine.jobs.suspended")
        .description("Suspended jobs")
        .register(registry)
    private val dueFutureJobs = MultiGauge.builder("engine.jobs.due_future")
        .description("Jobs with a due date in the future")
        .register(registry)
    private val openTasks = MultiGauge.builder("engine.usertasks.open")
        .description("Open user tasks, by status")
        .register(registry)
    private val deployedDefinitions = MultiGauge.builder("engine.process.definitions.deployed")
        .description("Deployed process definition versions, by key")
        .register(registry)
    private val openExternalTasks = MultiGauge.builder("engine.external_tasks.open")
        .description("Open external tasks awaiting a worker")
        .register(registry)

    fun start(interval: Duration) {
        check(scheduler == null) { "EngineStateMetrics already started" }
        scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "cibseven-engine-state-metrics").apply { isDaemon = true }
        }.also {
            // A throw would silently cancel the schedule; every section already
            // guards itself, this is the backstop.
            it.scheduleAtFixedRate(
                { runCatching { refresh() }.onFailure { e -> log.warn("engine-state refresh failed", e) } },
                0,
                interval.toMillis(),
                TimeUnit.MILLISECONDS,
            )
        }
    }

    /** One state tick: query the engine and swap every gauge's row set. */
    internal fun refresh() {
        refreshDefinitionStats()
        refreshJobs()
        refreshTasks()
        refreshDeployedDefinitions()
        refreshExternalTasks()
    }

    /** Running instances + dead (retries-exhausted) jobs + open incidents: one query, aggregated per key. */
    private fun refreshDefinitionStats() {
        try {
            val runningByKey = HashMap<String, Long>()
            val failedByKey = HashMap<String, Long>()
            val incidentByKeyType = HashMap<Pair<String, String>, Long>()
            val stats = engine.managementService
                .createProcessDefinitionStatisticsQuery()
                .includeFailedJobs()
                .includeIncidents()
                .list()
            for (s in stats) {
                val key = s.key ?: ""
                runningByKey.merge(key, s.instances.toLong(), Long::plus)
                failedByKey.merge(key, s.failedJobs.toLong(), Long::plus)
                for (inc in s.incidentStatistics) {
                    incidentByKeyType.merge(key to (inc.incidentType ?: ""), inc.incidentCount.toLong(), Long::plus)
                }
            }
            running.register(runningByKey.map { (k, v) -> MultiGauge.Row.of(keyTags(k), v) }, true)
            failedJobs.register(failedByKey.map { (k, v) -> MultiGauge.Row.of(keyTags(k), v) }, true)
            openIncidents.register(
                incidentByKeyType.map { (kt, v) ->
                    MultiGauge.Row.of(keyTags(kt.first).and("incident_type", kt.second), v)
                },
                true,
            )
        } catch (e: Exception) {
            log.debug("definition-statistics gauges failed", e)
        }
    }

    /** Job-executor health: ready backlog, suspended, and future-due jobs. */
    private fun refreshJobs() {
        try {
            val mgmt = engine.managementService
            executableJobs.register(singleRow(mgmt.createJobQuery().executable().count()), true)
            suspendedJobs.register(singleRow(mgmt.createJobQuery().suspended().count()), true)
            dueFutureJobs.register(singleRow(mgmt.createJobQuery().duedateHigherThan(Date()).count()), true)
        } catch (e: Exception) {
            log.debug("job gauges failed", e)
        }
    }

    /** User-task backlog by status. `assigned` is derived (total − unassigned). */
    private fun refreshTasks() {
        try {
            val ts = engine.taskService
            val total = ts.createTaskQuery().count()
            val unassigned = ts.createTaskQuery().taskUnassigned().count()
            openTasks.register(
                listOf(
                    MultiGauge.Row.of(statusTags("total"), total),
                    MultiGauge.Row.of(statusTags("unassigned"), unassigned),
                    MultiGauge.Row.of(statusTags("assigned"), (total - unassigned).coerceAtLeast(0)),
                ),
                true,
            )
        } catch (e: Exception) {
            log.debug("task gauges failed", e)
        }
    }

    /** Deployed process-definition versions per key (inventory). */
    private fun refreshDeployedDefinitions() {
        try {
            val versionsByKey = engine.repositoryService.createProcessDefinitionQuery().list()
                .groupingBy { it.key ?: "" }
                .eachCount()
            deployedDefinitions.register(versionsByKey.map { (k, v) -> MultiGauge.Row.of(keyTags(k), v) }, true)
        } catch (e: Exception) {
            log.debug("deployed-definitions gauge failed", e)
        }
    }

    /** Open external tasks (worker pattern). Total only: topic has no group-by query. */
    private fun refreshExternalTasks() {
        try {
            openExternalTasks.register(singleRow(engine.externalTaskService.createExternalTaskQuery().count()), true)
        } catch (e: Exception) {
            log.debug("external-task gauge failed", e)
        }
    }

    private fun singleRow(value: Long): List<MultiGauge.Row<Number>> = listOf(MultiGauge.Row.of(engineTags, value))

    private fun keyTags(key: String): Tags = engineTags.and("process_definition_key", key)

    private fun statusTags(status: String): Tags = engineTags.and("status", status)

    override fun close() {
        scheduler?.shutdownNow()
        scheduler = null
    }
}
