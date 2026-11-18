/** What the OAuth files share: the claim helpers and the URL rules for issuers and resources. */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"

export type Claims = Record<string, unknown>

export const invalidToken = (message: string, cause?: unknown): OAuthError => {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message)
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause
  return error
}

/**
 * The refusals of a token bound to another resource (RFC 8707): an `aud` or `resource` that does
 * not name this server, or none at all. The web sign-in tells them from the token's other
 * failures, since a missing audience mapper at the identity provider is their usual cause.
 */
const audienceRefusals = new WeakSet<object>()

/** An `invalid_token` refusal of a token bound to another resource, or to none. */
export const audienceRefusal = (message: string): OAuthError => {
  const error = invalidToken(message)
  audienceRefusals.add(error)
  return error
}

/** Whether `error` is a refusal {@link audienceRefusal} made. */
export const isAudienceRefusal = (error: unknown): boolean =>
  typeof error === "object" && error !== null && audienceRefusals.has(error)

export const isRecord = (value: unknown): value is Claims =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** A host name of the machine itself, as a URL's `hostname` spells it (`[::1]` in brackets). */
export function isLocalHostname(host: string): boolean {
  const hostname = host.toLowerCase()
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
}

export function isLocalhost(url: URL): boolean {
  return isLocalHostname(url.hostname)
}

export function isAllowedHttpUrl(url: URL): boolean {
  return (
    /^https?:$/.test(url.protocol) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.protocol !== "http:" || isLocalhost(url))
  )
}

export const trimPath = (url: URL): URL => {
  url.pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "")
  return url
}

export const normalizedStrings = (value: unknown): string[] => {
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean)
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []
}

export const nonBlank = (claims: Claims, name: string): string | undefined => {
  const value = claims[name]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

/** The claim that names the caller unless a provider names others: the subject. */
export const DEFAULT_CALLER_CLAIMS: readonly string[] = ["sub"]

/** The caller claim a token holds: the first of `names` it carries, whatever its value. */
export const callerClaimOf = (claims: Claims, names: readonly string[]): string | undefined =>
  names.find((name) => Object.hasOwn(claims, name))

/** The caller the claims name by the provider's rule: its caller claim's value, when not blank. */
export function callerOf(claims: Claims, names: readonly string[]): string | undefined {
  const claim = callerClaimOf(claims, names)
  return claim === undefined ? undefined : nonBlank(claims, claim)
}
