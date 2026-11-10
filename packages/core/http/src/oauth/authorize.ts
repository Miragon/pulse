/**
 * The authorization request (RFC 6749 §4.1) and the check of its callback. The state comes
 * first and is compared in constant time: a callback without the right state is not this login's
 * and tells nothing else. After it the `iss` parameter (RFC 9207, the mix-up defense), an `error`
 * and the code decide. A repeated parameter counts as invalid (RFC 6749 §3.1).
 */

/** What an authorization request asks for. */
export interface AuthorizationRequest {
  readonly clientId: string
  readonly redirectUri: string
  /** Left out when there is none. */
  readonly scopes?: readonly string[]
  readonly audience?: string
  /** The S256 challenge of the PKCE verifier (`createPkce`). */
  readonly challenge: string
  readonly state: string
}

/**
 * The authorization URL: the endpoint with its own query kept, plus the code flow's parameters
 * with PKCE S256, the state, the scopes and the audience.
 */
export function authorizationUrl(endpoint: string, request: AuthorizationRequest): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
  })
  const scope = request.scopes?.join(" ") ?? ""
  if (scope !== "") params.set("scope", scope)
  params.set("state", request.state)
  params.set("code_challenge", request.challenge)
  params.set("code_challenge_method", "S256")
  if (request.audience !== undefined) params.set("audience", request.audience)
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`
}

const encoder = new TextEncoder()

/**
 * Whether two texts are equal, compared in constant time for equal lengths (an XOR over their
 * UTF-8 bytes): a wrong state does not end a login, so a local prober gets many attempts.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  a.forEach((byte, index) => {
    difference |= byte ^ Number(b[index])
  })
  return difference === 0
}

/** RFC 6749's error codes: printable ASCII without `"` and `\`. */
const ERROR_CODE = /^[\x20\x21\x23-\x5b\x5d-\x7e]+$/

/** What a callback must carry: the login's state and, where known, its issuer. */
export interface ExpectedCallback {
  readonly state: string
  /** The issuer an `iss` must name; none compares nothing. */
  readonly issuer?: string
  /** The server announced `iss` in its callbacks (RFC 9207): one without it is refused. */
  readonly issRequired?: boolean
}

/** Why a callback completes no login. */
export type CallbackProblem =
  /** Not this login's callback (no state, another, a repeated one): ignore it. */
  | { readonly problem: "state" }
  /** Another issuer, a repeated or a missing required `iss`: a possible mix-up attack. */
  | { readonly problem: "iss" }
  /**
   * The server reports `error` (an RFC 6749 code, else `invalid_error_code`) with its
   * `error_description` as sent, unchecked.
   */
  | { readonly problem: "error"; readonly error: string; readonly description?: string }
  /** No code, an empty one or a repeated one. */
  | { readonly problem: "no-code" }

function issOk(query: URLSearchParams, expected: ExpectedCallback): boolean {
  const values = query.getAll("iss")
  if (values.length > 1) return false
  const [iss] = values
  if (iss === undefined) return expected.issRequired !== true
  return expected.issuer === undefined || iss === expected.issuer
}

function errorOf(error: string, query: URLSearchParams): CallbackProblem {
  const description = query.get("error_description")
  return {
    problem: "error",
    error: ERROR_CODE.test(error) ? error : "invalid_error_code",
    ...(description === null ? {} : { description }),
  }
}

/** The authorization code of a callback, or why it completes no login (see the module comment). */
export function callbackResult(
  query: URLSearchParams,
  expected: ExpectedCallback,
): { readonly code: string } | CallbackProblem {
  const states = query.getAll("state")
  if (states.length !== 1 || !safeEqual(String(states[0]), expected.state)) {
    return { problem: "state" }
  }
  if (!issOk(query, expected)) return { problem: "iss" }
  const errors = query.getAll("error")
  if (errors.length === 1) return errorOf(String(errors[0]), query)
  const codes = query.getAll("code")
  if (errors.length > 0 || codes.length !== 1) return { problem: "no-code" }
  const code = String(codes[0])
  return code === "" ? { problem: "no-code" } : { code }
}
