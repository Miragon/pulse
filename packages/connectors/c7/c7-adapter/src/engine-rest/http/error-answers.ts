import { failureOf, isUnknownEndpoint } from "@miragon/pulse-c7-core"
import { type HttpAnswer, problemOf, statusTextOf } from "@miragon/pulse-http"
import { Present } from "../present.js"
import { EngineRequestError } from "./engine-request-error.js"

const ROOT_HINT =
  "Check that the engine URL points at the REST API root itself, such as http://localhost:8080/engine-rest."

export class ErrorAnswers {
  static errorOf(answer: HttpAnswer, cause?: unknown): EngineRequestError {
    const problem = problemOf(answer)
    const status = ErrorAnswers.statusLine(answer.status, answer.statusText)
    const message = problem.message === undefined ? status : `${status}: ${problem.message}`
    const hint = isUnknownEndpoint(failureOf(answer.status, problem)) ? ROOT_HINT : undefined
    return EngineRequestError.answered(
      answer.status,
      message,
      Present.fields({ engineType: problem.type, hint, cause }),
    )
  }

  static statusLine(status: number, statusText = ""): string {
    return [`HTTP ${String(status)}`, statusTextOf(status, statusText)].filter(Boolean).join(" ")
  }
}
