import { recordedRead, type RecordedRead } from "@miragon/pulse-widget-shell/widgets"
import type { ToolName } from "../page.config.ts"
import type { ActivityCounts, DiagramXml, ProcessStats } from "./process-dashboard.ts"

/**
 * What a recording keeps of each answer (`pnpm record`, widget-shell's `recordToolCalls`): the
 * fields the page reads, the types of `process-dashboard.ts`, and nothing else. `recordedRead`
 * holds each read to its type: a path the type lacks, and a field of it no path keeps, are type
 * errors, so a field a section starts to read joins here before the next recording. The
 * incidents' messages are free text, replaced unless `pnpm record -- --keep-text` (a `text` path
 * that names an object replaces every string below it); the diagram is kept without what the
 * engine runs or evaluates (its extension elements and attributes, its comments and the bodies of
 * its scripts, conditions, timers and expressions) and, unless `pnpm record -- --keep-text`,
 * without its documentation. Only the recorder and the tests import this file, so the published
 * page holds none of it.
 */
export const RECORDED_READS = {
  engine_process_stats: recordedRead<ProcessStats>()({
    paths: [
      "engine",
      "processDefinitionKey",
      "processDefinitionName",
      "asOf",
      "versions.count",
      "versions.latestVersion",
      "versions.latestDefinitionId",
      "now.running",
      "now.incidents",
      "now.withIncident",
      "now.failedJobs",
      "now.openTasks",
      "now.startedLast24h",
      "now.endedLast24h",
      "range.from",
      "range.to",
      "range.bucket",
      "range.timeZone",
      "history.timeToLiveDays",
      "history.keptFrom",
      "history.recorded",
      "totals.started",
      "totals.ended",
      "buckets[].start",
      "buckets[].end",
      "buckets[].started",
      "buckets[].ended",
      "buckets[].endedAt.*",
      "endEvents[].activityId",
      "endEvents[].name",
      "endEvents[].ended",
      "durations.from",
      "durations.ended",
      "durations.medianMs",
      "durations.p90Ms",
    ],
  }),
  engine_activity_counts: recordedRead<ActivityCounts>()({
    paths: [
      "engine",
      "processDefinitionKey",
      "processDefinitionName",
      "asOf",
      "definitionId",
      "version",
      "versionsCounted",
      "decorations[].elementId",
      "decorations[].counts[].kind",
      "decorations[].counts[].count",
      "decorations[].incident",
      "activities[].activityId",
      "activities[].name",
      "activities[].running",
      "activities[].openTasks",
      "activities[].oldestOpenTask",
      "activities[].incidents",
      "activities[].incidentsInCalledInstances",
      "activities[].failedJobs",
      "activities[].latestIncident.message",
      "activities[].latestIncident.at",
      "activities[].latestIncidentInCalledInstances.message",
      "activities[].latestIncidentInCalledInstances.at",
    ],
    text: [
      "activities[].latestIncident.message",
      "activities[].latestIncidentInCalledInstances.message",
    ],
  }),
  engine_get_process_definition_xml: recordedRead<DiagramXml>()({
    paths: ["bpmn20Xml"],
    bpmn: ["bpmn20Xml"],
  }),
} satisfies Record<ToolName, RecordedRead>
