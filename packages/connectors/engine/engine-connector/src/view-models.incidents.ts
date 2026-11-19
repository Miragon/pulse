// The view models of an incident's failure: its job, its external task and, for a copy at a call
// activity, its root cause, the incident in a called instance the copy stands for.

/**
 * Where a copy's failure happened: Camunda 7 copies an incident of a called instance to each call
 * activity above it, without a message or a failure target of its own; the root incident holds
 * both. Enrichment: null where an incident is its own root or the read failed.
 */
export interface IncidentRootCause {
  incidentId: string
  /** The root incident's message, the failure in the engine's words; null without one. */
  message: string | null
  activityId: string
  /** The element's name in the called process's diagram; null without one or unread. */
  activityName: string | null
  /** The called instance, where the failure happened. */
  processInstanceId: string
}

export interface IncidentDetailRootCause extends IncidentRootCause {
  /** The called process by its name, else its key; null unread. */
  processName: string | null
}

export interface IncidentDetailJob {
  id: string
  retries: number
  exceptionMessage: string | null
  /** Null when the engine rejected it or the incident is not job-backed. */
  stacktrace: string | null
  dueDate: string | null
}

/** A failed external task an incident names: its worker's error details, as the engine gives them. */
export interface IncidentDetailExternalTask {
  id: string
  /** Null when its worker sent none, the task is gone or the engine rejected the read. */
  errorDetails: string | null
}
