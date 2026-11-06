const MISSING_RESOURCE_TITLE = "NOT_FOUND"
const NO_SECONDARY_STORAGE = /secondary storage/i

export type CamundaRequestFailure = "unanswered" | "answered"

export class CamundaRequestError extends Error {
  override readonly name = "CamundaRequestError"

  private constructor(
    message: string,
    readonly failure: CamundaRequestFailure,
    readonly status?: number,
    readonly title?: string,
  ) {
    super(message)
  }

  static unanswered(message: string): CamundaRequestError {
    return new CamundaRequestError(message, "unanswered")
  }

  static answered(status: number, message: string, title?: string): CamundaRequestError {
    return new CamundaRequestError(message, "answered", status, title)
  }

  static isMissingResource(error: unknown): boolean {
    return (
      error instanceof CamundaRequestError &&
      error.status === 404 &&
      error.title === MISSING_RESOURCE_TITLE
    )
  }

  needsSecondaryStorage(): boolean {
    return this.status === 403 && NO_SECONDARY_STORAGE.test(this.message)
  }
}
