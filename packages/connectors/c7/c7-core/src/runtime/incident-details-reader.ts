/**
 * The details of an incident (`getIncidentDetails` of the engine contract): the whole text of the
 * request `CAUSE_OPERATIONS` names for its type (the job's stack trace, the external task's error
 * details), of the job or external task `incidentRecovery` names, else its message, each with its
 * root cause. None for an incident that is gone, one copied up from a called instance, or an id
 * no engine assigns.
 */

import type { IncidentDetails, IncidentId } from "@miragon/pulse-engine-core"
import { CAUSE_OPERATIONS } from "../inspect.js"
import type { EnginePort } from "../port.js"
import { isEngineId } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { type IncidentRow, incidentRowOf, isRootIncident, recoveryIdOf } from "./incident-rows.js"
import { incidentDetailsOf } from "./incident-texts.js"

/** Reads the details of an incident over the engine's port. */
export class IncidentDetailsReader {
  constructor(private readonly port: EnginePort) {}

  /** The details of the root incident `incidentId`; undefined when it has none. */
  async read(incidentId: IncidentId): Promise<IncidentDetails | undefined> {
    const incident = await this.incident(incidentId)
    if (incident === undefined || !isRootIncident(incident)) {
      return undefined
    }
    const engineText = await this.engineTextOf(incident)
    if (engineText !== undefined) {
      return incidentDetailsOf("stacktrace", engineText.trimEnd(), false)
    }
    const message = incident.incidentMessage
    return message === undefined || message.trim() === ""
      ? undefined
      : incidentDetailsOf("errorMessage", message, false)
  }

  private incident(incidentId: string): Promise<IncidentRow | undefined> {
    if (!isEngineId(incidentId)) {
      return Promise.resolve(undefined)
    }
    const input = { pathArgs: [incidentId], query: {} }
    return findUnlessGone(this.port, "getIncident", input, (answer) => incidentRowOf(answer))
  }

  private engineTextOf(incident: IncidentRow): Promise<string | undefined> {
    const operation = CAUSE_OPERATIONS.get(incident.incidentType)
    const target = recoveryIdOf(incident)
    if (operation === undefined || target === undefined || !isEngineId(target)) {
      return Promise.resolve(undefined)
    }
    return this.port.text(operation, [target])
  }
}
