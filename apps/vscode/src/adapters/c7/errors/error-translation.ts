import { RuntimeError, type RuntimeFailure } from "../../../contract/index.js"
import { EngineCliFailure, EngineCliOutputError } from "../engine-cli/index.js"
import { Redaction } from "../writing/redaction.js"

const UNREACHABLE_CODES: ReadonlySet<string> = new Set(["NETWORK", "TIMEOUT"])
const MISCONFIGURED_CODES: ReadonlySet<string> = new Set(["CLI_FAILED", "NOT_FOUND"])
const REFUSED_BY_ENGINE: ReadonlySet<number> = new Set([5, 6, 7])
const REFUSED_BEFORE_WORK: ReadonlySet<number> = new Set([5, 6])

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
      if (EngineCliFailure.isMissingResource(error)) {
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
      throw ErrorTranslation.commandErrorOf(error, redaction, REFUSED_BY_ENGINE)
    }
  }

  static async submitted<Result>(
    work: () => Promise<Result>,
    redaction: Redaction,
  ): Promise<Result> {
    try {
      return await work()
    } catch (error: unknown) {
      throw ErrorTranslation.commandErrorOf(error, redaction, REFUSED_BEFORE_WORK)
    }
  }

  static isRefusal(error: unknown): boolean {
    return (
      error instanceof EngineCliFailure &&
      error.exitCode !== null &&
      REFUSED_BY_ENGINE.has(error.exitCode)
    )
  }

  private static runtimeErrorOf(error: unknown): RuntimeError {
    if (RuntimeError.is(error)) {
      return error
    }
    if (error instanceof EngineCliFailure) {
      return new RuntimeError(ErrorTranslation.failureKindOf(error), error.message, {
        cause: error,
      })
    }
    const message = error instanceof EngineCliOutputError ? error.message : String(error)
    return new RuntimeError("unexpectedResponse", message, { cause: error })
  }

  private static failureKindOf(failure: EngineCliFailure): RuntimeFailure {
    if (UNREACHABLE_CODES.has(failure.code) || failure.exitCode === 8) {
      return "unreachable"
    }
    if (failure.exitCode === 4) {
      return failure.status === 403 ? "forbidden" : "unauthorized"
    }
    if (MISCONFIGURED_CODES.has(failure.code) || failure.exitCode === 3) {
      return "misconfigured"
    }
    if (failure.exitCode === 6 || failure.exitCode === 7) {
      return "engineFailure"
    }
    return "unexpectedResponse"
  }

  private static commandErrorOf(
    error: unknown,
    redaction: Redaction,
    refused: ReadonlySet<number>,
  ): RuntimeError {
    if (
      error instanceof EngineCliFailure &&
      error.exitCode !== null &&
      refused.has(error.exitCode)
    ) {
      return new RuntimeError("rejected", redaction.applyTo(error.message), { cause: error })
    }
    if (error instanceof EngineCliFailure && error.code === "NOT_FOUND") {
      return new RuntimeError("rejected", redaction.applyTo(error.message), { cause: error })
    }
    const translated = ErrorTranslation.runtimeErrorOf(error)
    return new RuntimeError(translated.failure, redaction.applyTo(translated.message), {
      cause: error,
      ...(translated.hint === undefined ? {} : { hint: translated.hint }),
    })
  }
}
