import type { ToneVariant } from "@miragon/mcp-toolkit-ui"

/** #322 U14: open incidents and jobs without retries are `danger`; other counts carry no tone. Warning is for what can still recover on its own, never for these counts. */

export function countTone(count: number | null | undefined): ToneVariant {
  return (count ?? 0) > 0 ? "danger" : "neutral"
}

/** Neutral when nothing runs (never a green "healthy" over an idle deployment). */
export function severityTone(
  failedJobs: number,
  totalIncidents: number,
  instances: number,
): ToneVariant {
  if (totalIncidents > 0 || failedJobs > 0) return "danger"
  if (instances === 0) return "neutral"
  return "success"
}
