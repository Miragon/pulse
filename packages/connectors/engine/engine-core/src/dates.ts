/**
 * Engine dates. CIB Seven / Camunda 7 / Operaton parse EVERY date — query
 * filters, request bodies, `Date` variables — with one Java pattern,
 * `yyyy-MM-dd'T'HH:mm:ss.SSSZ`, where `Z` is a `±HHMM` offset. A literal "Z",
 * an offset with a colon, missing milliseconds or a bare date are all 400s.
 * Callers therefore accept ordinary ISO 8601 at their boundary and convert it
 * here, once: one parser, read in one of two {@link DateInputReading}s.
 *
 * The read direction has two readers as well: {@link engineDateMillis} (this
 * parser, an offset required) and {@link engineTime} (`Date.parse`, which also
 * reads an offset-less time, in the local zone). Both are kept as they are
 * until the two readings are aligned (a behaviour change, not a move).
 */

/** The relaxed spellings; a time needs its offset. The default of every function here. */
export const OFFSET_REQUIRED = "offset-required"

/** The strict spellings; a time without an offset is UTC. */
export const UTC_WITHOUT_OFFSET = "utc-without-offset"

/**
 * How an ISO 8601 date input is read: a closed set, one reading per interface today (the MCP
 * tools {@link OFFSET_REQUIRED}, the CLI {@link UTC_WITHOUT_OFFSET}). Each keeps its reading until
 * one is chosen for all of them (a behaviour change); its two rules stay internal.
 */
export type DateInputReading = typeof OFFSET_REQUIRED | typeof UTC_WITHOUT_OFFSET

/**
 * The rules of a reading:
 *
 * - `assumeUtc`: a time without an offset reads as UTC (true) or is refused (false: it would mean
 *   the ENGINE's time zone, silently).
 * - `relaxed`: also accepts the relaxed spellings, blanks around the value, a lowercase `t` or a
 *   blank for `T`, a comma before the fraction, a lowercase `z`, an hours-only offset (`+02`),
 *   with at most 9 fraction digits, and checks the calendar through `Date.UTC`, which reads the
 *   years 0000-0099 as 1900-1999 (so 0000-02-29 is refused). Without it only `T`, `.`, `Z` and
 *   a `±HH:MM`/`±HHMM` offset are read, with any number of fraction digits, against the
 *   proleptic Gregorian calendar.
 */
interface ReadingRules {
  readonly assumeUtc: boolean
  readonly relaxed: boolean
}

const READING_RULES: Readonly<Record<DateInputReading, ReadingRules>> = {
  [OFFSET_REQUIRED]: { assumeUtc: false, relaxed: true },
  [UTC_WITHOUT_OFFSET]: { assumeUtc: true, relaxed: false },
}

/** Example of the accepted input forms of {@link OFFSET_REQUIRED}, for error messages and descriptions. */
export const ENGINE_DATE_INPUT_FORMS =
  "ISO 8601: a date (2026-10-01, midnight UTC) or a date-time with offset (2026-10-01T08:30:00Z, 2026-10-01T08:30:00.000+02:00)"

// date [ sep time [ fraction ] [ offset ] ]: the union of both readings' spellings; `isAccepted`
// refuses what the reading does not accept.
const ISO_INPUT =
  /^(\d{4})-(\d{2})-(\d{2})(?:([Tt ])(\d{2}):(\d{2})(?::(\d{2})(?:([.,])(\d+))?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?)?$/

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millis: string
  offset: string
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0")

/** `Z` / `+02` / `+02:00` / `+0200` → `+0000` / `+0200` (null when out of range). */
function engineOffset(raw: string | undefined): string | null {
  if (raw === undefined || raw === "Z" || raw === "z") return "+0000"
  const digits = raw.slice(1).replace(":", "")
  const hours = Number(digits.slice(0, 2))
  const minutes = digits.length > 2 ? Number(digits.slice(2)) : 0
  if (hours > 23 || minutes > 59) return null
  return `${raw[0]}${pad(hours)}${pad(minutes)}`
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

/** The day exists: `Date.UTC` rolls 2026-02-30 over to March (relaxed), or the Gregorian calendar. */
function isCalendarDay(parts: Parts, relaxed: boolean): boolean {
  if (!relaxed) {
    return (
      parts.month >= 1 &&
      parts.month <= 12 &&
      parts.day >= 1 &&
      parts.day <= daysInMonth(parts.year, parts.month)
    )
  }
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  return probe.getUTCMonth() === parts.month - 1 && probe.getUTCDate() === parts.day
}

/** The strict spellings: `T`, `.`, and `Z` or an offset with its minutes (`±HHMM`, `±HH:MM`). */
function isStrictSpelling(
  separator: string | undefined,
  point: string | undefined,
  zone: string | undefined,
): boolean {
  return (
    (separator ?? "T") === "T" &&
    (point ?? ".") === "." &&
    (zone === undefined || zone === "Z" || zone.length > 3)
  )
}

/** A time without an offset only as `assumeUtc`; the spellings of the reading. */
function isAccepted(match: RegExpExecArray, reading: ReadingRules): boolean {
  const [, , , , separator, hour, , , point, fraction, zone] = match
  if (hour !== undefined && zone === undefined && !reading.assumeUtc) return false
  return reading.relaxed ? (fraction?.length ?? 0) <= 9 : isStrictSpelling(separator, point, zone)
}

function toParts(match: RegExpExecArray, offset: string): Parts {
  const [, y, mo, d, , h, mi, s, , fraction] = match
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
    second: Number(s ?? 0),
    // The engine keeps milliseconds; finer digits are cut, never rounded up
    // into the next second.
    millis: (fraction ?? "").slice(0, 3).padEnd(3, "0"),
    offset,
  }
}

function isClockTime(parts: Parts): boolean {
  return parts.hour <= 23 && parts.minute <= 59 && parts.second <= 59
}

function parse(input: string, readingName: DateInputReading): Parts | null {
  const reading = READING_RULES[readingName]
  const match = ISO_INPUT.exec(reading.relaxed ? input.trim() : input)
  if (!match || !isAccepted(match, reading)) return null
  const offset = engineOffset(match[10])
  if (offset === null) return null
  const parts = toParts(match, offset)
  return isClockTime(parts) && isCalendarDay(parts, reading.relaxed) ? parts : null
}

/** Whether `input` is an ISO 8601 date the reading can convert. */
export function isEngineDateInput(
  input: string,
  reading: DateInputReading = OFFSET_REQUIRED,
): boolean {
  return parse(input, reading) !== null
}

/** The engine format of an ISO 8601 date input; undefined when the reading refuses it. */
export function engineDateInput(
  input: string,
  reading: DateInputReading = OFFSET_REQUIRED,
): string | undefined {
  const parts = parse(input, reading)
  if (!parts) return undefined
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
  const time = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${parts.millis}`
  return `${date}T${time}${parts.offset}`
}

/**
 * ISO 8601 (or a `Date`) → the engine's `yyyy-MM-dd'T'HH:mm:ss.SSS±HHMM`.
 * A string keeps its own offset (`Z` becomes `+0000`), so the instant is
 * unchanged; a bare date means midnight UTC; a `Date` is written in UTC.
 * Throws a `RangeError` naming the accepted forms for anything else
 * (read as {@link OFFSET_REQUIRED}).
 */
export function toEngineDate(input: string | Date): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError("Invalid date: not a valid Date")
    return input.toISOString().replace("Z", "+0000")
  }
  const engine = engineDateInput(input)
  if (engine === undefined) {
    throw new RangeError(`Invalid date "${input}": expected ${ENGINE_DATE_INPUT_FORMS}`)
  }
  return engine
}

/** {@link toEngineDate} for optional filters: `undefined` stays `undefined`. */
export function toOptionalEngineDate(input: string | undefined): string | undefined {
  return input === undefined ? undefined : toEngineDate(input)
}

/**
 * The read direction: a timestamp the engine EMITS (`…SSS±HHMM`, its local
 * offset) → epoch millis; null when absent or unparseable. Engine timestamps
 * order by instant, never as text: across a DST change the engine stamps
 * `…+0200` and `…+0100`, and the string order is then off by up to an hour.
 */
export function engineDateMillis(value: string | null | undefined): number | null {
  const parts = value ? parse(value, OFFSET_REQUIRED) : null
  if (!parts) return null
  const sign = parts.offset.startsWith("-") ? -1 : 1
  const offsetMinutes =
    sign * (Number(parts.offset.slice(1, 3)) * 60 + Number(parts.offset.slice(3, 5)))
  const local = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    Number(parts.millis),
  )
  return local - offsetMinutes * 60_000
}

/** The engine timestamp `pick` prefers by instant — returned as given; null when none parses. */
function pickEngineDate(
  values: Iterable<string | null | undefined>,
  pick: (candidate: number, best: number) => boolean,
): string | null {
  let best: { value: string; millis: number } | null = null
  for (const value of values) {
    // absent values never parse
    if (typeof value !== "string") continue
    const millis = engineDateMillis(value)
    if (millis !== null && (best === null || pick(millis, best.millis))) best = { value, millis }
  }
  return best?.value ?? null
}

/** The newest of the given engine timestamps by instant (as given); null when none parses. */
export function latestEngineDate(values: Iterable<string | null | undefined>): string | null {
  return pickEngineDate(values, (candidate, best) => candidate > best)
}

/** The oldest of the given engine timestamps by instant (as given); null when none parses. */
export function earliestEngineDate(values: Iterable<string | null | undefined>): string | null {
  return pickEngineDate(values, (candidate, best) => candidate < best)
}

/** RFC 822 offsets (`+0200`) as ISO offsets (`+02:00`), which every Date parser accepts. */
const RFC822_OFFSET = /([+-]\d{2})(\d{2})$/

/**
 * Milliseconds of an engine timestamp (`2024-05-01T10:00:00.000+0200`), or undefined. Read by
 * `Date.parse`: unlike {@link engineDateMillis} it also reads a time without an offset (in the
 * local zone).
 */
export function engineTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const time = Date.parse(value.replace(RFC822_OFFSET, "$1:$2"))
  return Number.isNaN(time) ? undefined : time
}

/** An instant in the engine format, in UTC: `2024-05-01T08:00:00.000+0000`. */
export function engineFormat(ms: number): string {
  return new Date(ms).toISOString().replace("Z", "+0000")
}
