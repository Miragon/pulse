import { type IncidentDetails, RootCauses } from "../../../contract/index.js"
import { Present } from "../engine-rest/index.js"

export class IncidentTexts {
  static details(kind: IncidentDetails["kind"], text: string, truncated: boolean): IncidentDetails {
    return {
      kind,
      text,
      truncated,
      ...Present.fields({
        rootCause: RootCauses.of(text),
        rootCauseLine: RootCauses.lineOf(text),
      }),
    }
  }
}
