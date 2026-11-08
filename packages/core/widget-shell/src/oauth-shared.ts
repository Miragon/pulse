/** What the OAuth files share: the claim helpers and the URL rules for issuers and resources. */
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server"

export type Claims = Record<string, unknown>

export const invalidToken = (message: string, cause?: unknown): OAuthError => {
  const error = new OAuthError(OAuthErrorCode.InvalidToken, message)
  if (cause !== undefined) (error as { cause?: unknown }).cause = cause
  return error
}

export const isRecord = (value: unknown): value is Claims =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export function isLocalhost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase()
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  )
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
