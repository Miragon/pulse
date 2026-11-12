/**
 * The authorization request and its callback, both built and checked by
 * @miragon/pulse-http/oauth (the state first and in constant time, then `iss` as the RFC 9207
 * mix-up defense, an `error`, the code; a repeated parameter is invalid) and worded here. A
 * callback without the right state is not processed at all (and does not end the login).
 */

import { authorizationUrl as urlOf, callbackResult, type Pkce } from "@miragon/pulse-http/oauth"
import { configError } from "../../config/config-error.js"
import type { OAuthConfig } from "../../config/types.js"
import type { PulseCliError } from "../../errors.js"
import { loginCommand, loginFailed } from "./errors.js"
import { sanitize } from "./http.js"
import type { ServerMetadata } from "./types.js"

/** Errors that mean the request or the client registration is wrong: CONFIG. */
const REQUEST_ERRORS: ReadonlySet<string> = new Set([
  "invalid_request",
  "unauthorized_client",
  "unsupported_response_type",
  "invalid_scope",
])

/**
 * The authorization URL: the endpoint with its own query kept, plus the code flow parameters with
 * PKCE S256, the state, the scopes (omitted when none) and the audience (when set).
 */
export function authorizationUrl(
  endpoint: string,
  config: Pick<OAuthConfig, "clientId" | "scopes" | "audience">,
  pkce: Pick<Pkce, "challenge" | "state">,
  redirectUri: string,
): string {
  return urlOf(endpoint, {
    clientId: config.clientId,
    redirectUri,
    scopes: config.scopes,
    ...(config.audience === undefined ? {} : { audience: config.audience }),
    challenge: pkce.challenge,
    state: pkce.state,
  })
}

/** A callback with the right state that cannot complete the login, with the page's reason. */
export interface CallbackFailure {
  readonly error: PulseCliError
  readonly reason: string
}

const ISS_FAILURE: CallbackFailure = {
  error: loginFailed(
    "The login response came from another issuer (possible mix-up attack)",
    "The authorization response named another issuer than the one pulse logged in with (RFC 9207). Check the issuer of the profile, close other login tabs and run the login again.",
  ),
  reason: "The login response came from another issuer.",
}

/** `error: description` of a callback error, sanitized. */
function detail(error: string, description: string | undefined): string {
  return description === undefined || description === ""
    ? sanitize(error)
    : `${sanitize(error)}: ${sanitize(description)}`
}

function callbackError(
  code: string,
  description: string | undefined,
  config: OAuthConfig,
): CallbackFailure {
  const text = detail(code, description)
  const reason = `The authorization server reported ${code}.`
  if (code === "access_denied") {
    return {
      error: loginFailed(
        `The login was denied (${text})`,
        `The user cancelled the login or may not use client ${config.clientId}; run \`${loginCommand(config)}\` again.`,
      ),
      reason,
    }
  }
  if (REQUEST_ERRORS.has(code)) {
    return {
      error: configError(
        `The authorization server refused the login request (${text})`,
        `Check the client id (${config.clientId}), the redirect URI registration (http://127.0.0.1/callback), PKCE S256 for the client and the scopes.`,
      ),
      reason,
    }
  }
  return {
    error: loginFailed(`The login failed (${text})`, `Run \`${loginCommand(config)}\` again.`),
    reason,
  }
}

const NO_CODE: CallbackFailure = {
  error: loginFailed(
    "The login callback carried no authorization code",
    "Run the login again; the authorization server sent an incomplete callback.",
  ),
  reason: "The login callback carried no authorization code.",
}

/**
 * The authorization code of a callback; why it cannot complete the login (`iss` mismatch, an
 * `error` parameter, no or a repeated code); or undefined when it is not this login's callback (no
 * state, another, a repeated one), which is ignored.
 */
export function callbackCode(
  query: URLSearchParams,
  metadata: ServerMetadata,
  state: string,
  config: OAuthConfig,
): { readonly code: string } | CallbackFailure | undefined {
  const result = callbackResult(query, {
    state,
    ...(metadata.issuer === null ? {} : { issuer: metadata.issuer }),
    issRequired: metadata.issParameterRequired,
  })
  if ("code" in result) return result
  switch (result.problem) {
    case "state":
      return undefined
    case "iss":
      return ISS_FAILURE
    case "error":
      return callbackError(result.error, result.description, config)
    case "no-code":
      return NO_CODE
  }
}
