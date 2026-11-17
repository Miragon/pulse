import type { CamundaFailure } from "@miragon/pulse-c8-core"
import { WireFailures } from "../wire/wire-failures.js"
import type { TokenReason, WireReason } from "../wire/wire-reason.js"

interface RequestDetails {
  readonly hint: string | undefined
  readonly token: TokenReason | undefined
  readonly cause: unknown
}

export class CamundaRequestError extends Error {
  override readonly name = "CamundaRequestError"
  readonly hint: string | undefined
  readonly token: TokenReason | undefined

  private constructor(
    message: string,
    readonly fields: CamundaFailure,
    details: RequestDetails,
  ) {
    super(message, { cause: details.cause })
    this.hint = details.hint
    this.token = details.token
  }

  static of(reason: WireReason): CamundaRequestError {
    const fields = WireFailures.of(reason)
    if (reason.kind === "token") {
      const message = `The token endpoint ${reason.endpoint} gave no token`
      return new CamundaRequestError(message, fields, {
        hint: undefined,
        token: reason,
        cause: reason.cause,
      })
    }
    return new CamundaRequestError(reason.message, fields, {
      hint: reason.hint,
      token: undefined,
      cause: reason.cause,
    })
  }
}
