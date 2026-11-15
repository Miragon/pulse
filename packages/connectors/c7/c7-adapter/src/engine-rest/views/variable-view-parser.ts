import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { Present } from "../present.js"
import { LosslessJson } from "./lossless-json.js"
import type { VariableView } from "./views.js"

const MULTI_INSTANCE_BODY = "#multiInstanceBody"

export class VariableViewParser {
  static instances(value: unknown): VariableView[] {
    return JsonView.listOf(value, "variable instances").map((record) => ({
      name: record.requiredString("name"),
      valueJson: LosslessJson.stringify(record.value("value") ?? null),
      ...Present.fields({
        type: record.optionalString("type"),
        scopeElementId: VariableViewParser.scopeElementOf(
          record.requiredString("activityInstanceId"),
          record.requiredString("processInstanceId"),
        ),
      }),
    }))
  }

  private static scopeElementOf(
    activityInstanceId: string,
    processInstanceId: string,
  ): string | undefined {
    if (activityInstanceId === processInstanceId) {
      return undefined
    }
    const [elementId = activityInstanceId] = activityInstanceId.split(":")
    return elementId.replace(MULTI_INSTANCE_BODY, "")
  }
}
