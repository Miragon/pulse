import { RuntimeError, type RuntimeFailure } from "@miragon/pulse-engine-core"
import {
  EngineRequestError,
  EngineTexts,
  Present,
  UnexpectedAnswerError,
  type EngineRequestFailure,
} from "../engine-rest/index.js"
import { Redaction } from "../writing/redaction.js"

type Refusal = "byEngine" | "beforeWork"

const WITHOUT_STATUS: Readonly<Record<EngineRequestFailure, RuntimeFailure>> = {
  refused: "misconfigured",
  readOnly: "unsupported",
  unusable: "misconfigured",
  unanswered: "unreachable",
  answered: "misconfigured",
}

export class ErrorTranslation {
  static async translated<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw RuntimeError.is(error)
        ? error
        : ErrorTranslation.runtimeErrorOf(error, Redaction.NOTHING)
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

  private static runtimeErrorOf(error: unknown, redaction: Redaction): RuntimeError {
    if (error instanceof EngineRequestError) {
      return new RuntimeError(
        ErrorTranslation.failureOf(error),
        ErrorTranslation.shown(error.message, redaction),
        { cause: error, ...Present.fields({ hint: error.hint }) },
      )
    }
    const message = error instanceof UnexpectedAnswerError ? error.message : String(error)
    return new RuntimeError("unexpectedResponse", ErrorTranslation.shown(message, redaction), {
      cause: error,
    })
  }

  private static failureOf(error: EngineRequestError): RuntimeFailure {
    const status = error.status
    if (status === undefined) {
      return WITHOUT_STATUS[error.failure]
    }
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
      return new RuntimeError("rejected", ErrorTranslation.shown(message, redaction), {
        cause: error,
        ...Present.fields({ hint: EngineRequestError.hintOf(error) }),
      })
    }
    if (!RuntimeError.is(error)) {
      return ErrorTranslation.runtimeErrorOf(error, redaction)
    }
    return new RuntimeError(error.failure, redaction.applyTo(error.message), {
      cause: error,
      ...Present.fields({ hint: error.hint }),
    })
  }

  private static shown(message: string, redaction: Redaction): string {
    return EngineTexts.cut(redaction.applyTo(message))
  }
}
