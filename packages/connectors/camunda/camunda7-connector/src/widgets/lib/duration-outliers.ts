/** "Why so long?" on a 3 ms step is noise (#344 N120). */
export const OUTLIER_FLOOR_MS = 1_000

/** Without the floor a median of 0 made every completed row an outlier. */
export function durationOutliers(
  durations: ReadonlyArray<number | null | undefined>,
): (ms: number | null | undefined) => boolean {
  const completed = durations.filter((d): d is number => d != null).sort((a, b) => a - b)
  if (completed.length === 0) return () => false
  const mid = Math.floor(completed.length / 2)
  const median =
    completed.length % 2 === 0 ? (completed[mid - 1] + completed[mid]) / 2 : completed[mid]
  const max = completed[completed.length - 1]
  const threshold = Math.max(median * 2, OUTLIER_FLOOR_MS)
  return (ms) => ms != null && ms >= OUTLIER_FLOOR_MS && (ms === max || ms >= threshold)
}
