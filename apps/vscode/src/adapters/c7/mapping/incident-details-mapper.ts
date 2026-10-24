import type { IncidentDetails } from "../../../contract/index.js"
import type { Mapper } from "./mapper.js"

export interface IncidentTexts {
  readonly engineText: string | undefined
  readonly message: string | undefined
}

export class IncidentDetailsMapper implements Mapper<IncidentTexts, IncidentDetails | undefined> {
  map(texts: IncidentTexts): IncidentDetails | undefined {
    const { engineText, message } = texts
    if (engineText !== undefined && engineText.trim() !== "") {
      return { kind: "stacktrace", text: engineText.trimEnd(), truncated: false }
    }
    if (message !== undefined && message.trim() !== "") {
      return { kind: "errorMessage", text: message, truncated: false }
    }
    return undefined
  }
}
