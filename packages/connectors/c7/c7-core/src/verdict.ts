/**
 * The family's one live verdict on an engine: the status triage (`engine_status`, `pulse status`),
 * the MCP cockpit's overview and the web app's verdict feed all decide `ok`, `warning` or
 * `critical` here, by the same thresholds, over the open ROOT incidents (owner decision of
 * 2026-11-20: a failure counts once, where it was raised, however many call activities above it
 * hold a copy), grouped by the same cause and in the same words.
 */

import type { EngineStatus, Severity } from "./findings.js"
import { messageSignature } from "./message-signature.js"
import { isRootIncident } from "./root-incident.js"

/**
 * When open root incidents make an engine critical; a small installation may turn critical at 10
 * where a large one tolerates hundreds (the MCP server reads them from `ENGINE_HEALTH_*`, the CLI
 * takes the defaults). A call activity's copy of a called instance's incident counts toward
 * neither: a chain of calls that one failure stops counts that failure once.
 */
export interface VerdictThresholds {
  /** Open root incidents from which the engine is critical. */
  readonly criticalIncidents: number
  /** Open root incidents of one cause (`causeKeyOf`) from which it is critical. */
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
  /**
   * Every open root incident in scope (`rootIncidentCounts`): the processes' from an exact read
   * (never a capped page), those outside any process from the incidents read.
   */
  readonly openRootIncidents: number
  /**
   * The root incidents of the largest cause (`largestCause` over root incidents alone); a lower
   * bound when they were read from a capped scan, so it never raises a false `critical`.
   */
  readonly largestCluster: number
  /** The severities of the caller's other findings (overdue jobs, workers, batches), if it has any. */
  readonly findings?: readonly { readonly severity: Severity }[]
}

/** What the verdict reads of an open incident: its cause, whether it is a root incident, its process. */
export interface VerdictIncident extends CauseFields {
  readonly id?: unknown
  readonly rootCauseIncidentId?: unknown
  readonly processDefinitionId?: unknown
}

/** The verdict's incident inputs (`rootIncidentCounts`) and the largest cause they name. */
export interface RootIncidentCounts {
  readonly openRootIncidents: number
  readonly largestCluster: number
  /** The cause of `largestCluster`; absent without a root incident among those read. */
  readonly largestCause?: IncidentCauseKey
}

/** An incident no process holds: a batch's or the history cleanup's failed job. */
function outsideAnyProcess({ processDefinitionId }: VerdictIncident): boolean {
  return typeof processDefinitionId !== "string" || processDefinitionId === ""
}

/**
 * The verdict's incident inputs over ROOT incidents, for every caller of `engineVerdict` alike.
 * `ofProcesses` are the open root incidents of the processes in scope, from an exact read (the
 * definition statistics with `rootIncidents=true`, summed over every version, which count no copy
 * a call activity holds); `incidents` the open incidents read newest first, copies included, whole
 * or capped. Of those read, the root incidents (`isRootIncident`) outside any process join the
 * total, since no statistics row counts them, and the root incidents alone form the largest cause,
 * so a copy never raises it. Over a capped read both are lower bounds, so neither raises a false
 * `critical`.
 */
export function rootIncidentCounts(
  ofProcesses: number,
  incidents: readonly VerdictIncident[],
): RootIncidentCounts {
  const roots = incidents.filter(isRootIncident)
  const largest = largestCause(roots)
  return {
    openRootIncidents: ofProcesses + roots.filter(outsideAnyProcess).length,
    largestCluster: largest?.count ?? 0,
    ...(largest === undefined ? {} : { largestCause: largest.cause }),
  }
}

/** Whether the open root incidents alone make the engine critical. */
export function incidentsAtThreshold(
  input: Pick<VerdictInput, "openRootIncidents" | "largestCluster">,
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): boolean {
  return (
    input.openRootIncidents >= thresholds.criticalIncidents ||
    input.largestCluster >= thresholds.criticalClusterSize
  )
}

/**
 * `critical` from `criticalIncidents` open root incidents, from `criticalClusterSize` root
 * incidents of one cause or with a critical finding; `warning` with any open root incident or any
 * other finding; else `ok`.
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
  return input.openRootIncidents > 0 || findings.length > 0 ? "warning" : "ok"
}

/** When root incidents make the engine critical, in words with the thresholds in force. */
export function criticalIncidentsRule(
  thresholds: VerdictThresholds = DEFAULT_VERDICT_THRESHOLDS,
): string {
  return `>=${thresholds.criticalIncidents} open root incidents or >=${thresholds.criticalClusterSize} of one cause`
}
