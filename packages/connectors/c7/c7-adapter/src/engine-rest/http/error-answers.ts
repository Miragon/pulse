import { failureOf, isUnknownEndpoint } from "@miragon/pulse-c7-core"
import { type HttpAnswer, type Problem, problemOf, statusTextOf } from "@miragon/pulse-http"
import { Present } from "../present.js"
import { EngineRequestError } from "./engine-request-error.js"

export interface AnswerContext {
  readonly cause?: unknown
  readonly loginSent?: boolean
}

const ROOT_HINT =
  "Check that the engine URL points at the REST API root itself, such as http://localhost:8080/engine-rest."
const NO_LOGIN_HINT =
  "The engine asks for a login, and Pulse sent none. Add one with Set credentials."

export class ErrorAnswers {
  static errorOf(answer: HttpAnswer, context: AnswerContext = {}): EngineRequestError {
    const problem = problemOf(answer)
    const status = ErrorAnswers.statusLine(answer.status, answer.statusText)
    const message = problem.message === undefined ? status : `${status}: ${problem.message}`
    const hint =
      answer.status === 401 && context.loginSent === false
        ? NO_LOGIN_HINT
        : ErrorAnswers.rootHintOf(answer.status, problem)
    return EngineRequestError.answered(
      answer.status,
      message,
      Present.fields({ engineType: problem.type, hint, cause: context.cause }),
    )
  }

  static statusLine(status: number, statusText = ""): string {
    return [`HTTP ${String(status)}`, statusTextOf(status, statusText)].filter(Boolean).join(" ")
  }

  private static rootHintOf(status: number, problem: Problem): string | undefined {
    return isUnknownEndpoint(failureOf(status, problem)) ? ROOT_HINT : undefined
  }
}
