import { earliestEngineDate, engineDateMillis } from "@miragon/pulse-c7-core"

export const HOUR_MS = 60 * 60 * 1000

/**
 * Deeper than `INCIDENT_SCAN_LIMIT` because the clusters are built from it,
 * capped to stay cheap. Past it, a count is null or from `/incident/count`.
 */
export const CLUSTER_SCAN_LIMIT = 2000

export const UNKNOWN = "(unknown)"

export interface IncidentLike {
  id?: string | null
  processDefinitionId?: string | null
  processInstanceId?: string | null
  incidentType?: string | null
  activityId?: string | null
  incidentMessage?: string | null
  incidentTimestamp?: string | null
  /** The incident it copies (a call activity's copy of a called instance's); its own id on a root. */
  rootCauseIncidentId?: string | null
}

/**
 * Whether an incident is a root cause, not a copy: Camunda 7 copies an incident of a called
 * instance to every call activity above it, which names its root in `rootCauseIncidentId`. A cause
 * is formed from root incidents alone, as c7-core's `groupIncidents` forms `engine_status`'s
 * groups, so a failure is one cause however deep it was called; the counts keep every incident.
 */
export function isRootIncident(
  incident: Pick<IncidentLike, "id" | "rootCauseIncidentId">,
): boolean {
  const root = incident.rootCauseIncidentId
  return !root || root === incident.id
}

export interface ScanCoverage {
  complete: boolean
  covers: (sinceMs: number) => boolean
}

export function scanCoverage(rows: IncidentLike[]): ScanCoverage {
  const complete = rows.length < CLUSTER_SCAN_LIMIT
  const oldest = engineDateMillis(earliestEngineDate(rows.map((r) => r.incidentTimestamp)))
  return { complete, covers: (sinceMs) => complete || (oldest !== null && oldest < sinceMs) }
}

/** Engine exception messages can be stacktrace-sized and travel into the render, feed and AI prompt. */
export function truncateMessage(s: string | null, max = 300): string | null {
  if (!s) return null
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
