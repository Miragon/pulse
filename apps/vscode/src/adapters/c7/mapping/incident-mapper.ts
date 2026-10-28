import {
  ElementId,
  IncidentId,
  InstanceId,
  type DefinitionRef,
  type Incident,
  type IncidentJob,
  type WaitState,
} from "../../../contract/index.js"
import {
  Present,
  type InspectedIncidentView,
  type InspectView,
  type StacktraceView,
} from "../engine-rest/index.js"
import type { Mapper } from "./mapper.js"
import { Timestamps } from "./timestamps.js"

export type DefinitionsByInstance = ReadonlyMap<string, DefinitionRef>

export interface IncidentFacts {
  readonly incident: InspectedIncidentView
  readonly view: InspectView
  readonly definitions: DefinitionsByInstance
  readonly waitStates: readonly WaitState[]
}

export class IncidentMapper implements Mapper<IncidentFacts, Incident | undefined> {
  map({ incident, view, definitions, waitStates }: IncidentFacts): Incident | undefined {
    const instanceId = incident.processInstanceId ?? view.id
    const definition = definitions.get(instanceId)
    if (definition === undefined) {
      return undefined
    }
    return {
      id: IncidentId(incident.id),
      instanceId: InstanceId(instanceId),
      definition,
      elementId: ElementId(incident.activityId),
      type: incident.type,
      message: incident.message ?? "",
      createdAt: Timestamps.fromEngine(incident.since),
      ...Present.fields({
        retriesLeft: this.retriesLeftOf(incident.id, waitStates),
        job: this.jobOf(incident, view),
        details: this.detailsOf(incident.stacktrace),
      }),
    }
  }

  private retriesLeftOf(incidentId: string, waitStates: readonly WaitState[]): number | undefined {
    const waiting = waitStates.find((waitState) => waitState.incidentId === IncidentId(incidentId))
    return waiting !== undefined && "retriesLeft" in waiting ? waiting.retriesLeft : undefined
  }

  private jobOf(incident: InspectedIncidentView, view: InspectView): IncidentJob | undefined {
    if (incident.jobId !== undefined) {
      return { id: incident.jobId }
    }
    if (incident.externalTaskId === undefined) {
      return undefined
    }
    const waiting = view.waitingAt.find(
      (wait) => wait.incidentId === incident.id && wait.kind === "externalTask",
    )
    return { id: incident.externalTaskId, ...Present.fields({ type: waiting?.topic }) }
  }

  private detailsOf(stacktrace: StacktraceView | undefined): Incident["details"] {
    return stacktrace === undefined
      ? undefined
      : { kind: "stacktrace", text: stacktrace.lines.join("\n"), truncated: stacktrace.truncated }
  }
}
