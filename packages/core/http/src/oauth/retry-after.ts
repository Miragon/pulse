/**
 * The wait a `Retry-After` header asks for (RFC 9110 §10.2.3): a number of seconds, or an HTTP
 * date in any of its three forms, measured against the answer's own `Date` so a skewed local
 * clock changes nothing. Anything else, a date in the past included, asks for no wait.
 */

type DateParts = Readonly<Record<string, string | undefined>>

const DELAY_SECONDS = /^\d+$/
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY_NAME = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)"
const LONG_DAY_NAME = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"
const MONTH = `(?<month>${MONTHS.join("|")})`
const DAY = "(?<day>0[1-9]|[12]\\d|3[01])"
const ASCTIME_DAY = "(?<day> [1-9]|0[1-9]|[12]\\d|3[01])"
const TIME = "(?<hour>[01]\\d|2[0-3]):(?<minute>[0-5]\\d):(?<second>[0-5]\\d|60)"

/** IMF-fixdate, the obsolete RFC 850 date and asctime, the forms RFC 9110 §5.6.7 names. */
const HTTP_DATES: readonly RegExp[] = [
  new RegExp(`^${DAY_NAME}, ${DAY} ${MONTH} (?<year>\\d{4}) ${TIME} GMT$`),
  new RegExp(`^${LONG_DAY_NAME}, ${DAY}-${MONTH}-(?<shortYear>\\d{2}) ${TIME} GMT$`),
  new RegExp(`^${DAY_NAME} ${MONTH} ${ASCTIME_DAY} ${TIME} (?<year>\\d{4})$`),
]

/** A two-digit year lies at most this many years ahead (RFC 9110 §5.6.7). */
const SHORT_YEAR_WINDOW = 50

function fullYearOf(shortYear: number, now: number): number {
  const thisYear = new Date(now).getUTCFullYear()
  const year = thisYear - (thisYear % 100) + shortYear
  return year > thisYear + SHORT_YEAR_WINDOW ? year - 100 : year
}

function utcOf(parts: DateParts, now: number): number {
  const year =
    parts.year === undefined ? fullYearOf(Number(parts.shortYear), now) : Number(parts.year)
  return Date.UTC(
    year,
    MONTHS.indexOf(String(parts.month)),
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
}

/** An HTTP date in epoch ms, NaN for anything else. */
function dateOf(value: string, now: number): number {
  for (const form of HTTP_DATES) {
    const parts = form.exec(value)?.groups
    if (parts !== undefined) return utcOf(parts, now)
  }
  return Number.NaN
}

/**
 * The wait in ms the `retry-after` header of `headers` (names in lower case) asks for, measured
 * from the answer's `date` (else from `now`); undefined for none, a malformed one or a date that
 * passed.
 */
export function retryAfterMs(
  headers: Readonly<Record<string, string>>,
  now: number,
): number | undefined {
  const value = String(headers["retry-after"])
  let waitMs: number
  if (DELAY_SECONDS.test(value)) {
    waitMs = Number(value) * 1000
  } else {
    const answeredAt = dateOf(String(headers.date), now)
    waitMs = dateOf(value, now) - (Number.isNaN(answeredAt) ? now : answeredAt)
  }
  return waitMs > 0 ? waitMs : undefined
}
