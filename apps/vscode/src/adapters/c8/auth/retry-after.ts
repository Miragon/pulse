type DateParts = Readonly<Record<string, string | undefined>>

const DELAY_SECONDS = /^\d+$/
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const DAY_NAME = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)"
const LONG_DAY_NAME = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"
const MONTH = `(?<month>${MONTHS.join("|")})`
const DAY = "(?<day>0[1-9]|[12]\\d|3[01])"
const ASCTIME_DAY = "(?<day> [1-9]|0[1-9]|[12]\\d|3[01])"
const TIME = "(?<hour>[01]\\d|2[0-3]):(?<minute>[0-5]\\d):(?<second>[0-5]\\d|60)"
const HTTP_DATES: readonly RegExp[] = [
  new RegExp(`^${DAY_NAME}, ${DAY} ${MONTH} (?<year>\\d{4}) ${TIME} GMT$`),
  new RegExp(`^${LONG_DAY_NAME}, ${DAY}-${MONTH}-(?<shortYear>\\d{2}) ${TIME} GMT$`),
  new RegExp(`^${DAY_NAME} ${MONTH} ${ASCTIME_DAY} ${TIME} (?<year>\\d{4})$`),
]
const SHORT_YEAR_WINDOW = 50

export class RetryAfter {
  static waitMs(headers: Headers, now: number): number | undefined {
    const value = headers.get("Retry-After") ?? ""
    const waitMs = DELAY_SECONDS.test(value)
      ? Number(value) * 1000
      : RetryAfter.untilDate(value, headers, now)
    return waitMs > 0 ? waitMs : undefined
  }

  private static untilDate(value: string, headers: Headers, now: number): number {
    const answeredAt = RetryAfter.dateOf(headers.get("Date") ?? "", now)
    return RetryAfter.dateOf(value, now) - (Number.isNaN(answeredAt) ? now : answeredAt)
  }

  private static dateOf(value: string, now: number): number {
    for (const form of HTTP_DATES) {
      const parts = form.exec(value)?.groups
      if (parts !== undefined) {
        return RetryAfter.utcOf(parts, now)
      }
    }
    return Number.NaN
  }

  private static utcOf(parts: DateParts, now: number): number {
    const year =
      parts.year === undefined
        ? RetryAfter.fullYearOf(Number(parts.shortYear), now)
        : Number(parts.year)
    return Date.UTC(
      year,
      MONTHS.findIndex((month) => month === parts.month),
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    )
  }

  private static fullYearOf(shortYear: number, now: number): number {
    const thisYear = new Date(now).getUTCFullYear()
    const year = thisYear - (thisYear % 100) + shortYear
    return year > thisYear + SHORT_YEAR_WINDOW ? year - 100 : year
  }
}
