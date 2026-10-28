import { earliestEngineDate, engineDateMillis } from "@miragon/pulse-camunda7-client"

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

/**
 * A different exception at the same activity and type is a different root cause.
 * Volatile tokens (ids, numbers, quoted values) are masked so instance noise
 * doesn't split one cause into hundreds of clusters.
 */
export function messageSignature(msg: string | null): string {
  if (!msg) return ""
  return msg
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/g, "<id>")
    .replace(/'[^']*'/g, "'<v>'")
    .replace(/"[^"]*"/g, '"<v>"')
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 160)
}
