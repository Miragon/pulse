import { isMissing } from "@miragon/pulse-c7-core"

export type EngineRequestFailure = "refused" | "readOnly" | "unusable" | "unanswered" | "answered"

export interface EngineRequestDetails {
  readonly engineType?: string
  readonly hint?: string
  readonly cause?: unknown
}

const RESOURCE_GONE = "NullValueException"

export class EngineRequestError extends Error {
  override readonly name = "EngineRequestError"
  readonly engineType: string | undefined
  readonly hint: string | undefined

  private constructor(
    message: string,
    readonly failure: EngineRequestFailure,
    readonly status: number | undefined,
    details: EngineRequestDetails,
  ) {
    super(message, details.cause === undefined ? {} : { cause: details.cause })
    this.engineType = details.engineType
    this.hint = details.hint
  }

  static refused(message: string, details: EngineRequestDetails = {}): EngineRequestError {
    return new EngineRequestError(message, "refused", undefined, details)
  }

  static readOnly(message: string, details: EngineRequestDetails = {}): EngineRequestError {
    return new EngineRequestError(message, "readOnly", undefined, details)
  }

  static unusable(message: string, details: EngineRequestDetails = {}): EngineRequestError {
    return new EngineRequestError(message, "unusable", undefined, details)
  }

  static unanswered(message: string, details: EngineRequestDetails = {}): EngineRequestError {
    return new EngineRequestError(message, "unanswered", undefined, details)
  }

  static answered(
    status: number,
    message: string,
    details: EngineRequestDetails = {},
  ): EngineRequestError {
    return new EngineRequestError(message, "answered", status, details)
  }

  static statusOf(error: unknown): number | undefined {
    return error instanceof EngineRequestError ? error.status : undefined
  }

  static hintOf(error: unknown): string | undefined {
    return error instanceof EngineRequestError ? error.hint : undefined
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
