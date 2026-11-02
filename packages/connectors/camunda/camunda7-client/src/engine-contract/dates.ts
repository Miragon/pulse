/**
 * Engine dates. CIB Seven / Camunda 7 / Operaton parse EVERY date — query
 * filters, request bodies, `Date` variables — with one Java pattern,
 * `yyyy-MM-dd'T'HH:mm:ss.SSSZ`, where `Z` is a `±HHMM` offset. A literal "Z",
 * an offset with a colon, missing milliseconds or a bare date are all 400s.
 * Tools therefore accept ordinary ISO 8601 at their boundary and convert it
 * here, once.
 */

/** Example of the accepted input forms, for error messages and descriptions. */
export const ENGINE_DATE_INPUT_FORMS =
  "ISO 8601: a date (2026-10-01, midnight UTC) or a date-time with offset (2026-10-01T08:30:00Z, 2026-10-01T08:30:00.000+02:00)"

// date [ T time [ .fraction ] offset ] — the time part needs its offset: a
// local time without one would mean "the ENGINE's time zone", silently.
const ISO_INPUT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?([Zz]|[+-]\d{2}(?::?\d{2})?))?$/

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

function parse(input: string): Parts | null {
  const m = ISO_INPUT.exec(input.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s, fraction, rawOffset] = m
  const offset = engineOffset(rawOffset)
  const parts: Parts = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h ?? 0),
    minute: Number(mi ?? 0),
    second: Number(s ?? 0),
    // The engine keeps milliseconds; finer digits are cut, never rounded up
    // into the next second.
    millis: (fraction ?? "").slice(0, 3).padEnd(3, "0"),
    offset: offset ?? "",
  }
  if (offset === null || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null
  // Calendar check: Date.UTC rolls 2026-02-30 over to March — refuse instead.
  const probe = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (probe.getUTCMonth() !== parts.month - 1 || probe.getUTCDate() !== parts.day) return null
  return parts
}

/** Whether `input` is an ISO 8601 date the engine contract can convert. */
export function isEngineDateInput(input: string): boolean {
  return parse(input) !== null
}

/**
 * ISO 8601 (or a `Date`) → the engine's `yyyy-MM-dd'T'HH:mm:ss.SSS±HHMM`.
 * A string keeps its own offset (`Z` becomes `+0000`), so the instant is
 * unchanged; a bare date means midnight UTC; a `Date` is written in UTC.
 * Throws a `RangeError` naming the accepted forms for anything else.
 */
export function toEngineDate(input: string | Date): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new RangeError("Invalid date: not a valid Date")
    return input.toISOString().replace("Z", "+0000")
  }
  const parts = parse(input)
  if (!parts) throw new RangeError(`Invalid date "${input}": expected ${ENGINE_DATE_INPUT_FORMS}`)
  const date = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`
  const time = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${parts.millis}`
  return `${date}T${time}${parts.offset}`
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
  const parts = value ? parse(value) : null
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
    const millis = engineDateMillis(value)
    if (millis !== null && (best === null || pick(millis, best.millis))) {
      best = { value: value as string, millis }
    }
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
