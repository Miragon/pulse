import { type FailureReason, HttpFailure } from "@miragon/pulse-http"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import { EngineRequestError } from "./engine-request-error.js"
import { ErrorAnswers } from "./error-answers.js"

type Worded = (failure: HttpFailure) => Error

const REDIRECT_HINT =
  "Pulse never follows a redirect: point the engine URL at the REST API root itself (https:// if the engine redirects from http://). A redirect to a login page means the credentials are missing or expired."
const TLS_HINT =
  "Check that this computer trusts the engine's certificate and that the engine serves https at this URL."
const DNS_HINT = "Check the host name in the engine URL."
const CONNECTION_HINT =
  "Check the network path to the engine, such as a proxy, a VPN or a firewall."
const PATH_VALUE_CODES: ReadonlySet<string> = new Set(["dot-segment", "empty-segment"])

export class HttpFailures {
  private static readonly WORDING: Readonly<Record<FailureReason, Worded>> = {
    unreachable: (failure) => HttpFailures.unreached(failure, ""),
    dns: (failure) => HttpFailures.unreached(failure, ": the host name does not resolve", DNS_HINT),
    tls: (failure) => HttpFailures.unreached(failure, ": the TLS handshake failed", TLS_HINT),
    deadline: (failure) =>
      EngineRequestError.unanswered(
        `${failure.target} did not answer within ${String(failure.limit)} ms`,
        { cause: failure },
      ),
    cancelled: (failure) =>
      EngineRequestError.unanswered(`The call to ${failure.target} was cancelled`, {
        cause: failure,
      }),
    connection: (failure) =>
      EngineRequestError.unanswered(
        `The connection to ${failure.target} failed${HttpFailures.codeNote(failure)}`,
        { hint: CONNECTION_HINT, cause: failure },
      ),
    "too-large": (failure) =>
      new UnexpectedAnswerError(
        `the engine answered with more than ${String(failure.limit)} bytes`,
        { cause: failure },
      ),
    redirect: (failure) => HttpFailures.redirected(failure),
    unauthorized: (failure) => HttpFailures.answered(failure),
    status: (failure) => HttpFailures.answered(failure),
    "invalid-answer": (failure) =>
      new UnexpectedAnswerError("the engine answered no JSON", { cause: failure }),
    "invalid-request": (failure) => HttpFailures.unsendable(failure),
    "refused-write": (failure) =>
      HttpFailures.refused(failure, "writes, and this connection only reads"),
    credential: (failure) =>
      EngineRequestError.unusable(`The credentials for ${failure.target} cannot be sent`, {
        cause: failure,
      }),
  }

  static errorOf(error: unknown): unknown {
    return error instanceof HttpFailure ? HttpFailures.WORDING[error.reason](error) : error
  }

  private static unreached(failure: HttpFailure, reason: string, hint?: string): Error {
    const message = `Cannot reach ${failure.target}${reason}${HttpFailures.codeNote(failure)}`
    return EngineRequestError.unanswered(
      message,
      hint === undefined ? { cause: failure } : { hint, cause: failure },
    )
  }

  private static redirected(failure: HttpFailure): Error {
    const status = failure.status ?? 0
    const where = failure.location === undefined ? "" : `: redirects to ${failure.location}`
    const message = `${ErrorAnswers.statusLine(status)}${where}`
    return EngineRequestError.answered(status, message, { hint: REDIRECT_HINT, cause: failure })
  }

  private static answered(failure: HttpFailure): Error {
    if (failure.answer !== undefined) {
      return ErrorAnswers.errorOf(failure.answer, failure)
    }
    const status = failure.status ?? 0
    return EngineRequestError.answered(status, ErrorAnswers.statusLine(status), { cause: failure })
  }

  private static unsendable(failure: HttpFailure): Error {
    if (failure.code !== undefined && PATH_VALUE_CODES.has(failure.code)) {
      return HttpFailures.refused(failure, "cannot be sent")
    }
    const code = HttpFailures.codeNote(failure)
    return EngineRequestError.unusable(
      `${failure.method} ${failure.target} cannot be sent${code}`,
      {
        cause: failure,
      },
    )
  }

  private static refused(failure: HttpFailure, what: string): Error {
    const code = HttpFailures.codeNote(failure)
    return EngineRequestError.refused(`${failure.method} ${failure.target} ${what}${code}`, {
      cause: failure,
    })
  }

  private static codeNote(failure: HttpFailure): string {
    return failure.code === undefined ? "" : ` (${failure.code})`
  }
}
