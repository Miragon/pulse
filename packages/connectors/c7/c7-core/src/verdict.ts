/**
 * The family's one live verdict on an engine: the status triage (`engine_status`, `pulse status`)
 * and the MCP cockpit's overview both decide `ok`, `warning` or `critical` here, by the same
 * thresholds, over incidents grouped by the same cause and in the same words.
 */

import type { EngineStatus, Severity } from "./findings.js"
import { messageSignature } from "./message-signature.js"

/**
 * When open incidents make an engine critical; a small installation may turn critical at 10
 * where a large one tolerates hundreds (the MCP server reads them from `ENGINE_HEALTH_*`).
 */
export interface VerdictThresholds {
  /** Open incidents from which the engine is critical. */
  readonly criticalIncidents: number
  /** Incidents of one cause (`causeKeyOf`) from which it is critical. */
  readonly criticalClusterSize: number
}

export const DEFAULT_VERDICT_THRESHOLDS: VerdictThresholds = {
  criticalIncidents: 50,
  criticalClusterSize: 25,
}

/** The fields of an engine incident its cause is read from. */
export interface CauseFields {
  readonly activityId?: unknown
  readonly incidentType?: unknown
  readonly incidentMessage?: unknown
}

/** One cause of incidents: activity, incident type and message signature, across definitions. */
export interface IncidentCauseKey {
  readonly activityId: string
  readonly incidentType: string
  readonly signature: string
  /** `<activityId>::<incidentType>::<signature>`: the cockpit's cluster id, a route id. */
  readonly key: string
}

/** The activity of an incident without one (a batch or standalone job). */
const UNKNOWN_ACTIVITY = "(unknown)"

function text(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

/**
 * The cause of an incident, over every definition that shares the activity id: the cockpit
 * clusters by it and the verdict counts by it. Its key is a route id of the cockpit's cluster
 * links, so a change breaks the links stored in earlier results.
 */
export function causeKeyOf(incident: CauseFields): IncidentCauseKey {
  const activityId = text(incident.activityId, UNKNOWN_ACTIVITY)
  const incidentType = text(incident.incidentType, "unknown")
  const signature = messageSignature(text(incident.incidentMessage, ""))
  return {
    activityId,
    incidentType,
    signature,
    key: `${activityId}::${incidentType}::${signature}`,
  }
}

/**
 * The cause with the most incidents, and their count; the first one seen wins a tie. Undefined
 * without incidents. Over a capped scan the count is a lower bound.
 */
export function largestCause(
  incidents: readonly CauseFields[],
): { readonly cause: IncidentCauseKey; readonly count: number } | undefined {
  const counts = new Map<string, { cause: IncidentCauseKey; count: number }>()
  for (const incident of incidents) {
    const cause = causeKeyOf(incident)
    const entry = counts.get(cause.key) ?? { cause, count: 0 }
    entry.count += 1
    counts.set(cause.key, entry)
  }
  let largest: { cause: IncidentCauseKey; count: number } | undefined
  for (const entry of counts.values()) {
    if (largest === undefined || entry.count > largest.count) largest = entry
  }
  return largest
}

export interface VerdictInput {
  /** Every open incident in scope, from a count (never a capped page). */
  readonly openIncidents: number
  /**
   * The incidents of the largest cause (`largestCause`); a lower bound when they were read from a
   * capped scan, so it never raises a false `critical`.
   */
  readonly largestCluster: number
  /** The severities of the caller's other findings (overdue jobs, workers, batches), if it has any. */
  readonly findings?: readonly { readonly severity: Severity }[]
}

/** Whether the open incidents alone make the engine critical. */
export function incidentsAtThreshold(
  input: Pick<VerdictInput, "openIncidents" | "largestCluster">,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): boolean {
  return (
    input.openIncidents >= thresholds.criticalIncidents ||
    input.largestCluster >= thresholds.criticalClusterSize
  )
}

/**
 * `critical` from `criticalIncidents` open incidents, from `criticalClusterSize` of one cause or
 * with a critical finding; `warning` with any open incident or any other finding; else `ok`.
 */
export function engineVerdict(
  input: VerdictInput,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): EngineStatus {
  const findings = input.findings ?? []
  if (
    incidentsAtThreshold(input, thresholds) ||
    findings.some((finding) => finding.severity === "critical")
  ) {
    return "critical"
  }
  return input.openIncidents > 0 || findings.length > 0 ? "warning" : "ok"
}

/** When incidents make the engine critical, in words with the thresholds in force. */
export function criticalIncidentsRule(
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): string {
  return `>=${thresholds.criticalIncidents} open incidents or >=${thresholds.criticalClusterSize} of one cause`
}
