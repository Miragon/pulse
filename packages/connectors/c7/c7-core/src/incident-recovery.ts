/**
 * Incident recovery. `DELETE /incident/{id}` (resolve) refuses the two
 * BUILT-IN incident types with a 400 "Cannot resolve an incident of type …",
 * in CIB seven, Camunda 7 and Operaton alike. Those incidents go away when
 * their cause is retried: a `failedJob` through the job's retries, a
 * `failedExternalTask` through the external task's retries. The incident's
 * `configuration` names that job / external task. Only custom incident types
 * (raised via the API) are resolved.
 */

/** The incident types the engine raises itself: never resolvable, only retried. */
export const BUILT_IN_INCIDENT_TYPES = ["failedJob", "failedExternalTask"] as const

/**
 * What clears an incident:
 * - `resolve` (a custom incident): resolve it (`DELETE /incident/{id}`);
 * - `retry-job`: set the retries of the job `jobId`;
 * - `retry-external-task`: set the retries of the external task `externalTaskId`;
 * - `none` (a built-in incident without a `configuration`): one propagated
 *   from a called instance, cleared by retrying its ROOT-CAUSE incident.
 */
export type IncidentRecovery =
  | { action: "resolve" }
  | { action: "retry-job"; jobId: string }
  | { action: "retry-external-task"; externalTaskId: string }
  | { action: "none" }

export function incidentRecovery(incident: {
  incidentType?: string | null | undefined
  configuration?: string | null | undefined
}): IncidentRecovery {
  // An empty configuration names nothing, like an absent one.
  const target = incident.configuration === "" ? null : (incident.configuration ?? null)
  switch (incident.incidentType) {
    case "failedJob":
      return target ? { action: "retry-job", jobId: target } : { action: "none" }
    case "failedExternalTask":
      return target ? { action: "retry-external-task", externalTaskId: target } : { action: "none" }
    default:
      return { action: "resolve" }
  }
}
