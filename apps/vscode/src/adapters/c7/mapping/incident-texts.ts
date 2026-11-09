import { rootCause, rootCauseLine } from "@miragon/pulse-c7-core"
import type { IncidentDetails } from "../../../contract/index.js"
import { Present } from "../engine-rest/index.js"

export class IncidentTexts {
  static details(kind: IncidentDetails["kind"], text: string, truncated: boolean): IncidentDetails {
    return {
      kind,
      text,
      truncated,
      ...Present.fields({ rootCause: rootCause(text), rootCauseLine: rootCauseLine(text) }),
    }
  }
}
