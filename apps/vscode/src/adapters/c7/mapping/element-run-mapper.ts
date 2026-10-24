import { ElementId, type ElementRun } from "../../../contract/index.js"
import { Present, type TimelineEntryView } from "../engine-cli/index.js"
import type { Mapper } from "./mapper.js"
import { Timestamps } from "./timestamps.js"

export class ElementRunMapper implements Mapper<TimelineEntryView, ElementRun> {
  map(entry: TimelineEntryView): ElementRun {
    return {
      elementId: ElementId(entry.activityId),
      startedAt: Timestamps.fromEngine(entry.startTime),
      canceled: entry.canceled,
      ...Present.fields({
        elementName: entry.activityName,
        endedAt: Timestamps.optional(entry.endTime),
      }),
    }
  }
}
