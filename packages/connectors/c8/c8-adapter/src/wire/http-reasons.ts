import type { FailureReason, HttpFailure } from "@miragon/pulse-http"
import { AnswerReasons } from "./answer-reasons.js"
import type { UnansweredReason, WireReason } from "./wire-reason.js"

type Worded = (failure: HttpFailure) => WireReason

const REDIRECT_HINT =
  "Pulse never follows a redirect: point the cluster URL at the REST API root itself, which ends in /v2 (https:// if the cluster redirects from http://). A redirect to a login page means the credentials are missing or expired."
const TLS_HINT =
  "Check that this computer trusts the cluster's certificate and that the cluster serves https at this URL."
const DNS_HINT = "Check the host name in the cluster URL."
const CONNECTION_HINT =
  "Check the network path to the cluster, such as a proxy, a VPN or a firewall."
const PATH_VALUE_CODES: ReadonlySet<string> = new Set(["dot-segment", "empty-segment"])

export class HttpReasons {
  private static readonly WORDING: Readonly<Record<FailureReason, Worded>> = {
    unreachable: (failure) => HttpReasons.unreached(failure, ""),
    dns: (failure) => HttpReasons.unreached(failure, ": the host name does not resolve", DNS_HINT),
    tls: (failure) => HttpReasons.unreached(failure, ": the TLS handshake failed", TLS_HINT),
    deadline: (failure) =>
      HttpReasons.unanswered(
        `${failure.target} did not answer within ${String(failure.limit)} ms`,
        failure,
      ),
    cancelled: (failure) =>
      HttpReasons.unanswered(`The call to ${failure.target} was cancelled`, failure),
    connection: (failure) =>
      HttpReasons.unanswered(
        `The connection to ${failure.target} failed${HttpReasons.codeNote(failure)}`,
        failure,
        CONNECTION_HINT,
      ),
    "too-large": (failure) =>
      HttpReasons.unexpected(
        `the cluster answered with more than ${String(failure.limit)} bytes`,
        failure,
      ),
    redirect: (failure) => HttpReasons.redirected(failure),
    unauthorized: (failure) => HttpReasons.answered(failure),
    status: (failure) => HttpReasons.answered(failure),
    "invalid-answer": (failure) => HttpReasons.unexpected("the cluster answered no JSON", failure),
    "invalid-request": (failure) => HttpReasons.unsendable(failure),
    "refused-write": (failure) =>
      HttpReasons.unusable(
        `Read-only. This connection only reads, so Pulse did not send ${failure.method} ${failure.target}.`,
        failure,
      ),
    credential: (failure) =>
      HttpReasons.unusable(`The credentials for ${failure.target} cannot be sent`, failure),
  }

  static of(failure: HttpFailure): WireReason {
    return HttpReasons.WORDING[failure.reason](failure)
  }

  private static unreached(failure: HttpFailure, reason: string, hint?: string): WireReason {
    const message = `Cannot reach ${failure.target}${reason}${HttpReasons.codeNote(failure)}`
    return HttpReasons.unanswered(message, failure, hint)
  }

  private static unanswered(
    message: string,
    failure: HttpFailure,
    hint?: string,
  ): UnansweredReason {
    return { kind: "unanswered", message, hint, cause: failure }
  }

  private static unexpected(message: string, failure: HttpFailure): WireReason {
    return { kind: "unexpected", message, cause: failure }
  }

  private static unusable(message: string, failure: HttpFailure): WireReason {
    return { kind: "unusable", message, cause: failure }
  }

  private static redirected(failure: HttpFailure): WireReason {
    const status = failure.status ?? 0
    const where = failure.location === undefined ? "" : `: redirects to ${failure.location}`
    return {
      kind: "answered",
      status,
      message: `${AnswerReasons.statusLine(status)}${where}`,
      title: undefined,
      hint: REDIRECT_HINT,
      cause: failure,
    }
  }

  private static answered(failure: HttpFailure): WireReason {
    if (failure.answer !== undefined) {
      return AnswerReasons.of(failure.answer, failure)
    }
    const status = failure.status ?? 0
    return {
      kind: "answered",
      status,
      message: AnswerReasons.statusLine(status),
      title: undefined,
      hint: undefined,
      cause: failure,
    }
  }

  private static unsendable(failure: HttpFailure): WireReason {
    const message = `${failure.method} ${failure.target} cannot be sent${HttpReasons.codeNote(failure)}`
    if (failure.code !== undefined && PATH_VALUE_CODES.has(failure.code)) {
      return { kind: "refused", message, cause: failure }
    }
    return HttpReasons.unusable(message, failure)
  }

  private static codeNote(failure: HttpFailure): string {
    return failure.code === undefined ? "" : ` (${failure.code})`
  }
}
