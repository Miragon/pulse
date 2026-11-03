/** Durations as the workflow messages print them. Pure. */

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const

type Unit = keyof typeof UNITS

/** The largest unit first: `formatDuration` prints the largest exact one. */
const LARGEST_FIRST: readonly Unit[] = ["h", "m", "s"]

/** The duration in its largest exact unit: 90000 → `90s`, 120000 → `2m`, 1500 → `1500ms`. */
export function formatDuration(ms: number): string {
  const unit = LARGEST_FIRST.find((candidate) => ms % UNITS[candidate] === 0)
  return unit === undefined ? `${ms}ms` : `${ms / UNITS[unit]}${unit}`
}
