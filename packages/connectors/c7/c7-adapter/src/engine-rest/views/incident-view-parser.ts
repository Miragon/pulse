import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { Present } from "../present.js"
import type { IncidentView } from "./views.js"

export class IncidentViewParser {
  static incident(value: unknown): IncidentView {
    return IncidentViewParser.incidentOf(JsonView.of(value, "incident"))
  }

  static incidents(value: unknown): IncidentView[] {
    return JsonView.listOf(value, "incidents").map((record) =>
      IncidentViewParser.incidentOf(record),
    )
  }

  private static incidentOf(record: JsonView): IncidentView {
    return {
      id: record.requiredString("id"),
      incidentType: record.requiredString("incidentType"),
      activityId: record.requiredString("activityId"),
      incidentTimestamp: record.requiredString("incidentTimestamp"),
      ...Present.fields({
        processInstanceId: record.optionalString("processInstanceId"),
        processDefinitionId: record.optionalString("processDefinitionId"),
        incidentMessage: record.optionalString("incidentMessage"),
        rootCauseIncidentId: record.optionalString("rootCauseIncidentId"),
        configuration: record.optionalString("configuration"),
      }),
    }
  }
}
