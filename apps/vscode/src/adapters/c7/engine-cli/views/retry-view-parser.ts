import { JsonObject } from "./json-object.js"
import type { RetryView } from "./views.js"

export class RetryViewParser {
  static retry(value: unknown): RetryView {
    const record = JsonObject.of(value, "retry result")
    const incidents = record.value("incidents")
    const outcomes = incidents === undefined ? [] : JsonObject.listOf(incidents, "incidents")
    return {
      retried: record.optionalNumber("retried") ?? 0,
      results: outcomes.map((outcome) => outcome.requiredString("result")),
    }
  }
}
