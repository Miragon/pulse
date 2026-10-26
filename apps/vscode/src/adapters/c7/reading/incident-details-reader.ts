import type { IncidentDetails, IncidentId } from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import type { IncidentTexts } from "../mapping/incident-details-mapper.js"
import type { Mapper } from "../mapping/mapper.js"
import { RootIncident } from "../mapping/root-incident.js"
import type { IncidentView, EngineClient } from "../engine-cli/index.js"

export class IncidentDetailsReader {
  constructor(
    private readonly client: EngineClient,
    private readonly details: Mapper<IncidentTexts, IncidentDetails | undefined>,
  ) {}

  async read(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    const incident = await ErrorTranslation.unlessMissing(() => this.client.incident(incidentId))
    if (incident === undefined || !RootIncident.is(incident)) {
      return undefined
    }
    return this.details.map({
      engineText: await this.engineTextOf(incident),
      message: incident.incidentMessage,
    })
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
