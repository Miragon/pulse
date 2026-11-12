/**
 * Why an authorization server gave no token, as data: the kind, what the answer said and for how
 * long the endpoint should not be asked again. Each surface words it for its own reader; the
 * message here is a plain English fallback that never carries a token, a secret, a query or the
 * server's own text.
 */

export type TokenFailureKind =
  /** The client is refused: invalid_client, unauthorized_client, unsupported_grant_type, or a 401 without a code. */
  | "client"
  /** What the client asks for is refused: invalid_scope. */
  | "scope"
  /** The grant is refused (a code or a refresh token, invalid_grant), or any other error code. */
  | "grant"
  /** A 403: the client may not get a token here. */
  | "forbidden"
  /** A 429: the endpoint limits the requests from this address. */
  | "rate-limited"
  /** A 5xx, a 408 or a 425: the endpoint cannot answer now. */
  | "unavailable"
  /** A 3xx, never followed: the URL is not the endpoint itself. */
  | "redirect"
  /** A successful answer above the size cap. */
  | "too-large"
  /** Any other status, or a 200 without a usable token (`problem` says why). */
  | "unexpected"
  /** No connection, a broken one, a name that does not resolve, a failed TLS handshake. */
  | "unreachable"
  /** No complete answer within the deadline. */
  | "timeout"
  /**
   * No request: the token expired and nothing renews it (no refresh token, an expired one), or
   * the store holds no token at all. A new login is needed.
   */
  | "expired"

/** What is wrong with a 200 answer of the token endpoint. */
export type AnswerProblem = "not-json" | "no-token" | "token-syntax" | "token-type"

export interface TokenFailureDetails {
  /** The URL of a request that got no answer, as its caller gave it. */
  readonly url?: string | undefined
  readonly status?: number | undefined
  /** The answer's reason phrase, the standard one when it sent none. */
  readonly statusText?: string | undefined
  /** RFC 6749 §5.2 `error` of the answer as sent, unchecked: show it only cleaned. */
  readonly error?: string | undefined
  /** `error_description` of the answer as sent, unchecked: show it only cleaned, if at all. */
  readonly description?: string | undefined
  /** For a 200: what is wrong with it. */
  readonly problem?: AnswerProblem | undefined
  /** For the problem token-type: the `token_type` the answer named, unchecked. */
  readonly tokenType?: unknown
  /** For how long the endpoint should not be asked again, in ms. */
  readonly holdMs?: number | undefined
  /** A refusal recorded earlier (`TokenRecord.refreshRejected`), when it was recorded. */
  readonly recordedAt?: number | undefined
}

/** The hold of a refusal: a minute, so a wrong setting costs one request per minute. */
export const REFUSED_HOLD_MS = 60_000
/** The hold of an endpoint that cannot answer now: five seconds. */
export const UNAVAILABLE_HOLD_MS = 5_000

/** The kinds that pass by themselves: the endpoint is asked again after a short hold. */
const PASSING: ReadonlySet<TokenFailureKind> = new Set(["unavailable", "unreachable", "timeout"])

/** The longest code a failure keeps: no RFC 6749 code is longer. */
const MAX_CODE_LENGTH = 64
const OUTSIDE_A_CODE = /[^A-Za-z0-9_.-]/g

/** An `error` reduced to the characters of a code, at most 64 of them; none when nothing is left. */
function codeOf(error: string | undefined): string | undefined {
  const code = error?.replace(OUTSIDE_A_CODE, "").slice(0, MAX_CODE_LENGTH)
  return code === "" ? undefined : code
}

/** The default hold of a kind: five seconds for a passing one, a minute for any other. */
function holdOf(kind: TokenFailureKind): number {
  return PASSING.has(kind) ? UNAVAILABLE_HOLD_MS : REFUSED_HOLD_MS
}

function messageOf(kind: TokenFailureKind, details: TokenFailureDetails): string {
  const status = details.status === undefined ? "" : ` (HTTP ${String(details.status)})`
  const code = codeOf(details.error)
  return `no token: ${kind}${status}${code === undefined ? "" : ` (${code})`}`
}

/** An authorization server's refusal or failure: see {@link TokenFailureKind}. */
export class TokenFailure extends Error {
  override readonly name = "TokenFailure"
  readonly url: string | undefined
  readonly status: number | undefined
  readonly statusText: string | undefined
  readonly error: string | undefined
  readonly description: string | undefined
  /** `error` reduced to `[A-Za-z0-9_.-]`, at most 64 characters: safe to show anywhere. */
  readonly code: string | undefined
  readonly problem: AnswerProblem | undefined
  readonly tokenType: unknown
  readonly holdMs: number
  readonly recordedAt: number | undefined

  constructor(
    readonly kind: TokenFailureKind,
    details: TokenFailureDetails = {},
    cause?: unknown,
  ) {
    super(messageOf(kind, details), cause === undefined ? {} : { cause })
    this.url = details.url
    this.status = details.status
    this.statusText = details.statusText
    this.error = details.error
    this.description = details.description
    this.code = codeOf(details.error)
    this.problem = details.problem
    this.tokenType = details.tokenType
    this.holdMs = details.holdMs ?? holdOf(kind)
    this.recordedAt = details.recordedAt
  }
}

/** Whether `error` is a failure that passes by itself, so a still valid token may be kept. */
export function isPassing(error: unknown): boolean {
  return error instanceof TokenFailure && (PASSING.has(error.kind) || error.kind === "rate-limited")
}
