/**
 * The floor under the definition statistics (F123, owner decision 2026-11-26): ONE read of the
 * whole engine's `/process-definition/statistics` with the failed jobs and the root incidents
 * (c7-core's `readDefinitionStatistics`) per configured engine and CALLER in STATISTICS_FLOOR_MS
 * (30 s). The chat's overview and health, a process's numbers and incidents, the incidents
 * dashboard, an activity's incidents and the key of a bare definition id read the engine-wide
 * statistics, each folding these rows per call (`foldStatsByKey` over c7-core's fold), so a
 * Refresh within the floor, or a view that reads them beside another, sends no second read. It
 * keeps per engine client and per caller (`createCallerCache` over `callerCacheKey`: a renewed
 * token reads anew, under passthrough auth the engine decides per token what a caller may read);
 * a read that failed is not kept, and a write to the engine drops every caller's (`dropOnWrite`),
 * so the views a write invalidates count anew. `readAt` is when the read was sent, which a view's
 * bar names, so its freshness stays honest while the rows answer again.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { type DefinitionStatisticsRow, readDefinitionStatistics } from "@miragon/pulse-c7-core"
import { enginePortFor } from "../lib/core-adapter/engine-port.js"
import { createCallerCache } from "../lib/engine/per-engine.js"
import { SCREEN_FLOOR_MS } from "./screens/screen-floor.js"

/** How long one statistics read answers again for the same engine and caller. */
export const STATISTICS_FLOOR_MS = SCREEN_FLOOR_MS

/**
 * Callers whose read an engine client keeps, one each; past it the least recently active caller's
 * goes: 32 reads per engine at most. Each holds a row per deployed version, so the bound stays low.
 */
const STATISTICS_FLOOR_CALLERS = 32

/** The engine's definition statistics as one read answered them. */
export interface StatisticsRead {
  /** Every deployed version with its instances, failed jobs and open root incidents per type. */
  readonly rows: readonly DefinitionStatisticsRow[]
  /** When the read was sent (epoch milliseconds). */
  readonly readAt: number
}

const statisticsFloor = createCallerCache<StatisticsRead>({
  maxEntries: 1,
  maxCallers: STATISTICS_FLOOR_CALLERS,
  ttlMs: STATISTICS_FLOOR_MS,
  now: () => Date.now(),
  dropOnWrite: true,
})

/** The one id the floor keeps its read under, per engine and caller. */
const STATISTICS_ID = "definition-statistics"

/** The engine's definition statistics for this caller: a read of the last 30 s, else one sent now. */
export function readStatistics(client: Client): Promise<StatisticsRead> {
  return statisticsFloor(client, STATISTICS_ID, async () => {
    const readAt = Date.now()
    const rows = await readDefinitionStatistics(enginePortFor(client), { failedJobs: true })
    return { rows, readAt }
  })
}

/**
 * This caller's statistics read of the last 30 s when one answered and stays, without reading or
 * waiting (`CallerCache.peek`): none while the floor is cold, or its read still out or failed.
 */
export function peekStatistics(client: Client): StatisticsRead | undefined {
  return statisticsFloor.peek(client, STATISTICS_ID)
}
