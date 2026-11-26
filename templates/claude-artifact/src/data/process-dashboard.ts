import type { Count } from "@miragon/pulse-ui/format"
import type { PageReader } from "@miragon/pulse-widget-shell/widgets"
import type { ToolName } from "../page.config.ts"

/**
 * Every read of the process dashboard, over widget-shell's `PageReader`: three calls a load, each
 * answer the server's numbers ready to show, so the page adds nothing up itself. Framework-free,
 * so the recorder (`scripts/record.ts`, in Node, through `createPageReader`) runs the very same
 * reads and the fixtures hold exactly the calls the page makes. The reads name no engine, so the
 * server reads its default one; on a server with several and no default, a copy names `engine` in
 * each read's arguments. The numbers are the cockpit's process detail's, read by the same
 * builders on the server: every version of the key, open ROOT incidents, "With incident" from the
 * runtime, the running tokens per activity as the cockpit counts them.
 */

/** The reader of the page's calls: a call names only a tool of `PAGE_TOOLS`. */
type Reader = PageReader<ToolName>

// The answers, the fields the page reads (the tools answer more).

/** `engine_process_stats` per day: the process's numbers now and per day of the viewer's zone. */
export interface ProcessStats {
  engine: string
  processDefinitionKey: string
  processDefinitionName: string | null
  /** When the server read these numbers: a call inside its 30 s floor answers that read again. */
  asOf: string
  versions: { count: number; latestVersion: number; latestDefinitionId: string }
  /** What holds now, every version of the key, as the cockpit's process detail counts it. */
  now: {
    running: number
    /** Open root incidents: a call activity's copy counts in the called process. */
    incidents: number
    /** Instances with an open incident, from the runtime. */
    withIncident: number
    /** Jobs without retries. */
    failedJobs: number
    openTasks: number
    startedLast24h: Count
    endedLast24h: Count
  }
  range: { from: string; to: string; bucket: "day" | "hour"; timeZone: string }
  /**
   * The shortest history time to live of the versions (days; null: kept for good) and the instant
   * before which the engine may have removed history: a bucket that starts earlier counts at least.
   * `recorded` false: the engine writes no history, and every count of it is unknown (null).
   */
  history: { timeToLiveDays: number | null; keptFrom: string | null; recorded: boolean | null }
  totals: { started: Count; ended: Count }
  /** The days, the oldest first, today last (up to now). */
  buckets: {
    start: string
    end: string
    started: Count
    ended: Count
    /** Per end event, the instances that ended that day and reached it. */
    endedAt: Record<string, Count>
  }[]
  /** The end events directly in the process, each with the instances that ended and reached it. */
  endEvents: { activityId: string; name: string | null; ended: Count }[]
  /** The median and P90 of the instances that ended since `from`; null where none is known. */
  durations: { from: string; ended: number; medianMs: number | null; p90Ms: number | null } | null
}

/** An incident's message and when it was raised. */
export interface IncidentNote {
  message: string | null
  at: string
}

/** One activity of `engine_activity_counts`: an element that holds anything. */
export interface ActivityRow {
  activityId: string
  /** Its name in the diagram counted on; null where the diagram does not name it. */
  name: string | null
  running: number
  openTasks: number
  /** When its oldest open task was created, in the engine's format; null without one. */
  oldestOpenTask: string | null
  /** Open root incidents raised here. */
  incidents: number
  /** Open incidents of the instances it called: copies, counted in the called process. */
  incidentsInCalledInstances: number
  failedJobs: number
  latestIncident: IncidentNote | null
  latestIncidentInCalledInstances: IncidentNote | null
}

/** A count on the diagram, as the screens' decorations and pulse-ui's `BpmnDiagram` take it. */
export interface DecorationCount {
  kind: "incidents" | "incidentsInCalledInstances" | "running"
  count: number
}

/** `engine_activity_counts`: every version's counts on the latest version's diagram. */
export interface ActivityCounts {
  engine: string
  processDefinitionKey: string
  processDefinitionName: string | null
  /** When the server read these counts: a call inside its 30 s floor answers that read again. */
  asOf: string
  /** The version whose diagram the counts go on, the latest: its XML is the third call. */
  definitionId: string
  version: number
  /** The versions summed: every deployed one. */
  versionsCounted: number
  /** What each element shows: its counts and whether a root incident outlines it. */
  decorations: { elementId: string; counts: DecorationCount[]; incident: boolean }[]
  activities: ActivityRow[]
}

/** The process's diagram: the counts and the XML of the version they are drawn on. */
export interface DiagramData {
  counts: ActivityCounts
  xml: string | null
}

// The three calls.

/**
 * The process's numbers now and per day over the last 14 days in the viewer's time zone (the
 * server's default range): the tiles, the chart, the durations and the end events reached.
 */
export function readStats(reader: Reader, key: string): Promise<ProcessStats> {
  return reader.call<ProcessStats>("engine_process_stats", {
    processDefinitionKey: key,
    bucket: "day",
    timeZone: reader.timeZone,
  })
}

/** The process's counts per activity, every version summed onto the latest version's diagram. */
export function readActivities(reader: Reader, key: string): Promise<ActivityCounts> {
  return reader.call<ActivityCounts>("engine_activity_counts", { processDefinitionKey: key })
}

/** The counts and the XML of the diagram they name, the latest version's. */
export async function readDiagram(reader: Reader, key: string): Promise<DiagramData> {
  const counts = await readActivities(reader, key)
  const answer = await reader.call<{ bpmn20Xml?: string | null }>(
    "engine_get_process_definition_xml",
    { processDefinitionId: counts.definitionId },
  )
  return { counts, xml: answer.bpmn20Xml ?? null }
}

/**
 * Every read of the page: the page runs each in the sections that show it (sections sharing a
 * call share its answer), the recorder all of them at once.
 */
export const DASHBOARD_READS = {
  stats: readStats,
  activities: readActivities,
  diagram: readDiagram,
} as const

// What the sections show, from the answers: pure, so the tests hold them apart from the page.

/** The end events reached over the days the chart shows, each with its instances. */
export interface OutcomesData {
  /** Per end event, the most reached first; none without an instance. */
  outcomes: { activityId: string; name: string | null; ended: Count }[]
  /** The instances that ended in these days: what each share is of. */
  ended: Count
}

/** A count's known part: its number, a lower bound's bound, 0 for an unknown one. */
export function boundOf(count: Count): number {
  if (count === null || count === undefined) return 0
  return typeof count === "number" ? count : count.atLeast
}

/**
 * The end events reached in the chart's days: every end event an instance that ended reached,
 * the most reached first, and one whose count is unknown, never read as none. An instance can
 * reach more than one (a non-interrupting branch ends at an end event of its own), so the shares
 * are each of the instances that ended, never of a sum.
 */
export function outcomesOf(stats: ProcessStats): OutcomesData {
  return {
    outcomes: stats.endEvents
      .filter((event) => event.ended === null || boundOf(event.ended) > 0)
      .sort(
        (a, b) => boundOf(b.ended) - boundOf(a.ended) || (a.activityId < b.activityId ? -1 : 1),
      ),
    ended: stats.totals.ended,
  }
}

/**
 * Whether the engine may have removed history inside the chart's days: its counts before
 * `history.keptFrom` are then lower bounds, and the page says from when.
 */
export function historyCutOf(stats: ProcessStats): Date | null {
  const kept = stats.history.keptFrom === null ? null : new Date(stats.history.keptFrom)
  return kept !== null && kept.getTime() > new Date(stats.range.from).getTime() ? kept : null
}

/** The activities with open root incidents, the most first; and, apart, those whose calls have. */
export function incidentsOf(counts: ActivityCounts): {
  own: ActivityRow[]
  called: ActivityRow[]
} {
  const byCount =
    (count: (row: ActivityRow) => number) =>
    (a: ActivityRow, b: ActivityRow): number =>
      count(b) - count(a) || (a.activityId < b.activityId ? -1 : 1)
  return {
    own: counts.activities.filter((row) => row.incidents > 0).sort(byCount((row) => row.incidents)),
    called: counts.activities
      .filter((row) => row.incidentsInCalledInstances > 0)
      .sort(byCount((row) => row.incidentsInCalledInstances)),
  }
}

/** The tasks with open tasks waiting, the most first. */
export function tasksOf(counts: ActivityCounts): ActivityRow[] {
  return counts.activities
    .filter((row) => row.openTasks > 0)
    .sort((a, b) => b.openTasks - a.openTasks || (a.activityId < b.activityId ? -1 : 1))
}
