/**
 * The token endpoint (RFC 6749): a grant becomes a token, a token is revoked (RFC 7009). The
 * client authenticates as its endpoint says (§2.3.1), an answer is checked before its token is
 * kept (an RFC 6750 b64token, a Bearer type, a positive lifetime) and a refusal is read as a
 * {@link TokenFailure}: by its status, and for a 400 or 401 by its error code (§5.2).
 */
import type { Authorization } from "../credential.js"
import { base64 } from "../credential.js"
import type { Platform } from "../types.js"
import {
  type AnswerProblem,
  REFUSED_HOLD_MS,
  TokenFailure,
  type TokenFailureKind,
} from "./failure.js"
import { retryAfterMs } from "./retry-after.js"
import type { Grant, TokenEndpoint, TokenLimits, TokenRecord } from "./types.js"
import { exchange, type ServerAnswer } from "./wire.js"

/** RFC 6750's b64token: what a Bearer header may carry. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/
/** A lifetime in seconds as some servers send it, as text. */
const NUMERIC = /^\d+(?:\.\d+)?$/
const FORM_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/x-www-form-urlencoded",
}

/** Codes that refuse the client itself: who it is, or which grants it may use. */
const CLIENT_CODES: ReadonlySet<string> = new Set([
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
])
/** Statuses of an endpoint that cannot answer now, besides a 5xx. */
const LATER_STATUSES: ReadonlySet<number> = new Set([408, 425])
/** The fields of a form that carry a secret: the client's, the grant's, a token to revoke. */
const SECRET_FIELDS = ["client_secret", "refresh_token", "code", "code_verifier", "token"]

/** Whether `value` is an access token that can be sent: RFC 6750's b64token. */
export function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && B64TOKEN.test(value)
}

/** `text` form-encoded (application/x-www-form-urlencoded: `+` for a space). */
function formEncode(text: string): string {
  return new URLSearchParams([["", text]]).toString().slice(1)
}

/**
 * The client's authentication of a request (RFC 6749 §2.3.1): its id in the form for a public
 * client; for a confidential one its secret in the form (`post`) or both, form-encoded, in an
 * Authorization header (`basic`).
 */
function authenticated(form: URLSearchParams, endpoint: TokenEndpoint): Authorization | undefined {
  const { clientId, clientSecret, clientAuth } = endpoint
  if (clientSecret === undefined || clientAuth !== "basic") {
    form.set("client_id", clientId)
    if (clientSecret !== undefined && clientAuth === "post") form.set("client_secret", clientSecret)
    return undefined
  }
  const value = base64(`${formEncode(clientId)}:${formEncode(clientSecret)}`)
  return { header: `Basic ${value}`, secrets: [clientSecret, formEncode(clientSecret), value] }
}

function grantForm(grant: Grant): URLSearchParams {
  switch (grant.type) {
    case "authorization_code":
      return new URLSearchParams({
        grant_type: "authorization_code",
        code: grant.code,
        redirect_uri: grant.redirectUri,
        code_verifier: grant.verifier,
      })
    case "refresh_token":
      return new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refreshToken })
    case "client_credentials": {
      const form = new URLSearchParams({ grant_type: "client_credentials" })
      if (grant.audience !== undefined) form.set("audience", grant.audience)
      const scope = grant.scopes?.join(" ") ?? ""
      if (scope !== "") form.set("scope", scope)
      return form
    }
  }
}

/** A string field of an answer, as sent. */
function textOf(
  json: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const value = json?.[key]
  return typeof value === "string" ? value : undefined
}

/** The kind of a 400 or 401 by its error code (RFC 6749 §5.2); a 401 without one refuses the client. */
function codedKind(status: number, error: string | undefined): TokenFailureKind {
  if (error === undefined || error === "") return status === 401 ? "client" : "unexpected"
  if (CLIENT_CODES.has(error)) return "client"
  return error === "invalid_scope" ? "scope" : "grant"
}

function kindOf(status: number, error: string | undefined): TokenFailureKind {
  if (status >= 300 && status < 400) return "redirect"
  if (status === 429) return "rate-limited"
  if (status >= 500 || LATER_STATUSES.has(status)) return "unavailable"
  if (status === 403) return "forbidden"
  return status === 400 || status === 401 ? codedKind(status, error) : "unexpected"
}

/**
 * What an answer of any other status than 200 means. A rate limit holds for the wait its
 * Retry-After asks for, else a minute.
 */
function refusalOf(answer: ServerAnswer, now: number): TokenFailure {
  const error = textOf(answer.json, "error")
  const kind = kindOf(answer.status, error)
  return new TokenFailure(kind, {
    status: answer.status,
    statusText: answer.statusText,
    error,
    description: textOf(answer.json, "error_description"),
    holdMs:
      kind === "rate-limited" ? (retryAfterMs(answer.headers, now) ?? REFUSED_HOLD_MS) : undefined,
  })
}

/** A positive, finite number of seconds (a number, or digits as text); else undefined. */
function secondsOf(value: unknown): number | undefined {
  const number = typeof value === "string" && NUMERIC.test(value) ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : undefined
}

/** A 200 answer without a usable token. */
function unusable(answer: ServerAnswer, problem: AnswerProblem, tokenType?: unknown) {
  const { status, statusText } = answer
  return new TokenFailure("unexpected", { status, statusText, problem, tokenType })
}

/**
 * The access token of a 200 answer, checked (RFC 6749 §5.1, RFC 6750 §2.1): a b64token and,
 * when the answer names a type, a Bearer token.
 */
function accessTokenOf(answer: ServerAnswer, json: Readonly<Record<string, unknown>>): string {
  const { access_token: accessToken, token_type: tokenType } = json
  if (typeof accessToken !== "string" || accessToken === "") throw unusable(answer, "no-token")
  if (!isAccessToken(accessToken)) throw unusable(answer, "token-syntax")
  const bearer = typeof tokenType === "string" && tokenType.toLowerCase() === "bearer"
  if (tokenType !== undefined && !bearer) throw unusable(answer, "token-type", tokenType)
  return accessToken
}

/** The token of a 200 answer received at `receivedAt`, its lifetimes counted from then. */
function recordOf(answer: ServerAnswer, receivedAt: number): TokenRecord {
  const { json } = answer
  if (json === undefined) throw unusable(answer, "not-json")
  const expiresIn = secondsOf(json.expires_in)
  const refreshExpiresIn = secondsOf(json.refresh_expires_in)
  const refreshToken = textOf(json, "refresh_token")
  return {
    accessToken: accessTokenOf(answer, json),
    receivedAt,
    expiresAt: expiresIn === undefined ? undefined : receivedAt + expiresIn * 1000,
    refreshToken: refreshToken === "" ? undefined : refreshToken,
    refreshExpiresAt:
      refreshExpiresIn === undefined ? undefined : receivedAt + refreshExpiresIn * 1000,
    scope: textOf(json, "scope"),
    idToken: textOf(json, "id_token"),
  }
}

/**
 * POSTs a form to `endpoint` with the client's authentication; every secret the request carries,
 * in its header or its form, is masked wherever the answer quotes it.
 */
function post(
  form: URLSearchParams,
  endpoint: TokenEndpoint,
  platform: Platform,
  limits: TokenLimits | undefined,
): Promise<ServerAnswer> {
  const authorization = authenticated(form, endpoint)
  return exchange(
    {
      method: "POST",
      url: endpoint.url,
      headers: FORM_HEADERS,
      body: form.toString(),
      authorization,
      secrets: SECRET_FIELDS.flatMap((name) => form.getAll(name)),
    },
    platform,
    limits,
  )
}

/**
 * Asks `endpoint` for a token by `grant`. Fails with a {@link TokenFailure}: a refusal, an
 * answer without a usable token, or no answer at all; with a RangeError, before sending, for a
 * URL that is no http or https URL or carries a user or a password.
 */
export async function requestToken(
  endpoint: TokenEndpoint,
  grant: Grant,
  platform: Platform,
  limits?: TokenLimits,
): Promise<TokenRecord> {
  const answer = await post(grantForm(grant), endpoint, platform, limits)
  if (answer.status !== 200) throw refusalOf(answer, platform.now())
  return recordOf(answer, platform.now())
}

/**
 * Revokes `token` (RFC 7009): a 200 means done, also for a token that was invalid already.
 * Fails with a {@link TokenFailure} otherwise, and for a URL as `requestToken` does.
 */
export async function revokeToken(
  endpoint: TokenEndpoint,
  token: { readonly value: string; readonly hint: "refresh_token" | "access_token" },
  platform: Platform,
  limits?: TokenLimits,
): Promise<void> {
  const form = new URLSearchParams({ token: token.value, token_type_hint: token.hint })
  const answer = await post(form, endpoint, platform, limits)
  if (answer.status !== 200) throw refusalOf(answer, platform.now())
}
