/**
 * The floor under a process's numbers (`engine_process_stats`, F29, owner decision 2026-11-26): a
 * build reads up to a few hundred counts, so a caller's call of the same range gets the answer
 * built before while that stands: 30 s (SCREEN_FLOOR_MS) from its oldest read (`asOf`, `readAt`)
 * once it answered, and however long it waits its turn before (`ageFromAnswer`). It keys on the
 * range the build reads, never the raw arguments: the zone as the runtime spells it, an explicit
 * `from` cut down and `to` cut up to a whole minute (`wholeMinutes`), a `to` the cut brings to now
 * or later as one left out, read up to now as of the build. So arguments a few milliseconds apart
 * share one build; the answer's `range` is the one served and `range.cut` says where it differs
 * from what the call asked, and a build up to a now at or before the asked `from` is never served:
 * the call takes it off the floor and asks again, until a build that holds its span answers, its
 * own at the latest. Builds go one at a time per engine through a gate of their own (`createGate`),
 * so distinct ranges queue instead of loading the engine at once, while the single reads of
 * `oneAtATime` (the Throughput statistics, a build's ranks) wait for no whole build. The range, the
 * last 24 hours and the `asOf` they bound are fixed when the call comes, and a range the buckets
 * refuse is refused then, before any wait in the queue. Kept per engine client and per CALLER
 * (`callerCacheKey`: a renewed token reads anew); a failed build is not kept, nor one that misses a
 * part (`withPartsWatched`), and a write to the engine drops every caller's (`dropOnWrite`).
 */

import type { Client } from "@miragon/pulse-c7-client"
import { engineDateMillis, toEngineDate } from "@miragon/pulse-c7-core"
import {
  createGate,
  createHeldCache,
  engineClientKey,
  type HeldRead,
} from "../lib/engine/per-engine.js"
import { type WatchedAnswer, withPartsWatched } from "./answer-parts.js"
import { type ProcessStatsData, readProcessStats } from "./process-stats-data.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"
import {
  type BucketRequest,
  bucketsOf,
  canonicalTimeZone,
  dayStartOf,
  type StatsBucket,
  wholeMinutes,
} from "./stats-buckets.js"

export interface ProcessStatsArgs {
  processDefinitionKey: string
  /** ISO 8601, as the schema takes it. */
  from?: string
  to?: string
  bucket: StatsBucket
  /** IANA: the buckets' days and hours, and the day a bare `from` or `to` is (default UTC). */
  timeZone?: string
}

const DEFAULT_TIME_ZONE = "UTC"

/**
 * The answers kept per engine and caller (past it the caller's least recently used one goes) and
 * the callers per engine (past it the least recently active caller's go): per engine at most
 * 4 × 32 (128) answers.
 */
const STATS_FLOOR_BOUNDS = { maxEntries: 4, maxCallers: 32 }

const statsFloor = createHeldCache<WatchedAnswer<ProcessStatsData>>({
  ...STATS_FLOOR_BOUNDS,
  ttlMs: SCREEN_FLOOR_MS,
  now: () => Date.now(),
  keep: ({ complete }) => complete,
  // Its time is its oldest read's (`asOf`, the statistics' at the latest): it ages with that read.
  readAt: ({ value }) => Date.parse(value.asOf),
  ageFromAnswer: true,
  dropOnWrite: true,
})

/** The builds' turns: one at a time per engine, apart from the single reads of `oneAtATime`. */
const buildTurn = createGate()

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

/** The range `args` ask for, as instants in the zone the runtime spells (the schema admits it). */
function askedOf(args: ProcessStatsArgs): BucketRequest {
  const timeZone = canonicalTimeZone(args.timeZone ?? DEFAULT_TIME_ZONE) ?? DEFAULT_TIME_ZONE
  const from = instantOf(args.from, timeZone)
  const to = instantOf(args.to, timeZone)
  return { bucket: args.bucket, timeZone, from, to }
}

type ServedRange = ProcessStatsData["range"]

/**
 * Whether the answer's `range` holds the span asked: a build up to now as of its build, kept or
 * still out when the call joined it, holds none of it where the asked `from` lies at or past its
 * `to`.
 */
const holds = (range: ServedRange, asked: BucketRequest) =>
  asked.from === undefined || asked.from < Date.parse(range.to)

/**
 * Where the range served differs from the one asked: an explicit `from` cut down to a whole minute,
 * an explicit `to` cut up to one or, where the cut brings it to now or later (`toNow`), read up to
 * now as of the build, which can end before the asked `to`.
 */
function cutOf(asked: BucketRequest, toNow: boolean, range: ServedRange): string | undefined {
  const [from, to] = [Date.parse(range.from), Date.parse(range.to)]
  const cuts: string[] = []
  if (asked.from !== undefined && from !== asked.from) cuts.push("from cut down to a whole minute")
  if (asked.to !== undefined && to !== asked.to) {
    const before = to < asked.to ? ", which ends before the asked to" : ""
    cuts.push(toNow ? `to read up to now as of the build${before}` : "to cut up to a whole minute")
  }
  return cuts.length > 0 ? cuts.join("; ") : undefined
}

/**
 * The first answer of `floored` that holds the span `asked`. One that does not (a build up to a now
 * at or before the asked `from`, another call's) is let go and the floor asked again: a build this
 * call joined while it was out comes back as kept, and a kept answer the call is handed it takes
 * off (`HeldRead.release`), so the next build, this call's own at the latest, answers the key and
 * holds the span. Each answer passed over was built by a call that came before this one, so the
 * turns end.
 */
async function holdingAnswer(
  floored: () => HeldRead<WatchedAnswer<ProcessStatsData>>,
  asked: BucketRequest,
): Promise<ProcessStatsData> {
  const kept = floored()
  const { value } = await kept.read
  if (holds(value.range, asked)) return value
  kept.release()
  return holdingAnswer(floored, asked)
}

/**
 * The numbers of `args` on the engine behind `client`: the build of their range this caller made
 * that still answers and holds the span asked, else one built in the builds' turn
 * (`holdingAnswer`). A key the engine has no version of is a not-found error, a range the buckets
 * refuse a tool error naming the parameters.
 */
export async function buildProcessStatsData(
  client: Client,
  engineId: string,
  args: ProcessStatsArgs,
): Promise<ProcessStatsData> {
  const nowMs = Date.now()
  const asked = askedOf(args)
  const request = wholeMinutes(asked, nowMs)
  const range = bucketsOf(request, nowMs)
  const { processDefinitionKey } = args
  const { bucket, timeZone } = request
  const id = JSON.stringify([processDefinitionKey, request.from, request.to, bucket, timeZone])
  const query = { processDefinitionKey, range, bucket, timeZone }
  const floored = () =>
    statsFloor(engineClientKey(client), id, () =>
      buildTurn(client, () =>
        withPartsWatched(client, (watched) => readProcessStats(watched, engineId, query, nowMs)),
      ),
    )
  const value = await holdingAnswer(floored, asked)
  const cut = cutOf(asked, request.to === undefined, value.range)
  return cut === undefined ? value : { ...value, range: { ...value.range, cut } }
}
