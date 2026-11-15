import { JsonView } from "@miragon/pulse-c7-core/runtime"
import type { BatchRef } from "./views.js"

export class BatchViewParser {
  static reference(value: unknown): BatchRef {
    return { id: JsonView.of(value, "batch").requiredString("id") }
  }
}
