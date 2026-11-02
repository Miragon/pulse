/** A `/…/count` reply's number; a reply without one is an engine-contract breach, not a 0. */
export function countOf(res: unknown): number {
  const count = (res as { count?: unknown } | null)?.count
  if (typeof count !== "number") {
    throw new Error("The engine answered a count query without a count.")
  }
  return count
}

/** A list reply's rows; anything but an array is an engine-contract breach, not "no rows". */
export function rowsOf<T>(res: unknown): T[] {
  if (!Array.isArray(res)) {
    throw new Error("The engine answered a list query without a list.")
  }
  return res as T[]
}

/** An ENRICHMENT read: its failure degrades to `null` (rendered "—"), never to an empty value. */
export function optional<T>(read: Promise<T>): Promise<T | null> {
  return read.catch(() => null)
}

/** The scan feeds enrichment, never a total: totals come from `/count` and statistics. */
export const INCIDENT_SCAN_LIMIT = 200

export const DAY_MS = 24 * 60 * 60 * 1000
