import { RuntimeError, type RuntimeFailure } from "../../../contract/index.js"
import { EngineRequestError, UnexpectedAnswerError } from "../engine-rest/index.js"
import { Redaction } from "../writing/redaction.js"

type Refusal = "byEngine" | "beforeWork"

export class ErrorTranslation {
  static async translated<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw ErrorTranslation.runtimeErrorOf(error)
    }
  }

  static async unlessMissing<Result>(work: () => Promise<Result>): Promise<Result | undefined> {
    try {
      return await work()
    } catch (error: unknown) {
      if (EngineRequestError.isMissingResource(error)) {
        return undefined
      }
      throw error
    }
  }

  static async commanded<Result>(
    work: () => Promise<Result>,
    redaction: Redaction = Redaction.NOTHING,
  ): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw ErrorTranslation.commandErrorOf(error, redaction, "byEngine")
    }
  }

  static async submitted<Result>(
    work: () => Promise<Result>,
    redaction: Redaction,
  ): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw ErrorTranslation.commandErrorOf(error, redaction, "beforeWork")
    }
  }

  static isRefusal(error: unknown): boolean {
    return ErrorTranslation.isRefused(error, "byEngine")
  }

  private static runtimeErrorOf(error: unknown): RuntimeError {
    if (RuntimeError.is(error)) {
      return error
    }
    if (error instanceof EngineRequestError) {
      return new RuntimeError(ErrorTranslation.failureOf(error), error.message, { cause: error })
    }
    const message = error instanceof UnexpectedAnswerError ? error.message : String(error)
    return new RuntimeError("unexpectedResponse", message, { cause: error })
  }

  private static failureOf(error: EngineRequestError): RuntimeFailure {
    if (error.failure === "unanswered") {
      return "unreachable"
    }
    const status = error.status ?? 0
    if (status === 401 || status === 403) {
      return status === 403 ? "forbidden" : "unauthorized"
    }
    return status < 400 || status === 404 ? "misconfigured" : "engineFailure"
  }

  private static isArgument(error: unknown): boolean {
    return error instanceof EngineRequestError && error.failure === "refused"
  }

  private static isRefused(error: unknown, refusal: Refusal): boolean {
    const status = EngineRequestError.statusOf(error)
    if (status === undefined || status === 401 || status === 403 || status < 400) {
      return false
    }
    return refusal === "byEngine" || status < 500
  }

  private static commandErrorOf(
    error: unknown,
    redaction: Redaction,
    refusal: Refusal,
  ): RuntimeError {
    if (ErrorTranslation.isArgument(error) || ErrorTranslation.isRefused(error, refusal)) {
      const message = error instanceof Error ? error.message : String(error)
      return new RuntimeError("rejected", redaction.applyTo(message), { cause: error })
    }
    const translated = ErrorTranslation.runtimeErrorOf(error)
    return new RuntimeError(translated.failure, redaction.applyTo(translated.message), {
      cause: error,
      ...(translated.hint === undefined ? {} : { hint: translated.hint }),
    })
  }
}
