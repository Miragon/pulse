import type { C8Words } from "@miragon/pulse-c8-core"
import { CamundaRequestError } from "../rest/camunda-request-error.js"
import { TokenTexts } from "./token-texts.js"

export class ErrorTranslation {
  static wordsOf(error: unknown): C8Words {
    if (!(error instanceof CamundaRequestError)) {
      return { message: error instanceof Error ? error.message : String(error) }
    }
    if (error.token !== undefined) {
      return TokenTexts.wordsOf(error.token)
    }
    return { message: error.message, hint: error.hint }
  }
}
