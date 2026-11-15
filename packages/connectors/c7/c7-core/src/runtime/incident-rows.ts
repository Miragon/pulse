/**
 * The runtime's incidents as the engine answers them (`/incident`), read through `JsonView`, so an
 * unusable one fails as `RuntimeError("unexpectedResponse")`, which of them is a root incident and
 * which job or external task one names.
 */

import { incidentRecovery } from "../incident-recovery.js"
import { compact } from "../util.js"
import { JsonView } from "./json-view.js"

/** An open incident of the runtime. */
export interface IncidentRow {
  readonly id: string
  readonly incidentType: string
  readonly activityId: string
  readonly processInstanceId?: string
  readonly processDefinitionId?: string
  readonly incidentMessage?: string
  readonly incidentTimestamp: string
  readonly rootCauseIncidentId?: string
  readonly configuration?: string
}

function incidentOf(record: JsonView): IncidentRow {
  return {
    id: record.requiredString("id"),
    incidentType: record.requiredString("incidentType"),
    activityId: record.requiredString("activityId"),
    incidentTimestamp: record.requiredString("incidentTimestamp"),
    ...compact({
      processInstanceId: record.optionalString("processInstanceId"),
      processDefinitionId: record.optionalString("processDefinitionId"),
      incidentMessage: record.optionalString("incidentMessage"),
      rootCauseIncidentId: record.optionalString("rootCauseIncidentId"),
      configuration: record.optionalString("configuration"),
    }),
  }
}

/** The incident the engine answered for one id. */
export function incidentRowOf(answer: unknown): IncidentRow {
  return incidentOf(JsonView.of(answer, "incident"))
}

/** The incidents of a list answer. */
export function incidentRowsOf(answer: unknown): IncidentRow[] {
  return JsonView.listOf(answer, "incidents").map((record) => incidentOf(record))
}

/**
 * Whether `incident` was raised where it is, not copied up from a called instance: it names no
 * root cause, or itself.
 */
export function isRootIncident(incident: Pick<IncidentRow, "id" | "rootCauseIncidentId">): boolean {
  return incident.rootCauseIncidentId === undefined || incident.rootCauseIncidentId === incident.id
}

/**
 * The job or external task whose retry clears `incident`, as `incidentRecovery` names it: none for a
 * custom type and none without a `configuration`.
 */
export function recoveryIdOf(
  incident: Pick<IncidentRow, "incidentType" | "configuration">,
): string | undefined {
  const recovery = incidentRecovery(incident)
  switch (recovery.action) {
    case "retry-job":
      return recovery.jobId
    case "retry-external-task":
      return recovery.externalTaskId
  }
  return undefined
}
