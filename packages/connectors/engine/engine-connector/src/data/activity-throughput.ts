import type { Client } from "@miragon/pulse-engine-client"
import {
  getHistoricActivityStatistics,
  getHistoricProcessInstances,
  getHistoricProcessInstancesCount,
  getProcessInstances,
} from "@miragon/pulse-engine-client/sdk"
import { mapLimit, toEngineDate } from "@miragon/pulse-engine-core"
import { createCallerCache, oneAtATime } from "../lib/engine/per-engine.js"
import type { ActivityThroughputActivity, ActivityThroughputData } from "../view-models.js"
import { MULTI_INSTANCE_BODY, placeOnDiagram, readDiagramXml } from "./activity-diagram.js"
import { HOUR_MS } from "./cluster-scan.js"
import {
  fetchDefinitionVersions,
  fetchLatestDefinition,
  fetchVersionIdsDeployedAfter,
  type DefinitionVersion,
} from "./definition-info.js"
import { countOf, DAY_MS, optional, rowsOf } from "./engine-reads.js"

// The history statistics load the engine's database: per version, every instance started in the
// window (of every definition) is checked against the version's activity index, and on an engine
// where other definitions start far more, the planner reads the version's whole retained history
// instead. Measured on PostgreSQL at 10 % and 30 % of 10,000 instances a day (2026-11-08): warm
// about 0.25 s at 30 %, cold up to 4.7 s, and both grow with the window. Hence a fixed window, a
// count first, one statistics read at a time per engine and a server cache for the hour.

/** The window: fixed, since the work grows with it (90 days cost about twice what 30 do). */
const THROUGHPUT_WINDOW_DAYS = 30
/** How long one read answers for the same key and window, per engine client and caller. */
const THROUGHPUT_CACHE_TTL_MS = HOUR_MS
const THROUGHPUT_CACHE_ENTRIES = 128
/** Cohort counts in flight at once; the statistics themselves go one at a time per engine. */
const COUNTS_AT_ONCE = 3
/**
 * Older versions counted past the ones the window's instances most likely started on: an instance
 * started by id on an older version still counts, but a long tail of versions, or history a
 * deleted deployment left behind (no version holds it), never turns the counts into a scan.
 */
const OLDER_VERSIONS_COUNTED = 6

type Throughput = Omit<ActivityThroughputData, "engineId">

const throughputCache = createCallerCache<Throughput>({
  maxEntries: THROUGHPUT_CACHE_ENTRIES,
  ttlMs: THROUGHPUT_CACHE_TTL_MS,
})

/**
 * The start of a window of `days` before `nowMs`, rounded UP to the hour: it never spans more than
 * `days` (a history time to live it is cut to included), and one window serves the whole hour. A
 * window of 0 days starts now, never in the future.
 */
export function windowStart(nowMs: number, days: number): number {
  return Math.min(nowMs, Math.ceil((nowMs - days * DAY_MS) / HOUR_MS) * HOUR_MS)
}

interface HistoryStatsRow {
  id?: string | null
  instances?: number | null
  finished?: number | null
  canceled?: number | null
}

function countStarted(client: Client, query: Record<string, string>): Promise<number> {
  return getHistoricProcessInstancesCount({ client, query }).then(countOf)
}

/**
 * The versions the instances started since the window's start most likely ran on, per tenant:
 * the ones deployed since, and the one that was the latest when the window began (`versions` come
 * newest first).
 */
function likelyVersions(
  versions: readonly DefinitionVersion[],
  deployedSince: ReadonlySet<string>,
): Set<string> {
  const likely = new Set<string>()
  const latestThen = new Set<string | null>()
  for (const version of versions) {
    if (deployedSince.has(version.id)) likely.add(version.id)
    else if (!latestThen.has(version.tenantId)) {
      latestThen.add(version.tenantId)
      likely.add(version.id)
    }
  }
  return likely
}

interface Cohorts {
  /** Per version counted: its instances started in the window. */
  byVersion: Map<string, number>
  /** The key's instances in the window on no version counted: older ones past the cap, or none. */
  uncounted: number
}

/**
 * Instances started since `startedAfter` per version: the candidates in turn until their counts
 * cover the key's `total`, so a key whose instances run on its newest versions is not counted
 * version by version. A candidate left out started nothing in the window.
 */
async function countCohorts(
  client: Client,
  candidates: readonly DefinitionVersion[],
  startedAfter: string,
  total: number,
): Promise<Cohorts> {
  const byVersion = new Map<string, number>()
  let counted = 0
  for (let next = 0; counted < total && next < candidates.length; next += COUNTS_AT_ONCE) {
    const batch = candidates.slice(next, next + COUNTS_AT_ONCE)
    const counts = await Promise.all(
      batch.map((v) => countStarted(client, { processDefinitionId: v.id, startedAfter })),
    )
    batch.forEach((version, i) => {
      byVersion.set(version.id, counts[i] ?? 0)
      counted += counts[i] ?? 0
    })
  }
  return { byVersion, uncounted: Math.max(0, total - counted) }
}

interface Window {
  startMs: number
  days: number
  capped: boolean
  /** Per version read: its instances in the window; only versions with any. */
  versions: Array<{ id: string; cohort: number }>
  /** The window's instances on no version read (`Cohorts.uncounted`). */
  uncounted: number
  /** Whether the full window held any instance (the history check is moot then). */
  anyStarted: boolean
}

const cohortOf = (cohorts: Cohorts, version: DefinitionVersion) =>
  cohorts.byVersion.get(version.id) ?? 0

/** The versions with instances in the window, each with its count: what the statistics read. */
const withCohort = (versions: readonly DefinitionVersion[], cohorts: Cohorts) =>
  versions.flatMap((v) =>
    cohortOf(cohorts, v) > 0 ? [{ id: v.id, cohort: cohortOf(cohorts, v) }] : [],
  )

function shortestTimeToLive(versions: readonly DefinitionVersion[]): number | null {
  const ttls = versions.flatMap((v) => (v.historyTimeToLive === null ? [] : [v.historyTimeToLive]))
  return ttls.length > 0 ? Math.min(...ttls) : null
}

/**
 * The window and the versions it reads. A version that ran in the window, or could have (deployed
 * since its start, or the latest then), and keeps its history shorter than the window has lost
 * the instances that ended before that, all of them perhaps: so the window shrinks to the shortest
 * such time to live and the counts are taken again for it. At 0 days the engine keeps no history
 * of the process, and nothing more is read.
 */
async function throughputWindow(
  client: Client,
  key: string,
  versions: readonly DefinitionVersion[],
  nowMs: number,
): Promise<Window> {
  const startedAfter = toEngineDate(new Date(windowStart(nowMs, THROUGHPUT_WINDOW_DAYS)))
  const [total, deployedSince] = await Promise.all([
    countStarted(client, { processDefinitionKey: key, startedAfter }),
    fetchVersionIdsDeployedAfter(client, key, startedAfter),
  ])
  const likely = likelyVersions(versions, deployedSince)
  const older = versions.filter((v) => !likely.has(v.id)).slice(0, OLDER_VERSIONS_COUNTED)
  const full = await countCohorts(
    client,
    [...versions.filter((v) => likely.has(v.id)), ...older],
    startedAfter,
    total,
  )
  const started = versions.filter((v) => cohortOf(full, v) > 0)
  const ttl = shortestTimeToLive(versions.filter((v) => likely.has(v.id) || cohortOf(full, v) > 0))
  const days = ttl === null ? THROUGHPUT_WINDOW_DAYS : Math.min(ttl, THROUGHPUT_WINDOW_DAYS)
  const window = {
    startMs: windowStart(nowMs, days),
    days,
    capped: days < THROUGHPUT_WINDOW_DAYS,
    anyStarted: total > 0,
  }
  if (!window.capped) {
    return { ...window, versions: withCohort(started, full), uncounted: full.uncounted }
  }
  if (days === 0) return { ...window, versions: [], uncounted: 0 }
  const cutAfter = toEngineDate(new Date(window.startMs))
  const cutTotal = await countStarted(client, { processDefinitionKey: key, startedAfter: cutAfter })
  const cut = await countCohorts(client, started, cutAfter, cutTotal)
  return { ...window, versions: withCohort(started, cut), uncounted: cut.uncounted }
}

/**
 * Whether the engine writes history at all, asked only when the window holds no instance: an
 * instance runs but none is open in the history. Both reads are enrichment; unknown is null.
 */
async function recordsHistory(client: Client): Promise<boolean | null> {
  const [running, open] = await Promise.all([
    optional(getProcessInstances({ client, query: { maxResults: 1 } }).then(rowsOf)),
    optional(
      getHistoricProcessInstances({ client, query: { unfinished: true, maxResults: 1 } }).then(
        rowsOf,
      ),
    ),
  ])
  if (running === null || open === null) return null
  if (open.length > 0) return true
  return running.length > 0 ? false : null
}

/** One version's statistics, through the engine's one-at-a-time gate. */
function readVersionHistory(
  client: Client,
  id: string,
  startedAfter: string,
): Promise<HistoryStatsRow[]> {
  return oneAtATime(client, () =>
    getHistoricActivityStatistics({
      client,
      path: { id },
      query: { finished: true, canceled: true, startedAfter },
    }),
  ).then((rows) => rowsOf<HistoryStatsRow>(rows))
}

type ElementCounts = Pick<ActivityThroughputActivity, "passed" | "running" | "canceled">

/**
 * Sums the versions' rows per element: a pass is a finished activity instance (canceled ones
 * included), and the ones still open there run; a multi-instance body is no pass of its own.
 */
function countsPerElement(rows: HistoryStatsRow[]): Map<string, ElementCounts> {
  const byElement = new Map<string, ElementCounts>()
  for (const row of rows) {
    if (!row.id || MULTI_INSTANCE_BODY.test(row.id)) continue
    const counts = byElement.get(row.id) ?? { passed: 0, running: 0, canceled: 0 }
    counts.passed += row.finished ?? 0
    counts.running += row.instances ?? 0
    counts.canceled += row.canceled ?? 0
    byElement.set(row.id, counts)
  }
  return byElement
}

async function readThroughput(client: Client, key: string, nowMs: number): Promise<Throughput> {
  const [diagram, versions] = await Promise.all([
    // Primary: an unknown key is a not-found error, never a view of zeros.
    fetchLatestDefinition(client, key),
    fetchDefinitionVersions(client, key),
  ])
  const window = await throughputWindow(client, key, versions, nowMs)
  const startedAfter = toEngineDate(new Date(window.startMs))
  const [perVersion, bpmnXml, historyRecorded] = await Promise.all([
    // In turn, so a failed read stops the rest instead of loading the engine for nothing.
    mapLimit(window.versions, 1, (v) => readVersionHistory(client, v.id, startedAfter)),
    // Names only what the window's instances passed: nothing passed, nothing to name.
    window.versions.length > 0 ? readDiagramXml(client, diagram) : Promise.resolve(null),
    // No window (a history time to live of 0 days) asks nothing more.
    window.anyStarted ? true : window.days === 0 ? null : recordsHistory(client),
  ])
  const place = placeOnDiagram(bpmnXml)
  const activities: ActivityThroughputActivity[] = [...countsPerElement(perVersion.flat())]
    .filter(([, counts]) => counts.passed > 0 || counts.running > 0)
    .map(([activityId, counts]) => ({ activityId, ...place(activityId), ...counts }))
    .sort(
      (a, b) =>
        b.passed - a.passed || b.running - a.running || a.activityId.localeCompare(b.activityId),
    )
  return {
    processDefinitionKey: key,
    source: "history",
    diagramDefinitionId: diagram.id || null,
    diagramVersion: diagram.version,
    versionCount: versions.length,
    versionsRead: window.versions.length,
    startedAfter: new Date(window.startMs).toISOString(),
    windowDays: window.days,
    cappedByHistoryTimeToLive: window.capped,
    instanceCount: window.versions.reduce((sum, v) => sum + v.cohort, 0),
    uncountedInstances: window.uncounted,
    historyRecorded,
    readAt: new Date(nowMs).toISOString(),
    activities,
  }
}

/**
 * The process flow's "Throughput": what the instances started in the last 30 days passed at each
 * element, every version that started any summed onto the latest diagram. Kept per engine client,
 * caller, key and window for the hour, so only the first open of a key per hour and replica reads
 * the engine; a failed read is not kept.
 */
export function readActivityThroughput(
  client: Client,
  key: string,
  nowMs: number,
): Promise<Throughput> {
  const window = windowStart(nowMs, THROUGHPUT_WINDOW_DAYS)
  return throughputCache(client, JSON.stringify([key, window]), () =>
    readThroughput(client, key, nowMs),
  )
}
