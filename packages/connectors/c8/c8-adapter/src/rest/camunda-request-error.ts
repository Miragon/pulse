import { type CamundaFailure, UnexpectedAnswerError } from "@miragon/pulse-c8-core"
import { WireFailures } from "../wire/wire-failures.js"
import type { TokenReason, WireReason } from "../wire/wire-reason.js"

export type CamundaRequestFailure = "refused" | "unusable" | "unanswered" | "answered" | "token"

const NO_SECONDARY_STORAGE = /secondary storage/i

interface RequestDetails {
  readonly status?: number | undefined
  readonly title?: string | undefined
  readonly hint?: string | undefined
  readonly token?: TokenReason | undefined
  readonly fields: CamundaFailure
  readonly cause: unknown
}

export class CamundaRequestError extends Error {
  override readonly name = "CamundaRequestError"
  readonly status: number | undefined
  readonly title: string | undefined
  readonly hint: string | undefined
  readonly token: TokenReason | undefined
  readonly fields: CamundaFailure

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
    this.fields = details.fields
  }

  static of(reason: WireReason): CamundaRequestError | UnexpectedAnswerError {
    if (reason.kind === "unexpected") {
      return new UnexpectedAnswerError(reason.message, { cause: reason.cause })
    }
    const fields = WireFailures.of(reason)
    if (reason.kind === "token") {
      const message = `The token endpoint ${reason.endpoint} gave no token`
      return new CamundaRequestError(message, "token", {
        token: reason,
        fields,
        cause: reason.cause,
      })
    }
    return new CamundaRequestError(reason.message, reason.kind, { ...reason, fields })
  }

  needsSecondaryStorage(): boolean {
    return this.status === 403 && NO_SECONDARY_STORAGE.test(this.message)
  }
}
