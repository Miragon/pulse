import type { TokenReason, WireReason } from "../wire/wire-reason.js"
import { UnexpectedAnswerError } from "./unexpected-answer-error.js"

export type CamundaRequestFailure = "refused" | "unusable" | "unanswered" | "answered" | "token"

const MISSING_RESOURCE_TITLE = "NOT_FOUND"
const NO_SECONDARY_STORAGE = /secondary storage/i

interface RequestDetails {
  readonly status?: number | undefined
  readonly title?: string | undefined
  readonly hint?: string | undefined
  readonly token?: TokenReason | undefined
  readonly cause: unknown
}

export class CamundaRequestError extends Error {
  override readonly name = "CamundaRequestError"
  readonly status: number | undefined
  readonly title: string | undefined
  readonly hint: string | undefined
  readonly token: TokenReason | undefined

  private constructor(
    message: string,
    readonly failure: CamundaRequestFailure,
    details: RequestDetails,
  ) {
    super(message, { cause: details.cause })
    this.status = details.status
    this.title = details.title
    this.hint = details.hint
    this.token = details.token
  }

  static of(reason: WireReason): CamundaRequestError | UnexpectedAnswerError {
    if (reason.kind === "unexpected") {
      return new UnexpectedAnswerError(reason.message, { cause: reason.cause })
    }
    if (reason.kind === "token") {
      const message = `The token endpoint ${reason.endpoint} gave no token`
      return new CamundaRequestError(message, "token", { token: reason, cause: reason.cause })
    }
    return new CamundaRequestError(reason.message, reason.kind, reason)
  }

  static isMissingResource(error: unknown): boolean {
    if (!(error instanceof CamundaRequestError)) {
      return false
    }
    const notFound = error.status === 404 && error.title === MISSING_RESOURCE_TITLE
    return error.failure === "refused" || notFound
  }

  needsSecondaryStorage(): boolean {
    return this.status === 403 && NO_SECONDARY_STORAGE.test(this.message)
  }
}
