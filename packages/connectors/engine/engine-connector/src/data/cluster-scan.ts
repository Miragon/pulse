import type { Client } from "@miragon/pulse-c7-client"
import { getIncidents } from "@miragon/pulse-c7-client/sdk"
import { earliestEngineDate, engineDateMillis } from "@miragon/pulse-c7-core"
import { rowsOf } from "./engine-reads.js"

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
  /**
   * The incident it copies (a call activity's copy of a called instance's); its own id on a root,
   * which c7-core's `isRootIncident` tells. A cause is formed from root incidents alone, as
   * c7-core's `groupIncidents` forms `engine_status`'s groups, so a failure is one cause however
   * deep it was called; the counts keep every incident.
   */
  rootCauseIncidentId?: string | null
  /**
   * The tenant of the run it was raised in: its version's, or one a tenant id provider gave a
   * shared version's run, so never a process's tenant on its own.
   */
  tenantId?: string | null
}

/**
 * The newest open incidents of the engine, `CLUSTER_SCAN_LIMIT` at most, copies included: the
 * scan the cockpit's overview builds its clusters from and the verdict reads its lower bounds of
 * (the root incidents outside any process, the largest cause), the overview's and the web app's
 * verdict feed's alike.
 */
export function scanOpenIncidents(client: Client): Promise<IncidentLike[]> {
  return getIncidents({
    client,
    query: { maxResults: CLUSTER_SCAN_LIMIT, sortBy: "incidentTimestamp", sortOrder: "desc" },
  }).then((rows) => rowsOf<IncidentLike>(rows))
}

/**
 * Whether a process holds the incident: a batch's or the history cleanup's failed job names no
 * process definition. c7-core's verdict tells the root incidents outside any process by the same
 * field (`rootIncidentCounts`), which the overview names apart and never counts as a process's.
 */
export function inAnyProcess({ processDefinitionId }: IncidentLike): boolean {
  return typeof processDefinitionId === "string" && processDefinitionId !== ""
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
