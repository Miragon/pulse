import { Present } from "../present.js"
import type { JsonObject } from "../views/json-object.js"
import type { InspectView } from "../views/views.js"

export class InstancePath {
  static of(timeline: readonly JsonObject[]): Pick<InspectView, "timeline" | "calls"> {
    return {
      timeline: timeline.map((entry) => ({
        activityId: entry.requiredString("activityId"),
        startTime: entry.requiredString("startTime"),
        canceled: entry.value("canceled") === true,
        ...Present.fields({
          activityName: entry.optionalString("activityName"),
          endTime: entry.optionalString("endTime"),
        }),
      })),
      calls: timeline.flatMap((entry) => {
        const calledProcessInstanceId = entry.optionalString("calledProcessInstanceId")
        return calledProcessInstanceId === undefined
          ? []
          : [{ activityId: entry.requiredString("activityId"), calledProcessInstanceId }]
      }),
    }
  }
}
