import type { IncidentView } from "../engine-rest/index.js"

export class RootIncident {
  static is(incident: IncidentView): boolean {
    return (
      incident.rootCauseIncidentId === undefined || incident.rootCauseIncidentId === incident.id
    )
  }
}
