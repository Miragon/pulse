/**
 * Validation of the OAuth settings: issuer and endpoint URLs, client id and secret, scopes,
 * audience, redirect port. A profile's OAuth keys are the profile format's to check
 * (@miragon/pulse-profile), their URLs and values these validators' when a command uses them.
 * Messages name where a value came from (`label`) and never repeat a secret.
 */

import { isLoopbackHost, isRedirectPort } from "@miragon/pulse-profile"
import type { PulseCliError } from "../errors.js"
import { isRecord } from "../util.js"
import { configError } from "./config-error.js"
import { redactUrl } from "./redact.js"
import { CONTROL } from "./syntax.js"
import { OAUTH_AUTH_KEYS, type ProfileAuth } from "./types.js"

/** RFC 6749 VSCHAR: printable ASCII (client id, audience). */
const VSCHAR = /^[\x20-\x7e]+$/
/** RFC 6749 §3.3 scope-token: printable ASCII except space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/
const PORT = /^\d+$/

/** The profile format's one rule of a loopback host, for the endpoints a discovery names too. */
export { isLoopbackHost }

export const ISSUER_EXAMPLE = "https://login.example.com/realms/camunda"

/** What an OAuth URL is, for messages. */
export type OAuthUrlKind = "issuer" | "authorization endpoint" | "token endpoint"

/**
 * The `host:port` of an engine URL that would carry a Bearer token over plain http beyond the
 * loopback interface (RFC 6750 §5.3 requires TLS), else undefined.
 */
export function plainHttpHost(url: string): string | undefined {
  if (!URL.canParse(url)) return undefined
  const parsed = new URL(url)
  return parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname) ? parsed.host : undefined
}

/**
 * Why an OAuth URL cannot be used: @miragon/pulse-http/oauth's `OAuthUrlProblem`, by which a
 * discovery checks the endpoints it finds, and the query of an issuer (RFC 8414 §2).
 * src/auth/oauth/discovery.test.ts holds the two rules equal.
 */
export type OAuthUrlProblem = "not-a-url" | "credentials" | "insecure" | "fragment" | "query"

const PROBLEM_TEXT: Readonly<Record<Exclude<OAuthUrlProblem, "not-a-url">, string>> = {
  credentials: "must not contain credentials",
  insecure: "must use https:// (http:// only for localhost, 127.0.0.1 or [::1])",
  fragment: "must not contain a fragment",
  query: "must not contain a query",
}

/** https, or http on a loopback host. */
function isSecure({ protocol, hostname }: URL): boolean {
  return protocol === "https:" || (protocol === "http:" && isLoopbackHost(hostname))
}

/** Why a trimmed OAuth URL is not acceptable, or undefined. */
function urlProblem(url: string, kind: OAuthUrlKind): OAuthUrlProblem | undefined {
  if (!URL.canParse(url)) return "not-a-url"
  const parsed = new URL(url)
  if (parsed.username !== "" || parsed.password !== "") return "credentials"
  if (!isSecure(parsed)) return "insecure"
  if (parsed.hash !== "" || parsed.href.endsWith("#")) return "fragment"
  return kind === "issuer" && parsed.search !== "" ? "query" : undefined
}

/** The CONFIG error of a trimmed OAuth URL refused for `problem`; it never shows a password. */
export function oauthUrlError(
  url: string,
  kind: OAuthUrlKind,
  label: string,
  problem: OAuthUrlProblem,
): PulseCliError {
  if (problem === "not-a-url") {
    return configError(
      `Invalid OAuth ${kind} "${redactUrl(url)}" (${label})`,
      `Use an absolute URL, e.g. ${ISSUER_EXAMPLE} for the issuer.`,
    )
  }
  return configError(
    `The OAuth ${kind} (${label}) ${PROBLEM_TEXT[problem]}, got "${redactUrl(url)}"`,
    `Example issuer: ${ISSUER_EXAMPLE}. Local test identity providers may use http://localhost.`,
  )
}

/**
 * Checks an issuer or endpoint URL: absolute, https (http only for a loopback host), no user
 * info, no fragment, the issuer also no query (RFC 8414 §2). Returns it trimmed, otherwise exactly
 * as given: the issuer is compared character by character (Auth0 issuers end with "/").
 */
export function validateOAuthUrl(url: string, kind: OAuthUrlKind, label: string): string {
  const trimmed = url.trim()
  const problem = urlProblem(trimmed, kind)
  if (problem === undefined) return trimmed
  throw oauthUrlError(trimmed, kind, label, problem)
}

/** Checks a client id (RFC 6749 VSCHAR, not blank) and trims it. */
export function validateClientId(clientId: string, label: string): string {
  const trimmed = clientId.trim()
  if (trimmed === "" || !VSCHAR.test(trimmed)) {
    throw configError(
      `The OAuth client id (${label}) must be printable ASCII and not empty`,
      "Use the client id registered at the authorization server, e.g. pulse-cli.",
    )
  }
  return trimmed
}

/** Checks a client secret without repeating it: no control characters. Never trimmed. */
export function validateClientSecret(secret: string, label: string): string {
  if (CONTROL.test(secret)) {
    throw configError(
      `The OAuth client secret (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      "Copy the secret again from the authorization server; it is a single line.",
    )
  }
  return secret
}

/** Splits a scope list given as text: separated by spaces and/or commas. */
export function parseScopes(text: string): string[] {
  return text.split(/[\s,]+/).filter((scope) => scope !== "")
}

/** Checks scopes: RFC 6749 scope-tokens without duplicates. */
export function validateScopes(scopes: readonly string[], label: string): string[] {
  const invalid = scopes.find((scope) => !SCOPE_TOKEN.test(scope))
  if (invalid !== undefined) {
    throw configError(
      `Invalid OAuth scope "${invalid}" (${label})`,
      'Scopes are printable ASCII without spaces, quotes or backslashes, e.g. "openid offline_access".',
    )
  }
  const duplicate = scopes.find((scope, index) => scopes.indexOf(scope) !== index)
  if (duplicate !== undefined) {
    throw configError(`The OAuth scope "${duplicate}" is listed twice (${label})`)
  }
  return [...scopes]
}

/** Checks an audience (RFC 6749 VSCHAR, not blank) and trims it. */
export function validateAudience(audience: string, label: string): string {
  const trimmed = audience.trim()
  if (trimmed === "" || !VSCHAR.test(trimmed)) {
    throw configError(
      `The OAuth audience (${label}) must be printable ASCII and not empty`,
      "Example: engine-rest. Without an audience (the authorization server sets it itself, e.g. a Keycloak audience mapper) remove it: `pulse config unset <profile> audience`, or unset PULSE_CLI_OAUTH_AUDIENCE.",
    )
  }
  return trimmed
}

/** True for a port of the login callback: 0 (any free port) to 65535. */
function isPort(value: unknown): value is number {
  return isRedirectPort(value)
}

/** Parses the port of the login callback; 0 means any free port. */
export function parseRedirectPort(value: string | number, label: string): number {
  const port = typeof value === "string" && PORT.test(value.trim()) ? Number(value) : value
  if (!isPort(port)) {
    throw configError(
      `The OAuth redirect port (${label}) must be a whole number between 0 and 65535, got "${value}"`,
      "Use 0 (any free port) unless the authorization server only accepts a fixed registered port.",
    )
  }
  return port
}

/** True when the stored auth object has OAuth settings. */
export function hasOAuthKeys(auth: ProfileAuth | undefined): boolean {
  return isRecord(auth) && OAUTH_AUTH_KEYS.some((key) => Object.hasOwn(auth, key))
}
