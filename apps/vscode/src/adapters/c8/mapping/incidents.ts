import {
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type DefinitionRef,
  type Incident,
} from "../../../contract/index.js"
import type { IncidentView, JobView } from "../rest/index.js"
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
      ...(job?.retries === undefined ? {} : { retriesLeft: job.retries }),
      ...Incidents.jobOf(view, job),
    }
  }

  private static jobOf(view: IncidentView, job: JobView | undefined): Pick<Incident, "job"> {
    return view.jobKey === undefined
      ? {}
      : { job: { id: view.jobKey, ...(job === undefined ? {} : { type: job.type }) } }
  }
}
