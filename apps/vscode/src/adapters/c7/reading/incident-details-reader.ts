import type { IncidentDetails, IncidentId } from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import { RootIncident } from "../mapping/root-incident.js"
import type { IncidentView, EngineClient } from "../engine-rest/index.js"

export class IncidentDetailsReader {
  constructor(private readonly client: EngineClient) {}

  async read(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    const incident = await ErrorTranslation.unlessMissing(() => this.client.incident(incidentId))
    if (incident === undefined || !RootIncident.is(incident)) {
      return undefined
    }
    const engineText = await this.engineTextOf(incident)
    if (engineText !== undefined && engineText.trim() !== "") {
      return { kind: "stacktrace", text: engineText.trimEnd(), truncated: false }
    }
    const message = incident.incidentMessage
    if (message !== undefined && message.trim() !== "") {
      return { kind: "errorMessage", text: message, truncated: false }
    }
    return undefined
  }

  private engineTextOf(incident: IncidentView): Promise<string | undefined> {
    const resourceId = incident.configuration
    if (resourceId === undefined) {
      return Promise.resolve(undefined)
    }
    if (incident.incidentType === "failedJob") {
      return ErrorTranslation.unlessMissing(() => this.client.jobStacktrace(resourceId))
    }
    if (incident.incidentType === "failedExternalTask") {
      return ErrorTranslation.unlessMissing(() => this.client.externalTaskErrorDetails(resourceId))
    }
    return Promise.resolve(undefined)
  }
}
