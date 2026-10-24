import { ElementId, IncidentId, InstanceId, type WaitState } from "../../../contract/index.js"
import { Present, type WaitingAtView } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"
import { Timestamps } from "./timestamps.js"

export interface WaitFacts {
  readonly wait: WaitingAtView
  readonly inspectedInstanceId: string
}

export class WaitStateMapper implements Mapper<WaitFacts, WaitState> {
  map({ wait, inspectedInstanceId }: WaitFacts): WaitState {
    const base = this.baseOf(wait, inspectedInstanceId)
    const retries = Present.fields({ retriesLeft: wait.retries })
    switch (wait.kind) {
      case "userTask":
        return {
          ...base,
          kind: "userTask",
          ...Present.fields({ assignee: wait.assignee, dueAt: Timestamps.optional(wait.due) }),
        }
      case "externalTask":
        return { ...base, kind: "workerTask", taskType: wait.topic ?? "", ...retries }
      case "asyncContinuation":
        return { ...base, kind: "asyncContinuation", ...retries }
      case "timer":
        return {
          ...base,
          kind: "timer",
          ...Present.fields({ dueAt: Timestamps.optional(wait.dueDate) }),
        }
      case "message":
        return { ...base, kind: "message", ...Present.fields({ messageName: wait.eventName }) }
      case "signal":
        return { ...base, kind: "signal", ...Present.fields({ signalName: wait.eventName }) }
      default:
        return { ...base, kind: "other", description: wait.activityType ?? wait.kind }
    }
  }

  private baseOf(wait: WaitingAtView, inspectedInstanceId: string) {
    return {
      instanceId: InstanceId(wait.processInstanceId ?? inspectedInstanceId),
      elementId: ElementId(wait.activityId),
      ...Present.fields({
        elementName: wait.activityName,
        attachedToElementId: wait.attachedTo === undefined ? undefined : ElementId(wait.attachedTo),
        since: Timestamps.optional(wait.since),
        incidentId: wait.incidentId === undefined ? undefined : IncidentId(wait.incidentId),
      }),
    }
  }
}
