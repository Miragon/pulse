import type { CamundaFailure } from "../port/camunda-failure.js"

const MISSING_RESOURCE_TITLE = "NOT_FOUND"
const PATH_VALUE_CODES: ReadonlySet<string | undefined> = new Set(["dot-segment", "empty-segment"])

export class MissingResources {
  static named(failure: CamundaFailure | undefined): boolean {
    switch (failure?.kind) {
      case "answered":
        return failure.status === 404 && failure.title === MISSING_RESOURCE_TITLE
      case "transport":
        return failure.reason === "invalid-request" && PATH_VALUE_CODES.has(failure.code)
      default:
        return false
    }
  }
}
