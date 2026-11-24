import type { Client } from "@miragon/pulse-c7-client"
import {
  getHistoricProcessInstances,
  getHistoricProcessInstancesCount,
  getTasksCount,
} from "@miragon/pulse-c7-client/sdk"
import {
  countWithIncident,
  engineDateMillis,
  mapLimit,
  PARALLEL,
  toEngineDate,
} from "@miragon/pulse-c7-core"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import { bpmnProcessEndEventIds } from "../lib/bpmn/bpmn-parse.js"
import { enginePortFor } from "../lib/core-adapter/engine-port.js"
import { createCallerCache, oneAtATime } from "../lib/engine/per-engine.js"
import {
  type DefinitionVersion,
  fetchDefinitionVersions,
  fetchDefinitionXml,
  fetchStatsByKey,
  unknownKeyError,
} from "./definition-info.js"
import { countOf, DAY_MS, rowsOf } from "./engine-reads.js"
import { recordsHistory } from "./history-recorded.js"
import { countFailedJobs, countRunningInstances } from "./process-incidents-data.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"
import {
  type BucketRange,
  type BucketSpan,
  bucketsOf,
  canonicalTimeZone,
  dayStartOf,
  type StatsBucket,
} from "./stats-buckets.js"

/**
 * A process's numbers ready to show (`engine_process_stats`), every version of its key: its counts
 * now as the cockpit's process detail reads them, and over a range, per day or hour bucket, the
 * instances started, ended and ended per end event, with the median and P90 of their durations.
 * Every number is a count of the engine (`/count`), never a page or a scan: per bucket and series
 * one count, the range's first, so a series the range holds nothing of reads no bucket; a median
 * and a P90 are the instance at their rank in the engine's order by duration, by the nearest rank.
 * An engine that writes no history (history level `none`) answers every history count with 0:
 * where the history holds nothing and an instance runs, its counts are unknown (`null`), never 0.
 */

/** A count as pulse-ui's `formatCount` takes it: exact, a lower bound, or unknown (null). */
type Count = number | { readonly atLeast: number } | null

export interface ProcessStatsArgs {
  processDefinitionKey: string
  /** ISO 8601, as the schema takes it. */
  from?: string
  to?: string
  bucket: StatsBucket
  /** IANA; the buckets' days and hours, and the day a bare date of `from` and `to` is (default UTC). */
  timeZone?: string
}

/** The median and P90 of the instances that ended since `from`, by the nearest rank. */
interface DurationStats {
  /** Where the durations start: the range's start, or where the engine keeps its history from. */
  from: string
  /** How many instances ended since then, which the median and P90 are of. */
  ended: number
  /** Null where none ended, or more than {@link DURATION_RANK_LIMIT}. */
  medianMs: number | null
  p90Ms: number | null
}

interface StatsBucketData {
  start: string
  end: string
  started: Count
  ended: Count
  /** Per end event (its activity id), the instances that ended in the bucket and reached it. */
  endedAt: Record<string, Count>
}

interface EndEventStats {
  activityId: string
  /** Its name in the newest diagram that names it. */
  name: string | null
  /** The instances that ended in the range and reached it. */
  ended: Count
  durations: DurationStats | null
}

export interface ProcessStatsData {
  engine: string
  processDefinitionKey: string
  processDefinitionName: string | null
  asOf: string
  /** The versions the numbers span: every deployed one. */
  versions: { count: number; latestVersion: number; latestDefinitionId: string }
  /** What holds now, as the cockpit's process detail counts it. */
  now: {
    running: number
    /** Open root incidents: a call activity's copy counts in the called process. */
    incidents: number
    /** Instances with an open incident, from the runtime. */
    withIncident: number
    failedJobs: number
    openTasks: number
    startedLast24h: Count
    endedLast24h: Count
  }
  range: { from: string; to: string; bucket: StatsBucket; timeZone: string }
  /**
   * The shortest history time to live of the versions (days; null: kept for good) and the instant
   * before which the engine may have removed history: a count of a bucket that starts earlier is a
   * lower bound. `recorded`: whether the engine writes history; false makes every history count
   * and duration null, null says nothing tells (the history holds nothing and no instance runs).
   */
  history: { timeToLiveDays: number | null; keptFrom: string | null; recorded: boolean | null }
  totals: { started: Count; ended: Count }
  buckets: StatsBucketData[]
  /** The end events directly in the process, of every diagram an ended instance ran on. */
  endEvents: EndEventStats[]
  /** Null where no bucket lies after `history.keptFrom`. */
  durations: DurationStats | null
}

const DEFAULT_TIME_ZONE = "UTC"

/** Versions counted at once while finding those whose instances ended in the range. */
const VERSIONS_AT_ONCE = 4

/**
 * The newest versions counted at most while finding those whose instances ended in the range: a
 * long tail of versions, or history a deleted deployment left behind (no version holds it), never
 * turns the counts into a scan. An end event only an older diagram has is then not listed.
 */
const ENDED_VERSIONS_COUNTED = 3 * VERSIONS_AT_ONCE

/**
 * The most instances a median and a P90 are ranked over: past it, the engine's sort by duration
 * over the window's rows would load its database for one figure, so they read as unknown.
 */
export const DURATION_RANK_LIMIT = 50_000

/** The answers kept per engine and caller at most; past it the least recently used one goes. */
const STATS_FLOOR_ENTRIES = 128

/**
 * The floor under the numbers: a call reads up to a few hundred counts, so a caller's same call
 * within SCREEN_FLOOR_MS (30 s) gets the answer read before, its `asOf` that read's. Kept per
 * engine client and per CALLER (`createCallerCache`); a failed read is not kept.
 */
const statsFloor = createCallerCache<ProcessStatsData>({
  maxEntries: STATS_FLOOR_ENTRIES,
  ttlMs: SCREEN_FLOOR_MS,
  now: () => Date.now(),
})

const iso = (instant: number) => new Date(instant).toISOString()

const BARE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * An ISO 8601 input as an instant: a bare date the start of that day in the buckets' zone, so a
 * range of days is that zone's days; else the engine's reading of it (`toEngineDate`).
 */
function instantOf(input: string | undefined, timeZone: string): number | undefined {
  if (input === undefined) return undefined
  const date = BARE_DATE.exec(input.trim())
  if (date) return dayStartOf(Number(date[1]), Number(date[2]), Number(date[3]), timeZone)
  return engineDateMillis(toEngineDate(input)) ?? undefined
}

/** The engine's bounds hold both ends, so a span's end goes a millisecond short. */
const startedIn = (span: BucketSpan) => ({
  startedAfter: toEngineDate(new Date(span.start)),
  startedBefore: toEngineDate(new Date(span.end - 1)),
})
const endedIn = (span: BucketSpan) => ({
  finishedAfter: toEngineDate(new Date(span.start)),
  finishedBefore: toEngineDate(new Date(span.end - 1)),
})

type HistoryFilter = Record<string, string>

function shortestTimeToLive(versions: readonly DefinitionVersion[]): number | null {
  const ttls = versions.flatMap((v) => (v.historyTimeToLive === null ? [] : [v.historyTimeToLive]))
  return ttls.length > 0 ? Math.min(...ttls) : null
}

/**
 * The versions whose instances ended in `span`, newest first, counted in turn until they hold the
 * range's `ended`, of the newest {@link ENDED_VERSIONS_COUNTED} at most: the diagrams whose end
 * events the instances can have reached.
 */
async function endedVersions(
  client: Client,
  versions: readonly DefinitionVersion[],
  span: BucketSpan,
  ended: number,
): Promise<DefinitionVersion[]> {
  const found: DefinitionVersion[] = []
  const newest = versions.slice(0, ENDED_VERSIONS_COUNTED)
  let counted = 0
  for (let next = 0; counted < ended && next < newest.length; next += VERSIONS_AT_ONCE) {
    const batch = newest.slice(next, next + VERSIONS_AT_ONCE)
    const counts = await Promise.all(
      batch.map((version) =>
        getHistoricProcessInstancesCount({
          client,
          query: { processDefinitionId: version.id, ...endedIn(span) },
        }).then(countOf),
      ),
    )
    batch.forEach((version, i) => {
      if ((counts[i] ?? 0) > 0) found.push(version)
      counted += counts[i] ?? 0
    })
  }
  return found
}

interface EndEvent {
  id: string
  name: string | null
}

/**
 * The end events directly in the process of each diagram, the latest's first, then those only an
 * older diagram an ended instance ran on has; each named by the newest diagram that names it.
 */
async function endEventsOf(
  client: Client,
  key: string,
  diagrams: readonly DefinitionVersion[],
): Promise<{ events: EndEvent[]; latestXml: string | null }> {
  const xmls = await mapLimit(diagrams, VERSIONS_AT_ONCE, (version) =>
    fetchDefinitionXml(client, version.id),
  )
  const events = new Map<string, string | null>()
  for (const xml of xmls) {
    if (xml === null) continue
    const names = readBpmnNames(xml).elements
    for (const id of bpmnProcessEndEventIds(xml, key)) {
      const name = Object.hasOwn(names, id) ? names[id] : null
      if (!events.has(id) || (events.get(id) === null && name !== null)) events.set(id, name)
    }
  }
  return {
    events: [...events].map(([id, name]) => ({ id, name })),
    latestXml: xmls[0] ?? null,
  }
}

/** The nearest rank of the quantile `q` of `n` values: a value that occurred, never a blend. */
const rankOf = (n: number, q: number) => Math.max(1, Math.ceil(q * n))

/**
 * The median and P90 of the `ended` instances `filter` finds: the duration at each rank in the
 * engine's order by duration, one row each. Each such read sorts the window's history in the
 * engine's database, so they go one at a time per engine (`oneAtATime`), whoever asks.
 */
async function durationsOf(
  client: Client,
  filter: HistoryFilter,
  from: number,
  ended: number,
): Promise<DurationStats> {
  const unknown = { from: iso(from), ended, medianMs: null, p90Ms: null }
  if (ended === 0 || ended > DURATION_RANK_LIMIT) return unknown
  const at = async (rank: number) => {
    const [row] = rowsOf<{ durationInMillis?: number | null }>(
      await oneAtATime(client, () =>
        getHistoricProcessInstances({
          client,
          query: {
            ...filter,
            sortBy: "duration",
            sortOrder: "asc",
            firstResult: rank - 1,
            maxResults: 1,
          },
        }),
      ),
    )
    return typeof row?.durationInMillis === "number" ? row.durationInMillis : null
  }
  // One row where both ranks name the same instance (a single one ended).
  const median = rankOf(ended, 0.5)
  const p90 = rankOf(ended, 0.9)
  const [medianMs, p90Ms] = await Promise.all([
    at(median),
    p90 === median ? Promise.resolve(null) : at(p90),
  ])
  return { from: iso(from), ended, medianMs, p90Ms: p90 === median ? medianMs : p90Ms }
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/** The counts per bucket: started, ended, and per end event its total and its buckets. */
interface Series {
  startedPer: number[]
  endedPer: number[]
  endTotals: number[]
  endedAt: number[][]
}

type CountOf = (filter: HistoryFilter) => Promise<number>

/**
 * Every series per bucket, each only where the range holds any (one bucket is the range itself),
 * and an end event's bucket only where an instance ended in it.
 */
async function readSeries(
  count: CountOf,
  range: BucketRange,
  totals: { started: number; ended: number },
  events: readonly EndEvent[],
): Promise<Series> {
  const { buckets } = range
  const whole = { start: range.from, end: range.to }
  const perBucket = (
    total: number,
    read: (span: BucketSpan) => Promise<number>,
    gate?: number[],
  ) =>
    buckets.length === 1
      ? Promise.resolve([total])
      : total === 0
        ? Promise.resolve(buckets.map(() => 0))
        : mapLimit(buckets, PARALLEL, (span, i) =>
            gate !== undefined && gate[i] === 0 ? Promise.resolve(0) : read(span),
          )
  const [startedPer, endedPer, endTotals] = await Promise.all([
    perBucket(totals.started, (span) => count(startedIn(span))),
    perBucket(totals.ended, (span) => count(endedIn(span))),
    totals.ended === 0
      ? Promise.resolve(events.map(() => 0))
      : mapLimit(events, PARALLEL, (event) =>
          count({ ...endedIn(whole), executedActivityIdIn: event.id }),
        ),
  ])
  const endedAt = await mapLimit(events, 1, (event, e) =>
    perBucket(
      endTotals[e] ?? 0,
      (span) => count({ ...endedIn(span), executedActivityIdIn: event.id }),
      endedPer,
    ),
  )
  return { startedPer, endedPer, endTotals, endedAt }
}

/** The history the engine keeps: from when it keeps it whole, and whether it writes any. */
interface KeptHistory {
  keptFrom: number | null
  recorded: boolean | null
}

/**
 * How a count of a span reads: a lower bound where the span starts before the history kept, and
 * unknown on an engine that writes no history.
 */
function countReader({ keptFrom, recorded }: KeptHistory) {
  return (n: number, start: number): Count =>
    recorded === false ? null : keptFrom !== null && start < keptFrom ? { atLeast: n } : n
}

/**
 * The median and P90 overall and per end event, over the buckets the history keeps whole: from
 * the first that starts at or after `keptFrom` to the range's end; none where no bucket does, or
 * the engine writes no history.
 */
async function readDurations(
  client: Client,
  key: string,
  range: BucketRange,
  { keptFrom, recorded }: KeptHistory,
  series: Series,
  events: readonly EndEvent[],
): Promise<{ durations: DurationStats | null; perEvent: (DurationStats | null)[] }> {
  const kept = range.buckets.findIndex((span) => keptFrom === null || span.start >= keptFrom)
  const keptStart = recorded === false ? undefined : range.buckets[kept]?.start
  if (keptStart === undefined) return { durations: null, perEvent: events.map(() => null) }
  const span = { start: keptStart, end: range.to }
  const inSpan = (per: readonly number[]) => sum(per.slice(kept))
  const filter = { processDefinitionKey: key, ...endedIn(span) }
  const [durations, ...perEvent] = await Promise.all([
    durationsOf(client, filter, keptStart, inSpan(series.endedPer)),
    ...events.map((event, e) =>
      durationsOf(
        client,
        { ...filter, executedActivityIdIn: event.id },
        keptStart,
        inSpan(series.endedAt[e] ?? []),
      ),
    ),
  ])
  return { durations: durations ?? null, perEvent }
}

async function readProcessStats(
  client: Client,
  engineId: string,
  args: ProcessStatsArgs,
  nowMs: number,
): Promise<ProcessStatsData> {
  const key = args.processDefinitionKey
  // The schema admits a zone this runtime knows; the answer names it as the runtime spells it.
  const timeZone = canonicalTimeZone(args.timeZone ?? DEFAULT_TIME_ZONE) ?? DEFAULT_TIME_ZONE
  const [from, to] = [instantOf(args.from, timeZone), instantOf(args.to, timeZone)]
  const range = bucketsOf({ from, to, bucket: args.bucket, timeZone }, nowMs)
  const whole = { start: range.from, end: range.to }
  const day = { start: nowMs - DAY_MS, end: nowMs }
  const count = (filter: HistoryFilter) =>
    getHistoricProcessInstancesCount({
      client,
      query: { processDefinitionKey: key, ...filter },
    }).then(countOf)
  const [versions, running, withIncident, failedJobs, openTasks, statsByKey, ...history] =
    await Promise.all([
      // Primary: an unknown key is a not-found error, never a view of zeros.
      fetchDefinitionVersions(client, key),
      countRunningInstances(client, key),
      countWithIncident(enginePortFor(client), { processDefinitionKey: key }),
      countFailedJobs(client, key),
      getTasksCount({ client, query: { processDefinitionKey: key } }).then(countOf),
      fetchStatsByKey(client, {}),
      count(startedIn(whole)),
      count(endedIn(whole)),
      count(startedIn(day)),
      count(endedIn(day)),
    ])
  const [startedTotal = 0, endedTotal = 0, startedDay = 0, endedDay = 0] = history
  const latest = versions[0]
  if (latest === undefined) throw unknownKeyError(key)

  const ttl = shortestTimeToLive(versions)
  const keptFrom = ttl === null ? null : nowMs - ttl * DAY_MS
  // A history that holds something is written; where it holds nothing, the engine may write none.
  const recorded = history.some((n) => n > 0) ? true : await recordsHistory(client)
  const kept: KeptHistory = { keptFrom, recorded }
  const counted = countReader(kept)

  const ended = await endedVersions(client, versions, whole, endedTotal)
  const { events, latestXml } = await endEventsOf(client, key, [
    latest,
    ...ended.filter((version) => version.id !== latest.id),
  ])

  const { buckets } = range
  const series = await readSeries(
    count,
    range,
    { started: startedTotal, ended: endedTotal },
    events,
  )
  const { durations, perEvent } = await readDurations(client, key, range, kept, series, events)
  const { startedPer, endedPer, endTotals, endedAt } = series

  return {
    engine: engineId,
    processDefinitionKey: key,
    processDefinitionName: latest.name ?? bpmnProcessNameOf(readBpmnNames(latestXml ?? ""), key),
    asOf: iso(nowMs),
    versions: {
      count: versions.length,
      latestVersion: latest.version,
      latestDefinitionId: latest.id,
    },
    now: {
      running,
      incidents: statsByKey.get(key)?.incidentCount ?? 0,
      withIncident,
      failedJobs,
      openTasks,
      startedLast24h: counted(startedDay, day.start),
      endedLast24h: counted(endedDay, day.start),
    },
    range: { from: iso(range.from), to: iso(range.to), bucket: args.bucket, timeZone },
    history: {
      timeToLiveDays: ttl,
      keptFrom: keptFrom === null ? null : iso(keptFrom),
      recorded,
    },
    totals: { started: counted(startedTotal, range.from), ended: counted(endedTotal, range.from) },
    buckets: buckets.map((span, i) => ({
      start: iso(span.start),
      end: iso(span.end),
      started: counted(startedPer[i] ?? 0, span.start),
      ended: counted(endedPer[i] ?? 0, span.start),
      endedAt: Object.fromEntries(
        events.map((event, e) => [event.id, counted(endedAt[e]?.[i] ?? 0, span.start)]),
      ),
    })),
    endEvents: events.map((event, e) => ({
      activityId: event.id,
      name: event.name,
      ended: counted(endTotals[e] ?? 0, range.from),
      durations: perEvent[e] ?? null,
    })),
    durations,
  }
}

/**
 * The numbers of `args` on the engine behind `client`, kept for 30 s per caller and arguments
 * (`statsFloor`). A key the engine has no version of is a not-found error, a range the buckets
 * refuse a tool error naming the parameters.
 */
export function buildProcessStatsData(
  client: Client,
  engineId: string,
  args: ProcessStatsArgs,
  nowMs?: number,
): Promise<ProcessStatsData> {
  const id = JSON.stringify([
    args.processDefinitionKey,
    args.from ?? null,
    args.to ?? null,
    args.bucket,
    args.timeZone ?? DEFAULT_TIME_ZONE,
  ])
  return statsFloor(client, id, () => readProcessStats(client, engineId, args, nowMs ?? Date.now()))
}
