/**
 * The authorization request and the validation of its callback. The state is
 * checked first and in constant time: a callback without the right state is not processed at all
 * (and does not end the login). After that the `iss` parameter (RFC 9207 mix-up defense), an
 * `error` and the code decide. Repeated parameters count as invalid (RFC 6749 §3.1).
 */

import { configError } from "../../config/config-error.js"
import type { OAuthConfig } from "../../config/types.js"
import type { OperateError } from "../../errors.js"
import { loginCommand, loginFailed } from "./errors.js"
import { sanitize } from "./http.js"
import type { PkceRequest } from "./pkce.js"
import type { ServerMetadata } from "./types.js"

const encoder = new TextEncoder()

/** RFC 6749 error codes: printable ASCII without `"` and `\`. */
const ERROR_CODE = /^[\x20\x21\x23-\x5b\x5d-\x7e]+$/

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
  pkce: Pick<PkceRequest, "challenge" | "state">,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirectUri,
  })
  if (config.scopes.length > 0) params.set("scope", config.scopes.join(" "))
  params.set("state", pkce.state)
  params.set("code_challenge", pkce.challenge)
  params.set("code_challenge_method", "S256")
  if (config.audience !== undefined) params.set("audience", config.audience)
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${params.toString()}`
}

/**
 * Compares in constant time for equal lengths (an XOR accumulation over the UTF-8 bytes): wrong
 * states do not end the login, so a local prober gets many attempts.
 */
export function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

/** True when the query has exactly one `state` equal to the expected one. */
export function hasState(query: URLSearchParams, expected: string): boolean {
  const states = query.getAll("state")
  return states.length === 1 && safeEqual(states[0] ?? "", expected)
}

/** A callback with the right state that cannot complete the login, with the page's reason. */
export interface CallbackFailure {
  readonly error: OperateError
  readonly reason: string
}

function issFailure(): CallbackFailure {
  return {
    error: loginFailed(
      "The login response came from another issuer (possible mix-up attack)",
      "The authorization response named another issuer than the one pulse-cli logged in with (RFC 9207). Check the issuer of the profile, close other login tabs and run the login again.",
    ),
    reason: "The login response came from another issuer.",
  }
}

/** The `iss` check: when present it must be the expected issuer; required when advertised. */
function checkIss(query: URLSearchParams, metadata: ServerMetadata): CallbackFailure | undefined {
  const values = query.getAll("iss")
  if (values.length > 1) return issFailure()
  const [iss] = values
  if (iss === undefined) return metadata.issParameterRequired ? issFailure() : undefined
  return metadata.issuer !== null && iss !== metadata.issuer ? issFailure() : undefined
}

/** `error: description` of a callback error, sanitized. */
function detail(error: string, description: string | null): string {
  return description === null || description === ""
    ? sanitize(error)
    : `${sanitize(error)}: ${sanitize(description)}`
}

function callbackError(
  error: string,
  query: URLSearchParams,
  config: OAuthConfig,
): CallbackFailure {
  const code = ERROR_CODE.test(error) ? error : "invalid_error_code"
  const text = detail(code, query.get("error_description"))
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
 * The authorization code of a callback with the right state, or why it cannot complete the
 * login: `iss` mismatch, an `error` parameter, no (or a repeated) code.
 */
export function callbackCode(
  query: URLSearchParams,
  metadata: ServerMetadata,
  config: OAuthConfig,
): { readonly code: string } | CallbackFailure {
  const iss = checkIss(query, metadata)
  if (iss !== undefined) return iss
  const errors = query.getAll("error")
  if (errors.length === 1) return callbackError(errors[0] ?? "", query, config)
  const codes = query.getAll("code")
  const [code] = codes
  return errors.length === 0 && codes.length === 1 && code !== undefined && code !== ""
    ? { code }
    : NO_CODE
}
