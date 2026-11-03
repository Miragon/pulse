import type { WaitState } from "@miragon/pulse-engine-core"
import { Present } from "../present.js"
import type { WaitingAtView } from "../views/views.js"

type WaitDetails = Omit<WaitingAtView, "kind" | "activityId">

export class WaitingAtViews {
  static of(wait: WaitState): WaitingAtView {
    return {
      kind: wait.kind,
      activityId: wait.activityId,
      ...Present.fields({
        activityName: wait.activityName,
        activityType: wait.activityType,
        attachedTo: wait.attachedTo,
        processInstanceId: wait.processInstanceId,
        since: wait.since,
        incidentId: wait.incidentId,
      }),
      ...WaitingAtViews.detailsOf(wait),
    }
  }

  private static detailsOf(wait: WaitState): WaitDetails {
    switch (wait.kind) {
      case "userTask":
        return Present.fields({ assignee: wait.assignee, due: wait.due })
      case "externalTask":
        return { topic: wait.topic, ...Present.fields({ retries: wait.retries }) }
      case "timer":
        return Present.fields({ dueDate: WaitingAtViews.presentText(wait.dueDate) })
      case "asyncContinuation":
        return { retries: wait.retries }
      case "message":
      case "signal":
      case "conditional":
        return Present.fields({ eventName: wait.eventName })
      default:
        return {}
    }
  }

  private static presentText(text: string): string | undefined {
    return text === "" ? undefined : text
  }
}
