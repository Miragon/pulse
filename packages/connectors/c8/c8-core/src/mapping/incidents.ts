import {
  type DefinitionRef,
  ElementId,
  type Incident,
  IncidentId,
  InstanceId,
  IsoTimestamp,
} from "@miragon/pulse-engine-core"
import { type IncidentView, type JobView, Present } from "../rest/index.js"
import { IncidentTexts } from "./incident-texts.js"

export class Incidents {
  static of(view: IncidentView, definition: DefinitionRef, job?: JobView): Incident {
    return {
      id: IncidentId(view.key),
      instanceId: InstanceId(view.instanceKey),
      definition,
      elementId: ElementId(view.elementId),
      type: view.type,
      message: view.message,
      createdAt: IsoTimestamp(view.createdAt),
      details: IncidentTexts.details(view.message),
      ...Present.fields({ retriesLeft: job?.retries }),
      ...Incidents.jobOf(view, job),
    }
  }

  private static jobOf(view: IncidentView, job: JobView | undefined): Pick<Incident, "job"> {
    return view.jobKey === undefined
      ? {}
      : { job: { id: view.jobKey, ...Present.fields({ type: job?.type }) } }
  }
}
