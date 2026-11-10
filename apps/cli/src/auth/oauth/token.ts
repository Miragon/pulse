/**
 * Token endpoint requests: code exchange, refresh and revocation (RFC 7009), sent and read by
 * @miragon/pulse-http/oauth and worded here. Messages show the sanitized `error` and
 * `error_description` of the answer, never other parts of a body.
 */

import {
  decodeBase64Url,
  type Grant,
  requestToken,
  revokeToken as revoke,
  type TokenEndpoint,
  type TokenFailure,
  type TokenRecord,
} from "@miragon/pulse-http/oauth"
import { configError } from "../../config/config-error.js"
import { PulseCliError } from "../../errors.js"
import { isRecord } from "../../util.js"
import {
  loginCommand,
  loginFailed,
  type LoginOwner,
  loginRequired,
  owner,
  REFRESH_REJECTED,
} from "./errors.js"
import {
  type Endpoint,
  isUnanswered,
  limitsOf,
  platformOf,
  sanitize,
  shownUrl,
  statusLine,
  statusOfFailure,
  unreachable,
} from "./http.js"
import type { ClientAuthMethod, OAuthDeps, TokenResponse } from "./types.js"

/** How the client authenticates: public (client id in the form) or with a secret. */
interface ClientCredentials {
  readonly clientId: string
  readonly clientSecret?: string | undefined
  readonly method: ClientAuthMethod
}

/** A token request: endpoint, client authentication and whose login it is. */
export interface TokenClient extends ClientCredentials {
  readonly endpoint: Endpoint
  readonly who: LoginOwner
}

/** The kinds of a refusal of the client registration: CONFIG, a new login would not help. */
const CLIENT_KINDS: ReadonlySet<string> = new Set(["client", "scope"])

type GrantKind = "exchange" | "refresh"

/** The client as @miragon/pulse-http/oauth sends it: public without a secret. */
function endpointOf(client: TokenClient): TokenEndpoint {
  const { clientId, clientSecret, method } = client
  const clientAuth = method === "client_secret_post" ? "post" : "basic"
  return clientSecret === undefined
    ? { url: client.endpoint.url, clientId, clientAuth: "none" }
    : { url: client.endpoint.url, clientId, clientSecret, clientAuth }
}

function unusable(hint: string): PulseCliError {
  return configError("The authorization server answered without a usable access token", hint)
}

function displayClaim(claims: Record<string, unknown>, key: string): string | null {
  const value = claims[key]
  return typeof value === "string" && value !== "" ? sanitize(value) : null
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

/** A token answer as the CLI keeps it: the record and the display values of its ID token. */
function responseOf(record: TokenRecord): TokenResponse {
  return {
    accessToken: record.accessToken,
    receivedAt: record.receivedAt,
    expiresAt: record.expiresAt ?? null,
    refreshToken: record.refreshToken ?? null,
    refreshExpiresAt: record.refreshExpiresAt ?? null,
    scope: record.scope ?? null,
    ...(record.idToken === undefined
      ? { subject: null, user: null }
      : idTokenClaims(record.idToken)),
  }
}

/** A 200 answer without a usable token (RFC 6749 §5.1). */
function answerError(failure: TokenFailure): PulseCliError {
  if (failure.problem === "not-json") {
    return unusable("The token endpoint did not answer with a JSON object.")
  }
  if (failure.problem !== "token-type") {
    return unusable("The token response has no access_token in the Bearer token syntax (RFC 6750).")
  }
  const { tokenType } = failure
  return configError(
    `Unsupported token type "${sanitize(typeof tokenType === "string" ? tokenType : JSON.stringify(tokenType))}"; pulse sends Bearer tokens only`,
    "Configure the client at the authorization server for Bearer tokens (no DPoP or mTLS binding).",
  )
}

/** `(error: description)` of a token error answer, sanitized. */
function errorDetail(error: string, description: string | undefined): string {
  const detail = description === undefined || description === "" ? "" : `: ${sanitize(description)}`
  return `(${sanitize(error)}${detail})`
}

function clientError(clientId: string, detail: string): PulseCliError {
  return configError(
    `The authorization server rejected client ${clientId} ${detail}`,
    `Check the client id, the client secret source (auth.clientSecretEnv, PULSE_CLI_OAUTH_CLIENT_SECRET) and that the client is public or confidential as configured and allows the authorization code flow and refresh tokens. Keycloak answers unauthorized_client "Invalid client or Invalid client credentials" for a wrong or missing client secret.`,
  )
}

/** The `error: description` of refresh errors that need a new login, by error object. */
const rejections = new WeakMap<PulseCliError, string>()

/**
 * `invalid_grant: <description>` (or another error code) when `error` is the LOGIN_REQUIRED of
 * a refresh the authorization server refused; undefined for every other error.
 */
export function refreshRejection(error: unknown): string | undefined {
  return error instanceof PulseCliError ? rejections.get(error) : undefined
}

function refreshError(error: string, detail: string, who: LoginOwner): PulseCliError {
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
  grant: GrantKind,
  error: string,
  detail: string,
  client: TokenClient,
): PulseCliError {
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

function serverError(failure: TokenFailure, grant: GrantKind, client: TokenClient) {
  return new PulseCliError(
    "HTTP_SERVER_ERROR",
    `The authorization server failed: ${statusLine(statusOfFailure(failure))}`,
    {
      status: Number(failure.status),
      request: { method: "POST", url: shownUrl(client.endpoint.url) },
      hint: grant === "refresh" ? "Retry later; the login is kept." : "Retry later.",
    },
  )
}

/** The `error` of a 400/401 refusal (RFC 6749 §5.2), if it has one. */
function errorCodeOf(failure: TokenFailure): string | undefined {
  const { error } = failure
  const coded = failure.kind === "client" || failure.kind === "scope" || failure.kind === "grant"
  return coded && error !== undefined && error !== "" ? error : undefined
}

function unexpected(failure: TokenFailure, client: TokenClient): PulseCliError {
  const redirect = failure.kind === "redirect" ? " (pulse follows no redirects)" : ""
  return configError(
    `Unexpected answer from ${shownUrl(client.endpoint.url)}: ${statusLine(statusOfFailure(failure))}${redirect}`,
    `Check the token endpoint (${client.endpoint.source}).`,
  )
}

/** The error of a failed token request, as the CLI words it. */
function tokenError(
  failure: TokenFailure,
  grant: GrantKind,
  client: TokenClient,
  timeoutMs: number,
): PulseCliError {
  if (isUnanswered(failure)) return unreachable(failure, "POST", client.endpoint, timeoutMs)
  if (failure.problem !== undefined) return answerError(failure)
  if (Number(failure.status) >= 500) return serverError(failure, grant, client)
  const error = errorCodeOf(failure)
  if (error === undefined) return unexpected(failure, client)
  const detail = errorDetail(error, failure.description)
  return CLIENT_KINDS.has(failure.kind)
    ? clientError(client.clientId, detail)
    : grantError(grant, error, detail, client)
}

async function tokenRequest(grant: Grant, client: TokenClient, deps: OAuthDeps) {
  try {
    return responseOf(
      await requestToken(endpointOf(client), grant, platformOf(deps), limitsOf(deps)),
    )
  } catch (error) {
    const kind = grant.type === "refresh_token" ? "refresh" : "exchange"
    // requestToken fails with a TokenFailure only, for the URLs the CLI checks at login.
    throw tokenError(error as TokenFailure, kind, client, deps.timeoutMs)
  }
}

/** Exchanges the authorization code (with the PKCE verifier and the redirect URI as sent). */
export function exchangeCode(
  client: TokenClient,
  code: { readonly code: string; readonly redirectUri: string; readonly verifier: string },
  deps: OAuthDeps,
): Promise<TokenResponse> {
  return tokenRequest({ type: "authorization_code", ...code }, client, deps)
}

/** Refreshes the tokens; no `scope`, so the original grant is kept. */
export function refreshTokens(client: TokenClient, refreshToken: string, deps: OAuthDeps) {
  return tokenRequest({ type: "refresh_token", refreshToken }, client, deps)
}

/** Why a revocation failed, as a warning shows it. */
function revocationReason(failure: TokenFailure, client: TokenClient, timeoutMs: number) {
  if (isUnanswered(failure)) return unreachable(failure, "POST", client.endpoint, timeoutMs).message
  const status = statusLine(statusOfFailure(failure))
  return failure.error === undefined
    ? status
    : `${status} ${errorDetail(failure.error, failure.description)}`
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
  try {
    await revoke(endpointOf(client), token, platformOf(deps), limitsOf(deps))
    return undefined
  } catch (error) {
    // revoke fails with a TokenFailure only, for the URLs the CLI checks at login.
    return revocationReason(error as TokenFailure, client, deps.timeoutMs)
  }
}
