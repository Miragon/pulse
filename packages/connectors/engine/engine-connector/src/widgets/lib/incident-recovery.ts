import type { IncidentRecovery } from "../../view-models.js"

/**
 * A result stored before `recovery` existed still reaches a reopened view; then the type
 * decides like the contract (built-ins can't be resolved, so retry on `jobId` or nothing).
 */
export function recoveryOf(
  incident: { incidentType: string; recovery?: IncidentRecovery },
  jobId?: string | null,
): IncidentRecovery {
  if (incident.recovery) return incident.recovery
  switch (incident.incidentType) {
    case "failedJob":
      return jobId ? { action: "retry-job", jobId } : { action: "none" }
    case "failedExternalTask":
      return { action: "none" }
    default:
      return { action: "resolve" }
  }
}
