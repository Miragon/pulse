/**
 * Reading the claims of a JWT (RFC 7519) without checking its signature: bearer tokens are often
 * JWTs, and their expiry, subject, issuer and audience help explain a refused or expired token.
 * Nothing here decides whether a token is trusted; the engine or its gateway does that. Opaque
 * tokens give no claims.
 */

/** Longest claim value kept. */
const MAX_CLAIM = 200

/** Largest epoch ms a Date can represent. */
const MAX_DATE_MS = 8.64e15

/** A base64url segment of a compact JWS (no padding). */
const SEGMENT = /^[A-Za-z0-9_-]+$/

export interface JwtClaims {
  /** `exp` in epoch ms, null without a usable `exp`. */
  readonly expiresAt: number | null
  readonly subject: string | null
  /** `preferred_username`. */
  readonly user: string | null
  readonly issuer: string | null
  /** `aud` as a list (a single string becomes one entry). */
  readonly audience: readonly string[]
}

/** base64url (padded or not) as UTF-8 text; throws on anything else. */
export function decodeBase64Url(segment: string): string {
  // atob decodes forgivingly (WHATWG): no padding needed.
  const binary = atob(segment.replaceAll("-", "+").replaceAll("_", "/"))
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  )
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A JSON object encoded in a base64url segment, else undefined. */
function jsonSegment(segment: string): Readonly<Record<string, unknown>> | undefined {
  if (!SEGMENT.test(segment)) return undefined
  let value: unknown
  try {
    value = JSON.parse(decodeBase64Url(segment))
  } catch {
    // Not base64url, not UTF-8 or no JSON: no claims.
  }
  return isRecord(value) ? value : undefined
}

/** A claim for display: a string without control characters, cut after 200 characters. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const clean = value.replace(/\p{Cc}/gu, "")
  if (clean === "") return null
  return clean.length > MAX_CLAIM ? `${clean.slice(0, MAX_CLAIM)}…` : clean
}

function expiryOf(exp: unknown): number | null {
  if (typeof exp !== "number") return null
  // Infinity and NaN fail the range check too.
  const ms = exp * 1000
  return Math.abs(ms) <= MAX_DATE_MS ? ms : null
}

function audienceOf(aud: unknown): string[] {
  const values: unknown[] = Array.isArray(aud) ? aud : [aud]
  return values.flatMap((value) => {
    const shown = text(value)
    return shown === null ? [] : [shown]
  })
}

/**
 * The claims of a JWT: three dot-separated parts whose first two are base64url encoded JSON
 * objects (header and payload). Undefined for anything else (an opaque token, a JWE).
 */
export function jwtClaims(token: string): JwtClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  const [header, payload] = parts as [string, string, string]
  const claims = jsonSegment(payload)
  if (jsonSegment(header) === undefined || claims === undefined) return undefined
  return {
    expiresAt: expiryOf(claims.exp),
    subject: text(claims.sub),
    user: text(claims.preferred_username),
    issuer: text(claims.iss),
    audience: audienceOf(claims.aud),
  }
}
