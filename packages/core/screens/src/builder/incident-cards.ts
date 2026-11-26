import type {
  Incident,
  IncidentDetails,
  IncidentId,
  InstanceDetail,
} from "@miragon/pulse-engine-core"
import type { CauseSourceCode } from "../format/instance-screen-data.js"
import type { IncidentCardModel } from "./instance-screen-model.js"
import type { InstanceTree } from "./instance-tree.js"

export class IncidentCards {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly tree: InstanceTree,
    private readonly fullDetails: ReadonlyMap<IncidentId, IncidentDetails>,
  ) {}

  cards(): IncidentCardModel[] {
    return this.detail.incidents.map((incident) => this.cardOf(incident))
  }

  private cardOf(incident: Incident): IncidentCardModel {
    const complete = this.completeDetails(incident)
    return {
      incident,
      liesIn: this.tree.liesIn(incident.instanceId),
      text: incident.details?.kind,
      rootCauseLine: complete?.rootCause,
      causeSource:
        complete?.rootCause === undefined ? undefined : this.sourceOf(complete, incident),
    }
  }

  private completeDetails(incident: Incident): IncidentDetails | undefined {
    const details = this.fullDetails.get(incident.id) ?? incident.details
    return details?.truncated === false ? details : undefined
  }

  private sourceOf(details: IncidentDetails, incident: Incident): CauseSourceCode {
    if (details.kind === "stacktrace") {
      return "stacktrace"
    }
    return this.stopsAWorkerTask(incident) ? "workerError" : "errorMessage"
  }

  private stopsAWorkerTask(incident: Incident): boolean {
    return this.detail.waitStates.some(
      (wait) => wait.incidentId === incident.id && wait.kind === "workerTask",
    )
  }
}
