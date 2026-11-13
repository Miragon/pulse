import { SITUATION_TONES } from "./situations.js"
import type { ToneVariant } from "./tone-variant.js"

/**
 * The tone of a count of problems (open incidents, jobs without retries): theirs while there is
 * one, none at zero or for a count nobody measured. Warning is for what can still recover on its
 * own, never for these counts (#322 U14).
 */
export function countTone(count: number | null | undefined): ToneVariant {
  return (count ?? 0) > 0 ? SITUATION_TONES.openIncident : "neutral"
}

/**
 * A process's tone from its counts: an open incident or a job without retries before anything
 * else (even over an idle deployment: the incident outlives its instances), then idle or healthy,
 * both neutral (never a green "healthy").
 */
export function severityTone(
  failedJobs: number,
  totalIncidents: number,
  instances: number,
): ToneVariant {
  if (totalIncidents > 0) return SITUATION_TONES.openIncident
  if (failedJobs > 0) return SITUATION_TONES.jobWithoutRetries
  return instances === 0 ? SITUATION_TONES.idle : SITUATION_TONES.healthy
}
