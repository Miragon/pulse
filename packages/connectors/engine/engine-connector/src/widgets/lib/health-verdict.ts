import { formatNumber, SITUATION_TONES, type ToneVariant } from "@miragon/pulse-ui"
import { describeError } from "@miragon/pulse-widget-shell/widgets"
import type { EngineHealthData, EngineHealthStatus } from "../../view-models.js"
import type { T } from "../../messages/use-t.js"

/**
 * c7-core's one live verdict as a tone: the overview's badge and the engine's dot on the
 * landing and the fleet view, so one engine never shows two states. An engine that runs without a
 * problem is the table's `healthy`, neutral as a process is: never a green "healthy".
 */
export const VERDICT_TONE: Record<EngineHealthStatus, ToneVariant> = {
  ok: SITUATION_TONES.healthy,
  warning: "warning",
  critical: SITUATION_TONES.openIncident,
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

/**
 * Why an engine's live health could not be read, as the landing, the cross-engine view's cards and
 * its landscape name it (#322 U15) and the overview's hand-off asks it: a profile the server refused
 * (ENGINE_PROFILE_REFUSED: it never asks that engine, so only the operator can fix it), an engine
 * that answered but refused the server's login (HTTP 401, its credentials, or 403, its access:
 * describeError's kinds and words), or one that did not answer as asked. Only the last is
 * unreachable; an engine that sends a 401 runs.
 */
export const HEALTH_FAILURES = ["unreachable", "refused", "unauthorized", "forbidden"] as const

export type HealthFailure = (typeof HEALTH_FAILURES)[number]

export function healthFailureOf(error: unknown): HealthFailure {
  const { kind } = describeError(error, undefined)
  if (kind === "profileRefused") return "refused"
  if (kind === "unauthorized" || kind === "forbidden") return kind
  return "unreachable"
}

export function isHealthFailure(kind: string): kind is HealthFailure {
  return (HEALTH_FAILURES as readonly string[]).includes(kind)
}

/**
 * The tone of a failed read. These are no situations on the engine (`SITUATION_TONES` tones those)
 * but the server's way to it: an engine that does not answer may be down, an outage, so danger; a
 * refused profile or login leaves the engine running and waits only for whoever runs the server to
 * fix its configuration, a degraded engine, so warning.
 */
export const HEALTH_FAILURE_TONE: Readonly<Record<HealthFailure, ToneVariant>> = {
  unreachable: "danger",
  refused: "warning",
  unauthorized: "warning",
  forbidden: "warning",
}
