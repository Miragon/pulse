/**
 * Token endpoint requests: code exchange, refresh and revocation (RFC 7009), the
 * validation of token responses and the mapping of token errors. Messages show the
 * sanitized `error` and `error_description` of the answer, never other parts of a body.
 */

import { configError } from "../../config/config-error.js"
import { OperateError } from "../../errors.js"
import { isRecord } from "../../util.js"
import { decodeBase64Url } from "../jwt.js"
import {
  loginCommand,
  loginFailed,
  type LoginOwner,
  loginRequired,
  owner,
  REFRESH_REJECTED,
} from "./errors.js"
import {
  type ClientCredentials,
  type Endpoint,
  postForm,
  sanitize,
  type ServerAnswer,
  shownUrl,
  statusLine,
} from "./http.js"
import type { OAuthDeps, TokenResponse } from "./types.js"

/** A token request: endpoint, client authentication and whose login it is. */
export interface TokenClient extends ClientCredentials {
  readonly endpoint: Endpoint
  readonly who: LoginOwner
}

/** RFC 6750 b64token. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/
const NUMERIC = /^\d+(?:\.\d+)?$/

/** Token errors about the client registration: CONFIG, a new login would not help. */
const CLIENT_ERRORS: ReadonlySet<string> = new Set([
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
])

type Grant = "exchange" | "refresh"

function unusable(hint: string): OperateError {
  return configError("The authorization server answered without a usable access token", hint)
}

/** Seconds of a positive `expires_in` (number or numeric string), else null. */
function seconds(value: unknown): number | null {
  const number = typeof value === "string" && NUMERIC.test(value) ? Number(value) : value
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

function displayClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = text(claims[key])
  return value === null ? null : sanitize(value)
}

/**
 * `sub` and the user name (`preferred_username`, else `email`) of an ID token, for display only:
 * the token is not validated, not stored and never trusted for decisions.
 */
export function idTokenClaims(idToken: unknown): { subject: string | null; user: string | null } {
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(String(idToken).split(".")[1] ?? ""))
    if (!isRecord(payload)) return { subject: null, user: null }
    return {
      subject: displayClaim(payload, "sub"),
      user: displayClaim(payload, "preferred_username") ?? displayClaim(payload, "email"),
    }
  } catch {
    return { subject: null, user: null }
  }
}

function checkTokenType(tokenType: unknown): void {
  if (
    tokenType === undefined ||
    (typeof tokenType === "string" && tokenType.toLowerCase() === "bearer")
  ) {
    return
  }
  throw configError(
    `Unsupported token type "${sanitize(typeof tokenType === "string" ? tokenType : JSON.stringify(tokenType))}"; pulse-cli sends Bearer tokens only`,
    "Configure the client at the authorization server for Bearer tokens (no DPoP or mTLS binding).",
  )
}

/** Validates a 200 token response (RFC 6749 §5.1). */
export function parseTokenResponse(json: Record<string, unknown> | undefined): TokenResponse {
  if (json === undefined) throw unusable("The token endpoint did not answer with a JSON object.")
  const accessToken = json.access_token
  if (typeof accessToken !== "string" || !B64TOKEN.test(accessToken)) {
    throw unusable("The token response has no access_token in the Bearer token syntax (RFC 6750).")
  }
  checkTokenType(json.token_type)
  return {
    accessToken,
    expiresIn: seconds(json.expires_in),
    refreshToken: text(json.refresh_token),
    refreshExpiresIn: seconds(json.refresh_expires_in),
    scope: typeof json.scope === "string" ? json.scope : null,
    ...(json.id_token === undefined ? { subject: null, user: null } : idTokenClaims(json.id_token)),
  }
}

/** `(error: description)` of a token error answer, sanitized. */
function errorDetail(error: string, description: unknown): string {
  const detail =
    typeof description === "string" && description !== "" ? `: ${sanitize(description)}` : ""
  return `(${sanitize(error)}${detail})`
}

function clientError(clientId: string, detail: string): OperateError {
  return configError(
    `The authorization server rejected client ${clientId} ${detail}`,
    `Check the client id, the client secret source (auth.clientSecretEnv, PULSE_CLI_OAUTH_CLIENT_SECRET) and that the client is public or confidential as configured and allows the authorization code flow and refresh tokens. Keycloak answers unauthorized_client "Invalid client or Invalid client credentials" for a wrong or missing client secret.`,
  )
}

/** The `error: description` of refresh errors that need a new login, by error object. */
const rejections = new WeakMap<OperateError, string>()

/**
 * `invalid_grant: <description>` (or another error code) when `error` is the LOGIN_REQUIRED of
 * a refresh the authorization server refused; undefined for every other error.
 */
export function refreshRejection(error: unknown): string | undefined {
  return error instanceof OperateError ? rejections.get(error) : undefined
}

function refreshError(error: string, detail: string, who: LoginOwner): OperateError {
  const whose = owner(who.profile)
  const rejected =
    error === "invalid_grant"
      ? loginRequired(
          `The authorization server rejected the refresh token of ${whose} ${detail}`,
          who,
          REFRESH_REJECTED,
        )
      : loginRequired(`Refreshing the OAuth login of ${whose} failed ${detail}`, who)
  rejections.set(rejected, detail.slice(1, -1))
  return rejected
}

function grantError(
  grant: Grant,
  error: string,
  detail: string,
  client: TokenClient,
): OperateError {
  const { who } = client
  if (grant === "refresh") return refreshError(error, detail, who)
  return error === "invalid_grant"
    ? loginFailed(
        `The authorization server rejected the authorization code ${detail}`,
        `The code expired or was already used; run \`${loginCommand(who)}\` again.`,
      )
    : loginFailed(
        `The code exchange failed ${detail}`,
        `Run \`${loginCommand(who)}\` again; if it keeps failing, check the client at the authorization server.`,
      )
}

function serverError(answer: ServerAnswer, grant: Grant): OperateError {
  return new OperateError(
    "HTTP_SERVER_ERROR",
    `The authorization server failed: ${statusLine(answer)}`,
    {
      status: answer.status,
      request: { method: "POST", url: shownUrl(answer.url) },
      hint: grant === "refresh" ? "Retry later; the login is kept." : "Retry later.",
    },
  )
}

/** The `error` of a 400/401 token error answer (RFC 6749 §5.2), if it has one. */
function errorCodeOf(answer: ServerAnswer): string | undefined {
  const error = answer.json?.error
  const rejected = answer.status === 400 || answer.status === 401
  return rejected && typeof error === "string" && error !== "" ? error : undefined
}

function unexpected(answer: ServerAnswer, client: TokenClient): OperateError {
  const redirect =
    answer.status >= 300 && answer.status < 400 ? " (pulse-cli follows no redirects)" : ""
  return configError(
    `Unexpected answer from ${shownUrl(answer.url)}: ${statusLine(answer)}${redirect}`,
    `Check the token endpoint (${client.endpoint.source}).`,
  )
}

/** The error of a failed token request. */
export function tokenError(answer: ServerAnswer, grant: Grant, client: TokenClient): OperateError {
  if (answer.status >= 500) return serverError(answer, grant)
  const error = errorCodeOf(answer)
  if (error === undefined) return unexpected(answer, client)
  const detail = errorDetail(error, answer.json?.error_description)
  return CLIENT_ERRORS.has(error)
    ? clientError(client.clientId, detail)
    : grantError(grant, error, detail, client)
}

async function tokenRequest(
  grant: Grant,
  form: URLSearchParams,
  client: TokenClient,
  deps: OAuthDeps,
) {
  const answer = await postForm(client.endpoint, form, client, deps)
  if (answer.status !== 200) throw tokenError(answer, grant, client)
  return parseTokenResponse(answer.json)
}

/** Exchanges the authorization code (with the PKCE verifier and the redirect URI as sent). */
export function exchangeCode(
  client: TokenClient,
  code: { readonly code: string; readonly redirectUri: string; readonly verifier: string },
  deps: OAuthDeps,
): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.code,
    redirect_uri: code.redirectUri,
    code_verifier: code.verifier,
  })
  return tokenRequest("exchange", form, client, deps)
}

/** Refreshes the tokens; no `scope`, so the original grant is kept. */
export function refreshTokens(client: TokenClient, refreshToken: string, deps: OAuthDeps) {
  const form = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken })
  return tokenRequest("refresh", form, client, deps)
}

/**
 * Revokes a token (RFC 7009; 200 means done, also for an already invalid token). Resolves to
 * undefined on success, else to the reason; never rejects.
 */
export async function revokeToken(
  client: TokenClient,
  token: { readonly value: string; readonly hint: "refresh_token" | "access_token" },
  deps: OAuthDeps,
): Promise<string | undefined> {
  const form = new URLSearchParams({ token: token.value, token_type_hint: token.hint })
  try {
    const answer = await postForm(client.endpoint, form, client, deps)
    if (answer.status === 200) return undefined
    const error = answer.json?.error
    return typeof error === "string"
      ? `${statusLine(answer)} ${errorDetail(error, answer.json?.error_description)}`
      : statusLine(answer)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
