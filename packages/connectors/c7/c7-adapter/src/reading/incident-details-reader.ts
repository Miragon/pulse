import { CAUSE_OPERATIONS } from "@miragon/pulse-c7-core"
import type { IncidentDetails, IncidentId } from "@miragon/pulse-engine-core"
import { ErrorTranslation } from "../errors/error-translation.js"
import { IncidentTexts } from "../mapping/incident-texts.js"
import { RootIncident } from "../mapping/root-incident.js"
import { RecoveryTargets, type IncidentView, type EngineClient } from "../engine-rest/index.js"

export class IncidentDetailsReader {
  constructor(private readonly client: EngineClient) {}

  async read(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    const incident = await ErrorTranslation.unlessMissing(() => this.client.incident(incidentId))
    if (incident === undefined || !RootIncident.is(incident)) {
      return undefined
    }
    const engineText = await this.engineTextOf(incident)
    if (engineText !== undefined && engineText.trim() !== "") {
      return IncidentTexts.details("stacktrace", engineText.trimEnd(), false)
    }
    const message = incident.incidentMessage
    if (message !== undefined && message.trim() !== "") {
      return IncidentTexts.details("errorMessage", message, false)
    }
    return undefined
  }

  private engineTextOf(incident: IncidentView): Promise<string | undefined> {
    const operation = CAUSE_OPERATIONS.get(incident.incidentType)
    const target = RecoveryTargets.of(incident)
    if (operation === undefined || target === undefined) {
      return Promise.resolve(undefined)
    }
    return ErrorTranslation.unlessMissing(() => this.client.causeText(operation, target.id))
  }
}
