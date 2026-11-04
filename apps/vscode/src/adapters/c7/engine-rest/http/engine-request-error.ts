import { isMissing } from "@miragon/pulse-engine-core"

export type EngineRequestFailure = "refused" | "unanswered" | "answered"

const RESOURCE_GONE = "NullValueException"

export class EngineRequestError extends Error {
  override readonly name = "EngineRequestError"

  private constructor(
    message: string,
    readonly failure: EngineRequestFailure,
    readonly status?: number,
    readonly engineType?: string,
  ) {
    super(message)
  }

  static refused(message: string): EngineRequestError {
    return new EngineRequestError(message, "refused")
  }

  static unanswered(message: string): EngineRequestError {
    return new EngineRequestError(message, "unanswered")
  }

  static answered(status: number, message: string, engineType?: string): EngineRequestError {
    return new EngineRequestError(message, "answered", status, engineType)
  }

  static statusOf(error: unknown): number | undefined {
    return error instanceof EngineRequestError ? error.status : undefined
  }

  static isMissingResource(error: unknown): boolean {
    if (!(error instanceof EngineRequestError)) {
      return false
    }
    const gone = error.status === 500 && error.engineType === RESOURCE_GONE
    return error.failure === "refused" || EngineRequestError.isMissing404(error) || gone
  }

  private static isMissing404(error: EngineRequestError): boolean {
    if (error.status === undefined) {
      return false
    }
    return isMissing(
      error.engineType === undefined
        ? { status: error.status }
        : { status: error.status, engineType: error.engineType },
    )
  }
}
