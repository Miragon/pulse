package io.miragon.mcp.cibseven

import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Tags
import org.cibseven.bpm.engine.impl.cfg.TransactionListener
import org.cibseven.bpm.engine.impl.cfg.TransactionState
import org.cibseven.bpm.engine.impl.context.Context
import org.cibseven.bpm.engine.impl.history.event.HistoricActivityInstanceEventEntity
import org.cibseven.bpm.engine.impl.history.event.HistoricIncidentEventEntity
import org.cibseven.bpm.engine.impl.history.event.HistoricProcessInstanceEventEntity
import org.cibseven.bpm.engine.impl.history.event.HistoricTaskInstanceEventEntity
import org.cibseven.bpm.engine.impl.history.event.HistoryEvent
import org.cibseven.bpm.engine.impl.history.handler.HistoryEventHandler
import org.slf4j.LoggerFactory

/**
 * Translates the engine's history-event stream into Micrometer metrics
 * ([ProcessMetrics]).
 *
 * Implements the engine's `HistoryEventHandler` SPI, but instead of persisting
 * events it records aggregated Micrometer metrics, so no event store is
 * needed. History events fire for every instance and are not sampled, so
 * counters and histograms see 100 % of traffic.
 *
 * Durations come straight from the engine-computed `durationInMillis` on the
 * end/complete events; only model-bounded tags are attached (see the
 * cardinality contract on [ProcessMetrics]).
 *
 * The engine hands events over while its command runs, before the command's
 * transaction commits. A command that rolls back (a failing job attempt, a
 * failed synchronous start) still produced its events, so they are recorded
 * only once that transaction COMMITTED: tags and durations are read at once,
 * the meters are touched by a commit listener. Work that never commits is
 * never counted, and each retry of a failing job counts only the attempt that
 * succeeds. Without a command context (nothing to wait for) the event is
 * recorded at once. A recording that throws is logged and dropped: a metric
 * must never fail an engine command.
 *
 * Backdated/replayed events are skipped: bulk seeding pins the engine clock into
 * the past, and those (often day-long) durations would otherwise pollute every
 * rate/duration window. Metrics represent live operation; the resulting
 * instances still show up in the state gauges, which query the engine directly.
 */
class MetricsHistoryEventHandler(private val engineId: String, registry: MeterRegistry) : HistoryEventHandler {

    private val log = LoggerFactory.getLogger(javaClass)
    private val metrics = ProcessMetrics(registry)

    override fun handleEvent(historyEvent: HistoryEvent) {
        if (isBackdated(historyEvent)) return
        val recording = when (historyEvent) {
            is HistoricProcessInstanceEventEntity -> onProcessInstance(historyEvent)
            is HistoricActivityInstanceEventEntity -> onActivityInstance(historyEvent)
            is HistoricTaskInstanceEventEntity -> onTaskInstance(historyEvent)
            is HistoricIncidentEventEntity -> onIncident(historyEvent)
            else -> null
        } ?: return
        afterCommit(recording)
    }

    override fun handleEvents(historyEvents: List<HistoryEvent>) {
        historyEvents.forEach { handleEvent(it) }
    }

    private fun onProcessInstance(e: HistoricProcessInstanceEventEntity): Recording? {
        val tags = Tags.of("process_definition_key", e.processDefinitionKey.orEmpty())
            .and("process_definition_version", versionOf(e.processDefinitionId))
            .and("engine_id", engineId)
            .and("tenant_id", e.tenantId.orEmpty())
        return when (e.eventType) {
            EVENT_START -> Recording { metrics.processStarted(tags) }
            EVENT_END -> {
                val endedTags = tags.and("state", e.state.orEmpty())
                val millis = e.durationInMillis
                Recording {
                    metrics.processEnded(endedTags)
                    millis?.let { metrics.processDuration(it, tags) }
                }
            }
            else -> null
        }
    }

    private fun onActivityInstance(e: HistoricActivityInstanceEventEntity): Recording? {
        // Only completed activities carry a duration and a stable count.
        if (e.eventType != EVENT_END) return null
        val tags = Tags.of("process_definition_key", e.processDefinitionKey.orEmpty())
            .and("activity_id", e.activityId.orEmpty())
            .and("activity_type", e.activityType.orEmpty())
            .and("engine_id", engineId)
        val millis = e.durationInMillis
        return Recording {
            metrics.activityEnded(tags)
            millis?.let { metrics.activityDuration(it, tags) }
        }
    }

    private fun onTaskInstance(e: HistoricTaskInstanceEventEntity): Recording? {
        val tags = Tags.of("process_definition_key", e.processDefinitionKey.orEmpty())
            .and("task_definition_key", e.taskDefinitionKey.orEmpty())
            .and("engine_id", engineId)
        return when (e.eventType) {
            EVENT_CREATE -> Recording { metrics.taskCreated(tags) }
            EVENT_COMPLETE -> {
                val millis = e.durationInMillis
                Recording {
                    metrics.taskCompleted(tags)
                    millis?.let { metrics.taskDuration(it, tags) }
                }
            }
            else -> null
        }
    }

    private fun onIncident(e: HistoricIncidentEventEntity): Recording? {
        val tags = Tags.of("process_definition_key", e.processDefinitionKey.orEmpty())
            .and("process_definition_version", versionOf(e.processDefinitionId))
            .and("activity_id", e.activityId.orEmpty())
            .and("incident_type", e.incidentType.orEmpty())
            .and("engine_id", engineId)
        return when (e.eventType) {
            EVENT_CREATE -> Recording { metrics.incidentCreated(tags) }
            EVENT_RESOLVE -> Recording { metrics.incidentResolved(tags) }
            else -> null
        }
    }

    /**
     * Runs [recording] once the current command's transaction committed, or at
     * once without a command context.
     */
    private fun afterCommit(recording: Recording) {
        val transaction = Context.getCommandContext()?.transactionContext
        if (transaction == null) {
            recordSafely(recording)
            return
        }
        transaction.addTransactionListener(TransactionState.COMMITTED, TransactionListener { recordSafely(recording) })
    }

    // The engine fires COMMITTED listeners without a guard: an exception here
    // would fail a command whose data is already committed.
    private fun recordSafely(recording: Recording) {
        try {
            recording.record()
        } catch (e: RuntimeException) {
            log.warn("recording a process metric failed", e)
        }
    }

    /**
     * Camunda's `processDefinitionId` is `key:version:uuid`; version is not a
     * separate field. The middle segment is the deployment version.
     */
    private fun versionOf(processDefinitionId: String?): String = processDefinitionId?.split(":")?.getOrNull(1).orEmpty()

    /**
     * True when the event's own timestamp is well in the past, i.e. a
     * backdated/replayed event (bulk seeding), not live traffic. Keyed off the
     * event timestamp rather than the ambient clock, because history events may
     * be handled at transaction-flush time (after the seed has reset the clock),
     * which would otherwise let backdated durations slip through.
     */
    private fun isBackdated(event: HistoryEvent): Boolean {
        val eventMillis = eventTimeMillis(event) ?: return false
        return System.currentTimeMillis() - eventMillis > BACKDATE_SKIP_MS
    }

    private fun eventTimeMillis(event: HistoryEvent): Long? = when (event) {
        is HistoricProcessInstanceEventEntity -> (event.endTime ?: event.startTime)?.time
        is HistoricActivityInstanceEventEntity -> (event.endTime ?: event.startTime)?.time
        is HistoricTaskInstanceEventEntity -> (event.endTime ?: event.startTime)?.time
        is HistoricIncidentEventEntity -> (event.endTime ?: event.createTime)?.time
        else -> null
    }

    /** The meter updates one event causes, with its tags and duration already read. */
    private fun interface Recording {
        fun record()
    }

    private companion object {
        /** Skip events the engine timestamps more than this far in the past (seeding/replay). */
        const val BACKDATE_SKIP_MS = 5 * 60 * 1000L

        // HistoryEventTypes.getEventName() values (see org.cibseven.bpm.engine.impl.history.event)
        const val EVENT_START = "start"
        const val EVENT_END = "end"
        const val EVENT_CREATE = "create"
        const val EVENT_COMPLETE = "complete"
        const val EVENT_RESOLVE = "resolve"
    }
}
