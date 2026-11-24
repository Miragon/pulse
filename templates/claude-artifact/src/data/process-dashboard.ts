import { isRootIncident, mapLimit } from "@miragon/pulse-c7-core"
import type { ElementBadgeData } from "@miragon/pulse-screens"
import type { Count } from "@miragon/pulse-ui/format"
import type { Cut, Engine } from "../engine/engine.ts"
import { countPerDay, dayStarts, daysBefore, parseEngineDate, quantile, tally } from "./stats.ts"

/**
 * Every read of the process dashboard, one function per section, over the page's `Engine`:
 * framework-free, so the recorder (`scripts/record.ts`, in Node) runs the very same reads, and the
 * fixtures hold exactly the calls the page makes. The numbers mean what the cockpit's process
 * detail means: every version of the key, open ROOT incidents, "With incident" from the runtime.
 */

/** The days the chart and the outcomes span: today and the 13 days before, in local days. */
export const CHART_DAYS = 14

/**
 * The window the chart and the outcomes read, one day longer than the days they show: the oldest
 * local day starts less than 14 days ago in every time zone, so the window that starts a day
 * earlier holds it whole. It is taken by instant arithmetic, so the recorded arguments match on
 * replay in any time zone; the rows are cut to the local days after the read.
 */
const WINDOW_DAYS = CHART_DAYS + 1

/**
 * Versions read at once, as the cockpit's element counts read them (`VERSION_READS_AT_ONCE` of the
 * engine connector): a key with many versions never fans out in one burst.
 */
const VERSION_READS_AT_ONCE = 4

// The engine's rows, the fields the page reads (the tools pass the engine's DTOs through).

export interface DefinitionRow {
  id: string
  key: string
  version: number
  name: string | null
}

interface IncidentRow {
  id: string
  activityId: string | null
  /** The execution whose token the incident holds. */
  executionId: string | null
  rootCauseIncidentId: string | null
  incidentMessage: string | null
  incidentTimestamp: string | null
  processDefinitionId: string | null
}

interface HistoricInstanceRow {
  id: string
  startTime: string | null
  endTime: string | null
  durationInMillis: number | null
}

interface ActivityInstanceRow {
  id: string
  activityId: string
  activityName: string | null
  activityType: string | null
  executionId: string | null
  endTime: string | null
}

interface TaskRow {
  id: string
  taskDefinitionKey: string | null
  name: string | null
  created: string | null
}

interface StatusDefinition {
  key: string
  instances?: number
  failedJobs?: number
  incidents?: number
}

interface EngineStatus {
  definitions?: StatusDefinition[]
}

// What each section reads.

export interface ProcessFacts {
  key: string
  engineId: string
  /** Every version of the key, the latest first. */
  versions: DefinitionRow[]
  /** The latest version, whose diagram the page draws; null for a key the engine lacks. */
  latest: DefinitionRow | null
  /** The latest version's BPMN XML. */
  xml: string | null
  /**
   * Null when every version was read; else why not (`Cut`): a sum over the versions (the badges,
   * the outcomes) is then a lower bound.
   */
  versionsCut: Cut | null
}

export interface Kpis {
  /** Running instances of every version. */
  running: Count
  /** Jobs without retries. */
  failedJobs: Count
  /** Open root incidents. */
  incidents: Count
  /** Instances with an open incident, from the runtime. */
  withIncident: Count
  openTasks: Count
  started24h: Count
  ended24h: Count
}

export interface DiagramData {
  process: ProcessFacts
  /** Each element's counts, every version summed onto the latest diagram. */
  badges: ElementBadgeData[]
  /** False when a read may miss rows (`cut` says why): the badges are then lower bounds. */
  complete: boolean
  cut: Cut | null
}

export interface DayCount {
  /** The day's start in the viewer's time zone. */
  day: Date
  started: number
  ended: number
}

export interface PerDayData {
  /**
   * Each day's count of the rows read: a capped scan of the window's instances, so when `complete`
   * is false every bar is a lower bound and shows as one.
   */
  days: DayCount[]
  /** Median and P90 of the durations of the instances read that ended in the days shown. */
  medianMs: number | null
  p90Ms: number | null
  /** How many ended instances the median and P90 are over. */
  durationsRead: number
  /**
   * False when the read of the ended instances may miss rows: the median and P90 are then over the
   * `durationsRead` rows read, not over every instance that ended, and say so.
   */
  durationsComplete: boolean
  /** False when either read may miss rows (`cut` says why). */
  complete: boolean
  cut: Cut | null
}

export interface OutcomeRow {
  activityId: string
  /** The engine's name of the end event (the diagram's name wins in the page). */
  activityName: string | null
  /** How often the end event was reached since `since`. */
  count: number
}

/**
 * The plain end events reached since the chart's first day, every version summed. A share is of
 * the end events reached (`reached`), never of instances: an instance can reach more than one
 * (a non-interrupting branch ends at its own end event), and one still running has reached one.
 */
export interface OutcomesData {
  process: ProcessFacts
  /** Per end event, the most reached first. */
  outcomes: OutcomeRow[]
  /** Every end event reached since `since`: the sum of the rows' counts, what a share is of. */
  reached: number
  /** The chart's first day (its local midnight), so both sections count the same 14 days. */
  since: Date
  /** False when a read may miss rows (`cut` says why): the counts are then lower bounds. */
  complete: boolean
  cut: Cut | null
}

export interface IncidentGroup {
  activityId: string
  /** `own`: root incidents raised here; `called`: copies of incidents in the instances it called. */
  kind: "own" | "called"
  count: number
  latestMessage: string | null
  latestAt: string | null
}

export interface IncidentsData {
  process: ProcessFacts
  groups: IncidentGroup[]
  complete: boolean
  cut: Cut | null
}

export interface TaskGroup {
  taskDefinitionKey: string
  name: string | null
  count: number
  oldestCreated: string | null
}

export interface TasksData {
  process: ProcessFacts
  groups: TaskGroup[]
  total: Count
  complete: boolean
  cut: Cut | null
}

const iso = (date: Date) => date.toISOString()

/**
 * The cut of reads taken together: null when none is cut, else `cap` before `changed` (a read the
 * cap stopped misses rows for sure).
 */
export function cutOf(...cuts: readonly (Cut | null)[]): Cut | null {
  return cuts.includes("cap") ? "cap" : cuts.includes("changed") ? "changed" : null
}

/** The id the engine gives a multi-instance activity's body: the activity's id with this suffix. */
const MULTI_INSTANCE_BODY = /#multiInstanceBody$/

/**
 * The diagram's element of an engine row's activity: a multi-instance body's row counts on its
 * activity, as the cockpit's element counts map it (an incident raised before an asynchronous
 * multi-instance activity names the body, say).
 */
export function elementOf(activityId: string): string {
  return activityId.replace(MULTI_INSTANCE_BODY, "")
}

/**
 * The activity instances of a scope that holds its tokens at the activities inside it: a
 * multi-instance body, an embedded or event subprocess, a transaction. The history keeps such an
 * instance open while its inner activities run, while the runtime holds the token at the inner
 * activity alone, so the cockpit (from the runtime's statistics) shows nothing running on the
 * scope, and neither does the page.
 */
const SCOPE_TYPES: ReadonlySet<string> = new Set([
  "multiInstanceBody",
  "subProcess",
  "adHocSubProcess",
  "transaction",
])

/** The token of an execution at an activity, as one key. */
const tokenKey = (executionId: string, activityId: string) => `${executionId} ${activityId}`

/** The key's versions, the latest version and its XML. */
export async function readProcess(engine: Engine, key: string): Promise<ProcessFacts> {
  const [engineId, list] = await Promise.all([
    engine.engineId(),
    engine.page<DefinitionRow>("engine_list_process_definitions", {
      processDefinitionKey: key,
      sortBy: "version",
      sortOrder: "desc",
    }),
  ])
  const versions = [...list.items].sort((a, b) => b.version - a.version)
  const latest = versions[0] ?? null
  const xml =
    latest === null
      ? null
      : ((
          await engine.call<{ bpmn20Xml?: string }>("engine_get_process_definition_xml", {
            processDefinitionId: latest.id,
          })
        ).bpmn20Xml ?? null)
  return { key, engineId, versions, latest, xml, versionsCut: list.cut }
}

/** The header: the process, its latest version and the engine. */
export function readHeader(engine: Engine, key: string): Promise<ProcessFacts> {
  return readProcess(engine, key)
}

/**
 * The tiles: running instances, jobs without retries and open root incidents from the engine's
 * status (every version summed), "With incident" from the runtime, the open tasks, the instances
 * started and ended in the last 24 hours.
 */
export async function readKpis(engine: Engine, key: string): Promise<Kpis> {
  const since = iso(daysBefore(engine.now(), 1))
  const [status, withIncident, openTasks, started24h, ended24h] = await Promise.all([
    engine.call<EngineStatus>("engine_status", { processDefinitionKeyIn: [key] }),
    engine.count("engine_list_process_instances", {
      processDefinitionKey: key,
      withIncidents: true,
    }),
    engine.count("engine_list_tasks", { processDefinitionKey: key }),
    engine.count("engine_query_historic_process_instances", {
      processDefinitionKey: key,
      startedAfter: since,
    }),
    engine.count("engine_query_historic_process_instances", {
      processDefinitionKey: key,
      finishedAfter: since,
    }),
  ])
  const row = status.definitions?.find((definition) => definition.key === key)
  return {
    running: row?.instances ?? null,
    failedJobs: row?.failedJobs ?? null,
    incidents: row?.incidents ?? null,
    withIncident,
    openTasks,
    started24h,
    ended24h,
  }
}

/** The key's open incidents, roots and copies, every version. */
function readOpenIncidents(engine: Engine, key: string) {
  return engine.page<IncidentRow>("engine_list_incidents", {
    processDefinitionKey: key,
    sortBy: "incidentId",
    sortOrder: "asc",
  })
}

/**
 * The diagram's badges, by the rule of the cockpit's element counts: each element's open root
 * incidents and, apart, the copies of the incidents in the instances it called (`isRootIncident`,
 * c7-core's one rule), and its running activity instances of every version, summed onto the latest
 * version's diagram (a multi-instance body's rows on its activity). A token an own root incident
 * holds counts as that incident, not as running (an external task without retries, say, whose
 * activity instance is open), and a scope's own activity instance (`SCOPE_TYPES`) counts nowhere,
 * since its tokens run at the activities inside. A token waiting before an asynchronous step has
 * no activity instance yet, so the running counts miss it.
 */
export async function readDiagram(engine: Engine, key: string): Promise<DiagramData> {
  const [process, incidents] = await Promise.all([
    readProcess(engine, key),
    readOpenIncidents(engine, key),
  ])
  const running = await mapLimit(process.versions, VERSION_READS_AT_ONCE, (version) =>
    engine.page<ActivityInstanceRow>("engine_query_historic_activity_instances", {
      processDefinitionId: version.id,
      unfinished: true,
      sortBy: "activityInstanceId",
      sortOrder: "asc",
    }),
  )
  const byElement = new Map<string, { running: number; incidents: number; called: number }>()
  const countsOf = (elementId: string) => {
    let counts = byElement.get(elementId)
    if (counts === undefined) {
      counts = { running: 0, incidents: 0, called: 0 }
      byElement.set(elementId, counts)
    }
    return counts
  }
  const held = new Set<string>()
  for (const incident of incidents.items) {
    if (!incident.activityId) continue
    const counts = countsOf(elementOf(incident.activityId))
    if (isRootIncident(incident)) {
      counts.incidents += 1
      if (incident.executionId) held.add(tokenKey(incident.executionId, incident.activityId))
    } else {
      counts.called += 1
    }
  }
  for (const instance of running.flatMap((page) => page.items)) {
    if (instance.activityType !== null && SCOPE_TYPES.has(instance.activityType)) continue
    if (instance.executionId && held.has(tokenKey(instance.executionId, instance.activityId))) {
      continue
    }
    countsOf(elementOf(instance.activityId)).running += 1
  }
  const badges = [...byElement]
    .map(([elementId, counts]) => ({
      elementId,
      running: counts.running,
      incidents: counts.incidents,
      incidentsInCalledInstances: counts.called,
    }))
    .sort((a, b) => (a.elementId < b.elementId ? -1 : 1))
  const cut = cutOf(process.versionsCut, incidents.cut, ...running.map((page) => page.cut))
  return { process, badges, complete: cut === null, cut }
}

/**
 * Started and ended per day over the last 14 days in the viewer's time zone, and the median and
 * P90 duration of the instances that ended in them: one paged read of the instances started in
 * the window and one of those ended in it. The bars stay a scan of those rows, capped at 1,000
 * each: an exact count per day would double the calls of a load until #665 cuts the reads. A cut
 * read shows its bars as lower bounds and its median and P90 as over the rows read.
 */
export async function readPerDay(engine: Engine, key: string): Promise<PerDayData> {
  const now = engine.now()
  const after = iso(daysBefore(now, WINDOW_DAYS))
  const [started, ended] = await Promise.all([
    engine.page<HistoricInstanceRow>("engine_query_historic_process_instances", {
      processDefinitionKey: key,
      startedAfter: after,
      sortBy: "instanceId",
      sortOrder: "asc",
    }),
    engine.page<HistoricInstanceRow>("engine_query_historic_process_instances", {
      processDefinitionKey: key,
      finishedAfter: after,
      sortBy: "instanceId",
      sortOrder: "asc",
    }),
  ])
  const starts = dayStarts(now, CHART_DAYS)
  const startedPerDay = countPerDay(
    started.items.map((row) => parseEngineDate(row.startTime)),
    starts,
  )
  const endedPerDay = countPerDay(
    ended.items.map((row) => parseEngineDate(row.endTime)),
    starts,
  )
  const from = starts[0].getTime()
  const durations = ended.items
    .filter((row) => (parseEngineDate(row.endTime)?.getTime() ?? -Infinity) >= from)
    .map((row) => row.durationInMillis)
    .filter((ms): ms is number => typeof ms === "number")
  const cut = cutOf(started.cut, ended.cut)
  return {
    days: starts.map((day, i) => ({ day, started: startedPerDay[i], ended: endedPerDay[i] })),
    medianMs: quantile(durations, 0.5),
    p90Ms: quantile(durations, 0.9),
    durationsRead: durations.length,
    durationsComplete: ended.complete,
    complete: cut === null,
    cut,
  }
}

/**
 * The plain end events reached since the chart's first day, per end event, every version summed
 * (the history keeps no end event on the instance, so each version's end event instances are
 * read, at most `VERSION_READS_AT_ONCE` versions at once). They are end events reached, not
 * instances: see `OutcomesData`.
 */
export async function readOutcomes(engine: Engine, key: string): Promise<OutcomesData> {
  const now = engine.now()
  const since = dayStarts(now, CHART_DAYS)[0]
  const after = iso(daysBefore(now, WINDOW_DAYS))
  const process = await readProcess(engine, key)
  const pages = await mapLimit(process.versions, VERSION_READS_AT_ONCE, (version) =>
    engine.page<ActivityInstanceRow>("engine_query_historic_activity_instances", {
      processDefinitionId: version.id,
      activityType: "noneEndEvent",
      finishedAfter: after,
      sortBy: "activityInstanceId",
      sortOrder: "asc",
    }),
  )
  const rows = pages
    .flatMap((page) => page.items)
    .filter((row) => (parseEngineDate(row.endTime)?.getTime() ?? -Infinity) >= since.getTime())
  const names = new Map(rows.map((row) => [row.activityId, row.activityName]))
  const cut = cutOf(process.versionsCut, ...pages.map((page) => page.cut))
  return {
    process,
    outcomes: tally(rows.map((row) => row.activityId)).map(({ key: activityId, count }) => ({
      activityId,
      activityName: names.get(activityId) ?? null,
      count,
    })),
    reached: rows.length,
    since,
    complete: cut === null,
    cut,
  }
}

/** The latest of two engine dates (either may be missing). */
function later(a: string | null, b: string | null): string | null {
  const at = (value: string | null) => parseEngineDate(value)?.getTime() ?? -Infinity
  return at(b) > at(a) ? b : a
}

/**
 * The open incidents by activity: the root incidents raised at each activity (`own`), and apart the
 * copies a call activity holds of the incidents in the instances it called (`called`), never part
 * of the incident count. An incident at a multi-instance body groups on its activity, as on the
 * diagram.
 */
export async function readIncidents(engine: Engine, key: string): Promise<IncidentsData> {
  const [process, incidents] = await Promise.all([
    readProcess(engine, key),
    readOpenIncidents(engine, key),
  ])
  const groups = new Map<string, IncidentGroup>()
  for (const incident of incidents.items) {
    const activityId = elementOf(incident.activityId ?? "")
    const kind = isRootIncident(incident) ? "own" : "called"
    const id = `${kind} ${activityId}`
    const group = groups.get(id) ?? {
      activityId,
      kind,
      count: 0,
      latestMessage: null,
      latestAt: null,
    }
    group.count += 1
    if (later(group.latestAt, incident.incidentTimestamp) === incident.incidentTimestamp) {
      group.latestAt = incident.incidentTimestamp
      group.latestMessage = incident.incidentMessage
    }
    groups.set(id, group)
  }
  return {
    process,
    groups: [...groups.values()].sort(
      (a, b) =>
        (a.kind === b.kind ? 0 : a.kind === "own" ? -1 : 1) ||
        b.count - a.count ||
        (a.activityId < b.activityId ? -1 : 1),
    ),
    complete: incidents.complete,
    cut: incidents.cut,
  }
}

/** The open tasks by task: how many wait at each, and since when the oldest. */
export async function readTasks(engine: Engine, key: string): Promise<TasksData> {
  const [process, tasks] = await Promise.all([
    readProcess(engine, key),
    engine.page<TaskRow>("engine_list_tasks", {
      processDefinitionKey: key,
      sortBy: "id",
      sortOrder: "asc",
    }),
  ])
  const groups = new Map<string, TaskGroup>()
  for (const task of tasks.items) {
    const taskKey = task.taskDefinitionKey ?? ""
    const group = groups.get(taskKey) ?? {
      taskDefinitionKey: taskKey,
      name: task.name,
      count: 0,
      oldestCreated: null,
    }
    group.count += 1
    const created = parseEngineDate(task.created)?.getTime()
    const oldest = parseEngineDate(group.oldestCreated)?.getTime()
    if (created !== undefined && (oldest === undefined || created < oldest)) {
      group.oldestCreated = task.created
    }
    groups.set(taskKey, group)
  }
  return {
    process,
    groups: [...groups.values()].sort(
      (a, b) => b.count - a.count || (a.taskDefinitionKey < b.taskDefinitionKey ? -1 : 1),
    ),
    total: tasks.total,
    complete: tasks.complete,
    cut: tasks.cut,
  }
}

/** Every section's read: the page runs each in its section, the recorder all of them at once. */
export const DASHBOARD_READS = {
  header: readHeader,
  kpis: readKpis,
  diagram: readDiagram,
  perDay: readPerDay,
  outcomes: readOutcomes,
  incidents: readIncidents,
  tasks: readTasks,
} as const

export async function readDashboard(engine: Engine, key: string): Promise<void> {
  await Promise.all(Object.values(DASHBOARD_READS).map((read) => read(engine, key)))
}
