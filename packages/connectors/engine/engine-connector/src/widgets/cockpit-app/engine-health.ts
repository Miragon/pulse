import type { ToneVariant } from "@miragon/pulse-ui"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitDashboardData, EngineHealthData } from "../../view-models.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_HEALTH_DATA } from "../../tool-names.js"
import { VERDICT_TONE } from "../lib/health-verdict.js"

/**
 * An engine's live health on the landing and the fleet view, read through the engine overview's
 * own two feeds on its query keys, so a drill-in lands on a warm cache: the counts from its
 * definitions feed, the dot from its health feed's verdict (engine-core's `engineVerdict` on the
 * deployment's thresholds), the one the overview's badge shows. Failed jobs stay counted and
 * named; the dot is the verdict's alone.
 */
export function useEngineHealth(engineId: string) {
  const args = { engine: engineId }
  const query = useToolQuery<CockpitDashboardData>(
    ["engine:cockpit-overview", engineId],
    ENGINE_COCKPIT_OVERVIEW_DATA,
    args,
  )
  const health = useToolQuery<EngineHealthData>(
    ["engine:health", engineId],
    ENGINE_HEALTH_DATA,
    args,
  )
  const summary = query.data?.summary
  return {
    query,
    summary,
    incidents: summary?.totalIncidents ?? 0,
    failed: summary?.totalFailedJobs ?? 0,
    tone: dotTone(health.data),
  }
}

/** Neutral until the verdict is read (or when it cannot be), and neutral while it is ok. */
function dotTone(health: EngineHealthData | undefined): ToneVariant {
  if (!health) return "neutral"
  return VERDICT_TONE[health.status]
}
