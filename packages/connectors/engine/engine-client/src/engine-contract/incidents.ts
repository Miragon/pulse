/**
 * Incident recovery. `DELETE /incident/{id}` (resolve) refuses the two
 * BUILT-IN incident types with a 400 "Cannot resolve an incident of type …"
 * — in CIB Seven, Camunda 7 and Operaton alike. Those incidents go away when
 * their cause is retried: a `failedJob` through the job's retries, a
 * `failedExternalTask` through the external task's retries. The incident's
 * `configuration` names that job / external task. Only custom incident types
 * (raised via the API) are resolved.
 */

/** The incident types the engine raises itself — never resolvable, only retried. */
export const BUILT_IN_INCIDENT_TYPES = ["failedJob", "failedExternalTask"] as const

/**
 * What clears an incident:
 * - `resolve` — a custom incident: `engine_resolve_incident`;
 * - `retry-job` — `engine_set_job_retries` on `jobId`;
 * - `retry-external-task` — `engine_set_external_task_retries` on `externalTaskId`;
 * - `none` — a built-in incident without a `configuration`: one propagated
 *   from a called instance, cleared by retrying its ROOT-CAUSE incident.
 */
export type IncidentRecovery =
  | { action: "resolve" }
  | { action: "retry-job"; jobId: string }
  | { action: "retry-external-task"; externalTaskId: string }
  | { action: "none" }

export function incidentRecovery(incident: {
  incidentType?: string | null
  configuration?: string | null
}): IncidentRecovery {
  const target = incident.configuration || null
  switch (incident.incidentType) {
    case "failedJob":
      return target ? { action: "retry-job", jobId: target } : { action: "none" }
    case "failedExternalTask":
      return target ? { action: "retry-external-task", externalTaskId: target } : { action: "none" }
    default:
      return { action: "resolve" }
  }
}
