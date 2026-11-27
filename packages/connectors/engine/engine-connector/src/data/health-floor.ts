/**
 * The floor under the chat's engine health (F123, owner decision 2026-11-26): the health feed, the
 * overview's verdict and the fleet's dots read it, and its build sends the incident scan and the
 * day's history counts beside the engine-wide statistics (`readStatistics`, 30 s per engine and
 * caller), all at once. A caller's health answers again while the statistics read it was built on
 * answers, its 30 s running from that read (`readAt`), so a Refresh within it reads nothing again
 * and the first one after it builds anew with a new read; the bar names that read's time
 * (`fetchedAt`), never a later one. Kept per engine client and per CALLER (`callerCacheKey`: a
 * renewed token reads anew); a build that failed is not kept, nor one that misses a part
 * (`withPartsWatched`), and a write to the engine drops every caller's (`dropOnWrite`).
 */

import type { Client } from "@miragon/pulse-c7-client"
import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import { createOwnerCache, engineClientKey } from "../lib/engine/per-engine.js"
import type { EngineHealthData } from "../view-models.js"
import { type WatchedAnswer, withPartsWatched } from "./answer-parts.js"
import { buildEngineHealthData } from "./health-data.js"
import { STATISTICS_FLOOR_MS } from "./statistics-floor.js"

/**
 * Health answers kept per engine client and caller (one per thresholds); past it the caller's least
 * recently used one goes.
 */
const HEALTH_FLOOR_ENTRIES = 2

/**
 * Callers whose health an engine client keeps; past it the least recently active caller's goes.
 * Per engine at most HEALTH_FLOOR_CALLERS × HEALTH_FLOOR_ENTRIES (64) answers.
 */
const HEALTH_FLOOR_CALLERS = 32

const healthFloor = createOwnerCache<WatchedAnswer<EngineHealthData>>({
  maxEntries: HEALTH_FLOOR_ENTRIES,
  maxCallers: HEALTH_FLOOR_CALLERS,
  ttlMs: STATISTICS_FLOOR_MS,
  now: () => Date.now(),
  keep: ({ complete }) => complete,
  // The health's time is its statistics read's (`fetchedAt`): it ages with that read.
  readAt: ({ value }) => Date.parse(value.fetchedAt),
  dropOnWrite: true,
})

/** The health of `engineId` for this caller, built on the statistics read it answers from. */
export async function cachedEngineHealthData(
  client: Client,
  engineId: string,
  thresholds: VerdictThresholds,
): Promise<EngineHealthData> {
  const id = JSON.stringify([engineId, thresholds])
  const answer = await healthFloor(engineClientKey(client), id, () =>
    withPartsWatched(client, (watched) => buildEngineHealthData(watched, engineId, thresholds)),
  )
  return answer.value
}
