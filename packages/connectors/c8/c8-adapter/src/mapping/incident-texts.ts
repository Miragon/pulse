import { type IncidentDetails, RootCauses } from "@miragon/pulse-engine-core"
import { Present } from "../rest/index.js"

export class IncidentTexts {
  static details(text: string): IncidentDetails {
    return {
      kind: "errorMessage",
      text,
      truncated: false,
      ...Present.fields({
        rootCause: RootCauses.of(text),
        rootCauseLine: RootCauses.lineOf(text),
      }),
    }
  }
}
