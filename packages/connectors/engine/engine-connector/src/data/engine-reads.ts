import type { Client } from "@miragon/pulse-c7-client"
import { partMissed } from "./answer-parts.js"

/** A `/…/count` reply's number; a reply without one is a REST contract breach, not a 0. */
export function countOf(res: unknown): number {
  const count = (res as { count?: unknown } | null)?.count
  if (typeof count !== "number") {
    throw new Error("The engine answered a count query without a count.")
  }
  return count
}

/** A list reply's rows; anything but an array is a REST contract breach, not "no rows". */
export function rowsOf<T>(res: unknown): T[] {
  if (!Array.isArray(res)) {
    throw new Error("The engine answered a list query without a list.")
  }
  return res as T[]
}

/**
 * An ENRICHMENT read: its failure degrades to `null` (rendered "—"), never to an empty value. Read
 * over a floor's build (`client`, the view `withPartsWatched` hands it), the failure tells the
 * build its answer misses that part (`partMissed`), so no floor keeps it.
 */
export function optional<T>(read: Promise<T>, client?: Client): Promise<T | null> {
  return read.catch((error: unknown) => {
    if (client !== undefined) partMissed(client, error)
    return null
  })
}

/** The scan feeds enrichment, never a total: totals come from `/count` and statistics. */
export const INCIDENT_SCAN_LIMIT = 200

export const DAY_MS = 24 * 60 * 60 * 1000
