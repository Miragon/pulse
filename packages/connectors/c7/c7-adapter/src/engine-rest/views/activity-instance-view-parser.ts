import { JsonObject } from "./json-object.js"
import type { ActivityInstanceView, TransitionInstanceView } from "./views.js"

export class ActivityInstanceViewParser {
  static tree(value: unknown): ActivityInstanceView {
    return ActivityInstanceViewParser.activityInstance(JsonObject.of(value, "activity instance"))
  }

  private static activityInstance(record: JsonObject): ActivityInstanceView {
    return {
      id: record.requiredString("id"),
      activityId: record.requiredString("activityId"),
      childActivityInstances: record
        .optionalList("childActivityInstances")
        .map((child) => ActivityInstanceViewParser.activityInstance(child)),
      childTransitionInstances: record
        .optionalList("childTransitionInstances")
        .map((child) => ActivityInstanceViewParser.transitionInstance(child)),
    }
  }

  private static transitionInstance(record: JsonObject): TransitionInstanceView {
    return { id: record.requiredString("id"), activityId: record.requiredString("activityId") }
  }
}
