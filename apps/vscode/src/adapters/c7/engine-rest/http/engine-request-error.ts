export type EngineRequestFailure = "refused" | "unanswered" | "answered"

const ROUTE_NOT_FOUND = "NotFoundException"
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
    const missing = error.status === 404 && error.engineType !== undefined
    const gone = error.status === 500 && error.engineType === RESOURCE_GONE
    return error.failure === "refused" || (missing && error.engineType !== ROUTE_NOT_FOUND) || gone
  }
}
