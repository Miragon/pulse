/**
 * The buckets of a process's numbers over time (`engine_process_stats`): the calendar days or the
 * clock hours of an IANA time zone that a range touches, as instants, so the days a page shows are
 * its reader's days, 23 or 25 hours long where the clocks change. The first bucket starts at the
 * range's start, the last ends at its end, at most now. Pure: no engine, no clock of its own.
 */

/** How long a bucket is: a calendar day or a clock hour of the time zone. */
export type StatsBucket = "day" | "hour"

/** One bucket: from its start (inclusive) to its end (exclusive), in epoch milliseconds. */
export interface BucketSpan {
  readonly start: number
  readonly end: number
}

/** The range the buckets cover, cut to now, and the buckets in order. */
export interface BucketRange {
  readonly from: number
  readonly to: number
  readonly buckets: readonly BucketSpan[]
}

/** What the buckets are asked for: instants (epoch milliseconds) and the zone they follow. */
export interface BucketRequest {
  readonly from?: number
  readonly to?: number
  readonly bucket: StatsBucket
  readonly timeZone: string
}

/** The buckets without a `from`: the last 14 days, today included, or the last 24 hours. */
export const DEFAULT_BUCKETS: Readonly<Record<StatsBucket, number>> = { day: 14, hour: 24 }

/** The buckets one call reads at most: each costs a count per series. */
export const MAX_BUCKETS = 48

const HOUR_MS = 3_600_000

/**
 * Longer than any day or hour of a zone: a day lasts at most 25 hours (26 where a zone moved its
 * date line), an hour at most 2 where the clocks go back.
 */
const SEARCH_SPAN: Readonly<Record<StatsBucket, number>> = { day: 48 * HOUR_MS, hour: 3 * HOUR_MS }

/**
 * The zone's name as this runtime spells it (`Europe/Berlin` for `europe/berlin`, `+01:30`), or
 * null where it knows no such zone. It keeps nothing: a caller's spellings never pile up.
 */
export function canonicalTimeZone(value: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

/** Whether `value` names a time zone this runtime knows (`Europe/Berlin`, `UTC`). */
export function isTimeZone(value: string): boolean {
  return canonicalTimeZone(value) !== null
}

/**
 * The formatters of the zones asked for lately, by their canonical name, at most this many: each
 * holds native memory for as long as it is kept, and a zone is any one a caller names.
 */
export const FORMATTERS_KEPT = 32
const formatters = new Map<string, Intl.DateTimeFormat>()

/** How many formatters are kept now (at most {@link FORMATTERS_KEPT}). */
export function keptFormatters(): number {
  return formatters.size
}

function formatterOf(timeZone: string): Intl.DateTimeFormat {
  const zone = canonicalTimeZone(timeZone)
  if (zone === null) throw new RangeError(`Unknown time zone: ${timeZone}`)
  let format = formatters.get(zone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
    })
  } else {
    // Kept as the zone asked for last: the least recently asked goes first.
    formatters.delete(zone)
  }
  formatters.set(zone, format)
  for (const oldest of formatters.keys()) {
    if (formatters.size <= FORMATTERS_KEPT) break
    formatters.delete(oldest)
  }
  return format
}

/** The local day (or hour) `instant` falls in, as one number that grows with it. */
function unitOf(instant: number, bucket: StatsBucket, format: Intl.DateTimeFormat): number {
  const parts = format.formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0)
  const day = part("year") * 10_000 + part("month") * 100 + part("day")
  return bucket === "day" ? day : day * 100 + part("hour")
}

/**
 * The first instant in (`lo`, `hi`] whose unit reaches `target`, where `lo`'s lies below it and
 * `hi`'s does not: a search to the millisecond, since a zone's offset need not be whole hours.
 */
function firstReaching(
  lo: number,
  hi: number,
  target: number,
  bucket: StatsBucket,
  format: Intl.DateTimeFormat,
): number {
  let below = lo
  let reached = hi
  while (reached - below > 1) {
    const mid = below + Math.floor((reached - below) / 2)
    if (unitOf(mid, bucket, format) >= target) reached = mid
    else below = mid
  }
  return reached
}

/** Where the day (or hour) holding `instant` starts. */
function startOf(instant: number, bucket: StatsBucket, format: Intl.DateTimeFormat): number {
  const unit = unitOf(instant, bucket, format)
  return firstReaching(instant - SEARCH_SPAN[bucket], instant, unit, bucket, format)
}

/** Where the day (or hour) after the one holding `instant` starts. */
function nextStart(instant: number, bucket: StatsBucket, format: Intl.DateTimeFormat): number {
  const unit = unitOf(instant, bucket, format)
  return firstReaching(instant, instant + SEARCH_SPAN[bucket], unit + 1, bucket, format)
}

/**
 * Where the calendar day `year`-`month`-`day` starts in `timeZone`: its local midnight, or its
 * first instant where the clocks skip midnight. A bare date of a range is that day in the zone
 * its buckets follow.
 */
export function dayStartOf(year: number, month: number, day: number, timeZone: string): number {
  const format = formatterOf(timeZone)
  const target = year * 10_000 + month * 100 + day
  // A zone is at most 14 hours off UTC: two days around UTC's midnight hold the local one.
  const guess = Date.UTC(year, month - 1, day)
  return firstReaching(guess - SEARCH_SPAN.day, guess + SEARCH_SPAN.day, target, "day", format)
}

const iso = (instant: number) => new Date(instant).toISOString()

/** Refuses a range whose `from` does not lie before its `to` (at most now), naming both. */
function refuseOrder(from: number, to: number): void {
  if (from >= to) {
    throw new Error(`from (${iso(from)}) must lie before to (${iso(to)}), and to at most now.`)
  }
}

const MINUTE_MS = 60_000

/**
 * `request` as a process's numbers read and keep it (owner decision 2026-11-26): an explicit
 * `from` cut down and an explicit `to` cut up to a whole minute, so instants a few milliseconds
 * apart read one range, which holds the one asked for; a `to` the cut brings to now or later reads
 * up to now as of the build, as one left out does (a build kept from before ends at its own now,
 * which can lie before a `to` asked since). The order is refused before the cut, as bucketsOf
 * refuses it, so the cut never admits a range that ends before it starts.
 */
export function wholeMinutes(request: BucketRequest, now: number): BucketRequest {
  const { from, to, bucket, timeZone } = request
  if (from !== undefined) refuseOrder(from, Math.min(to ?? now, now))
  const end = to === undefined ? now : Math.ceil(to / MINUTE_MS) * MINUTE_MS
  return {
    bucket,
    timeZone,
    ...(from === undefined ? {} : { from: Math.floor(from / MINUTE_MS) * MINUTE_MS }),
    ...(end < now ? { to: end } : {}),
  }
}

/**
 * The buckets of `request` at `now`: from `from` (default: the start of the day 13 days before
 * the last one, or of the hour 23 hours before) to `to` (default and at most: now), cut at the
 * zone's day or hour starts. A range that ends before it starts, or holds more than
 * {@link MAX_BUCKETS} buckets, is refused, naming the parameters.
 */
export function bucketsOf(request: BucketRequest, now: number): BucketRange {
  const format = formatterOf(request.timeZone)
  const { bucket } = request
  const to = Math.min(request.to ?? now, now)
  let from = request.from
  if (from === undefined) {
    from = startOf(to - 1, bucket, format)
    for (let i = 1; i < DEFAULT_BUCKETS[bucket]; i++) from = startOf(from - 1, bucket, format)
  }
  refuseOrder(from, to)
  const buckets: BucketSpan[] = []
  for (let start = from; start < to;) {
    if (buckets.length === MAX_BUCKETS) {
      const wider = bucket === "hour" ? ', or take bucket "day"' : ""
      throw new Error(
        `from ${iso(from)} to ${iso(to)} holds more than ${MAX_BUCKETS} ${bucket} buckets: ` +
          `narrow from and to${wider}.`,
      )
    }
    const end = Math.min(nextStart(start, bucket, format), to)
    buckets.push({ start, end })
    start = end
  }
  return { from, to, buckets }
}
