/**
 * Small pure helpers of the dashboard's reads: engine dates, the viewer's days, quantiles. No
 * React, no DOM, so the recorder (Node) runs the same reads as the page.
 */

export const DAY_MS = 86_400_000

/**
 * An engine date as an instant. The engine writes its offset without a colon
 * (`2026-10-09T13:40:02.112+0000`), which not every browser parses; the colon is put in first.
 */
export function parseEngineDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The instant `days` days before `now`, by instant arithmetic: the same in every time zone, so a
 * recorded window's arguments match when the fixtures replay anywhere.
 */
export function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

/**
 * The starts of the last `days` days in the viewer's time zone, the oldest first, today last
 * (today counts up to now). A day is a calendar day, so one with a clock change has 23 or 25 hours.
 */
export function dayStarts(now: Date, days: number): Date[] {
  const year = now.getFullYear()
  const month = now.getMonth()
  const date = now.getDate()
  return Array.from({ length: days }, (_, i) => new Date(year, month, date - (days - 1 - i)))
}

/**
 * How many of `times` fall on each day of `starts` (from `dayStarts`): a time before the first
 * day, or without a value, counts nowhere.
 */
export function countPerDay(times: readonly (Date | null)[], starts: readonly Date[]): number[] {
  const counts = starts.map(() => 0)
  for (const time of times) {
    if (time === null) continue
    const at = time.getTime()
    for (let i = starts.length - 1; i >= 0; i--) {
      if (at >= starts[i].getTime()) {
        counts[i] += 1
        break
      }
    }
  }
  return counts
}

/**
 * The `q` quantile of `values` by the nearest rank (the median at 0.5, P90 at 0.9): a value that
 * occurred, never an interpolation; `null` for no values.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(q * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]
}

/** Each key's count, the largest first (ties by key), over `keys`. */
export function tally(keys: readonly string[]): { key: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}
