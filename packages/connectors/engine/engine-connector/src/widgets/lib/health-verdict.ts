import { formatNumber, type ToneVariant } from "@miragon/pulse-ui"
import type { EngineHealthData, EngineHealthStatus } from "../../view-models.js"
import type { T } from "../../messages/use-t.js"

/**
 * engine-core's one live verdict as a tone: the overview's badge and the engine's dot on the
 * landing and the fleet view, so one engine never shows two states.
 */
export const VERDICT_TONE: Record<EngineHealthStatus, ToneVariant> = {
  ok: "success",
  warning: "warning",
  critical: "danger",
}

/** #322 U3: the server sends the verdict as data; an empty engine says so instead of "no open incidents". */
export function healthVerdictLine(t: T, data: Pick<EngineHealthData, "summary">): string {
  const { totalIncidents, affectedActivities, runningInstances, totalDefinitions } = data.summary
  if (totalIncidents === 0) {
    return totalDefinitions === 0
      ? t("engineHealth.verdict.nothingDeployed")
      : t("engineHealth.verdict.noIncidents", { running: formatNumber(runningInstances) })
  }
  const count = formatNumber(totalIncidents)
  // Null: the incident scan was capped; left out, never guessed.
  return affectedActivities === null
    ? t("engineHealth.verdict.incidents", { count })
    : t("engineHealth.verdict.incidentsAcross", {
        count,
        activities: formatNumber(affectedActivities),
      })
}
