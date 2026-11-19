import type { CamundaFailure } from "@miragon/pulse-c8-core"
import { CredentialError, HttpFailure } from "@miragon/pulse-http"
import type { WireReason } from "./wire-reason.js"

export class WireFailures {
  static of(reason: WireReason): CamundaFailure {
    switch (reason.kind) {
      case "token":
        return {
          kind: "token",
          trouble: reason.trouble,
          status: reason.status,
          code: reason.code,
          problem: reason.problem,
          holdMs: reason.holdMs,
          capBytes: reason.capBytes,
        }
      case "answered":
        return {
          kind: "answered",
          status: reason.status,
          title: reason.title,
          detail: reason.detail,
          redirect: reason.redirect,
        }
      default:
        return WireFailures.unsent(reason.cause)
    }
  }

  private static unsent(cause: unknown): CamundaFailure {
    if (cause instanceof HttpFailure) {
      return { kind: "transport", reason: cause.reason, code: cause.code }
    }
    if (cause instanceof CredentialError) {
      return { kind: "transport", reason: "credential", code: cause.problem }
    }
    return { kind: "transport", reason: "invalid-request", code: undefined }
  }
}
