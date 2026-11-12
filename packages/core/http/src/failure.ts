/**
 * Why a request failed, as data. Each surface words the reason for its own reader (the model,
 * a terminal, an editor); the message here is a plain English fallback that never carries a
 * query, a credential or more than 500 characters of the server's text.
 */
import type { HttpAnswer } from "./types.js"
import { clipText } from "./mask.js"

export type FailureReason =
  /** No connection: refused, no route, the connect timed out. Nothing was sent. */
  | "unreachable"
  /** The host name does not resolve. Nothing was sent. */
  | "dns"
  /**
   * The TLS handshake failed (an untrusted, expired or misnamed certificate, a server without
   * TLS). Nothing was sent.
   */
  | "tls"
  /** No complete answer, to its last byte, within the connection's timeoutMs. */
  | "deadline"
  /** The caller aborted a read. */
  | "cancelled"
  /** The connection broke after the request may have left. */
  | "connection"
  /** The answer exceeds the connection's maxAnswerBytes. */
  | "too-large"
  /** A 3xx: never followed, since a followed 302 turns a write into a GET of a login page. */
  | "redirect"
  /** A 401, after the one second attempt a renewable credential earns. */
  | "unauthorized"
  /** Any other status from 400 on, with the problem its body states. */
  | "status"
  /** A body that is not what the request expects (JSON that does not parse). */
  | "invalid-answer"
  /** The request cannot be sent: its URL, a header, a body on a GET. Nothing was sent. */
  | "invalid-request"
  /** A write on a read-only connection. Nothing was sent. */
  | "refused-write"
  /** The credential cannot be sent (a line break inside a token). Nothing was sent. */
  | "credential"

export const FAILURE_REASONS: readonly FailureReason[] = [
  "unreachable",
  "dns",
  "tls",
  "deadline",
  "cancelled",
  "connection",
  "too-large",
  "redirect",
  "unauthorized",
  "status",
  "invalid-answer",
  "invalid-request",
  "refused-write",
  "credential",
]

/**
 * What an error body states: an exception's type and message (`type`, `message`, `code`), RFC
 * 9457's `detail` or `title`, RFC 6749's `error_description` or `error`, or a plain text body.
 */
export interface Problem {
  readonly type?: string
  readonly message?: string
  readonly code?: number
}

export interface FailureDetails {
  readonly method: string
  /** Origin and path of the request, never its query or a credential; masked. */
  readonly target: string
  /**
   * True only for a write (any request not marked as a read) that failed after it may have left
   * (deadline, connection, too large, invalid answer): its outcome is unknown. A read never
   * carries it, a reading POST included.
   */
  readonly mayHaveApplied: boolean
  readonly status?: number
  /** redirect: where it pointed, origin and path only, masked, at most 200 characters. */
  readonly location?: string
  /** The system code (ECONNREFUSED, DEPTH_ZERO_SELF_SIGNED_CERT) or the refused part. */
  readonly code?: string
  /** unauthorized, status: what the body states, masked. */
  readonly problem?: Problem
  /** unauthorized, status: the answer itself, masked, for a dialect's own reading. */
  readonly answer?: HttpAnswer
  /** deadline: the timeout in ms; too-large: the cap in bytes. */
  readonly limit?: number
}

const CAVEAT = "; the write may have been applied, check the state before retrying"
const ADVICE =
  "redirects are never followed: point the URL at the API root itself (https:// when the " +
  "server redirects from http://); a redirect to a login page means the credentials are " +
  "missing or expired"

const codeNote = (details: FailureDetails): string =>
  details.code === undefined ? "" : ` (${details.code})`

const problemNote = (problem: Problem | undefined): string => {
  const text = clipText([problem?.type, problem?.message].filter(Boolean).join(": "))
  return text === "" ? "" : `: ${text}`
}

const MESSAGES: Readonly<Record<FailureReason, (details: FailureDetails) => string>> = {
  unreachable: (d) => `cannot connect${codeNote(d)}`,
  dns: (d) => `the host name does not resolve${codeNote(d)}`,
  tls: (d) => `the TLS handshake failed${codeNote(d)}`,
  deadline: (d) => `no complete answer within ${String(d.limit)} ms`,
  cancelled: () => "cancelled by the caller",
  connection: (d) => `the connection failed${codeNote(d)}`,
  "too-large": (d) => `the answer exceeds ${String(d.limit)} bytes`,
  redirect: (d) =>
    `${String(d.status)} redirect${d.location === undefined ? "" : ` to ${d.location}`}: ${ADVICE}`,
  unauthorized: (d) => `401 Unauthorized${problemNote(d.problem)}`,
  status: (d) =>
    [String(d.status), d.answer?.statusText].filter(Boolean).join(" ") + problemNote(d.problem),
  "invalid-answer": (d) => `the answer is no valid JSON${codeNote(d)}`,
  "invalid-request": (d) => `the request cannot be sent${codeNote(d)}`,
  "refused-write": () => "refused: the connection only reads",
  credential: (d) => `the credential is refused${codeNote(d)}`,
}

/** A request that failed: the reason and its details as data, see {@link FailureReason}. */
export class HttpFailure extends Error {
  override readonly name = "HttpFailure"
  readonly method: string
  readonly target: string
  readonly mayHaveApplied: boolean
  readonly status: number | undefined
  readonly location: string | undefined
  readonly code: string | undefined
  readonly problem: Problem | undefined
  readonly answer: HttpAnswer | undefined
  readonly limit: number | undefined

  constructor(
    readonly reason: FailureReason,
    details: FailureDetails,
    cause?: unknown,
  ) {
    const caveat = details.mayHaveApplied ? CAVEAT : ""
    const where = `${details.method} ${details.target}`.trim()
    super(`${where}: ${MESSAGES[reason](details)}${caveat}`, cause === undefined ? {} : { cause })
    this.method = details.method
    this.target = details.target
    this.mayHaveApplied = details.mayHaveApplied
    this.status = details.status
    this.location = details.location
    this.code = details.code
    this.problem = details.problem
    this.answer = details.answer
    this.limit = details.limit
  }
}
