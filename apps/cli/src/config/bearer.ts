/**
 * Validation of bearer tokens obtained outside operate: the token itself (a pasted
 * `Bearer ` prefix is dropped, the rest must be an RFC 6750 b64token) and the bearer rules for a
 * profile's auth object in the config file (the name of the variable that holds the token is
 * checked by variable.ts). Messages name where a value came from and never repeat a token.
 */

import { isRecord } from "../util.js"
import { configError } from "./config-error.js"
import { CONTROL, ENV_NAME, isNonEmptyString } from "./syntax.js"
import {
  AUTH_TYPES,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  OAUTH_AUTH_KEYS,
  type ProfileAuth,
} from "./types.js"

/** RFC 6750 §2.1 b64token: the only syntax a Bearer credential may have. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/
/** A pasted header value: `Bearer <token>` (any case), or the bare word. */
const BEARER_PREFIX = /^bearer(?:\s+|$)/i

const TOKEN_HINT =
  'A bearer token consists of letters, digits and - . _ ~ + / (optionally ending with =), e.g. a JWT. Pass the token alone (a leading "Bearer " is fine), not a whole header line, a JSON answer or several lines.'

/**
 * The token as sent: surrounding blanks and a leading `Bearer ` (case-insensitive) removed. A
 * token that is empty or not a b64token is a CONFIG error naming `origin` (`OPERATE_TOKEN`),
 * never the token.
 */
export function normalizeToken(raw: string, origin: string): string {
  const token = raw.trim().replace(BEARER_PREFIX, "").trim()
  if (token === "") {
    throw configError(
      `The bearer token from ${origin} is empty`,
      "Set the token itself, e.g. export OPERATE_TOKEN=<token> or pipe it into --auth-token-stdin.",
    )
  }
  if (!B64TOKEN.test(token)) {
    const what = CONTROL.test(token)
      ? "contains line breaks or control characters"
      : "has characters a bearer token cannot have"
    throw configError(`The bearer token from ${origin} ${what} (RFC 6750)`, TOKEN_HINT)
  }
  return token
}

type Check = readonly [check: (value: unknown) => boolean, expected: string]

/** Shape checks of the bearer keys in the config file (the token syntax is checked on use). */
export const BEARER_CHECKS: Readonly<Record<(typeof BEARER_AUTH_KEYS)[number], Check>> = {
  tokenEnv: [
    (value) => typeof value === "string" && ENV_NAME.test(value),
    "the name of an environment variable, e.g. CI_ENGINE_TOKEN",
  ],
  token: [isNonEmptyString, "a non-empty string"],
}

function keysOf(value: Record<string, unknown>, keys: readonly string[]): string[] {
  return keys.filter((key) => Object.hasOwn(value, key))
}

/** Bearer keys next to Basic auth or OAuth keys: one profile uses one kind of credentials. */
export function bearerMixProblem(name: string, value: Record<string, unknown>) {
  const bearer = keysOf(value, BEARER_AUTH_KEYS)
  if (bearer.length === 0) return undefined
  const basic = keysOf(value, BASIC_AUTH_KEYS)
  const [family, others] =
    basic.length > 0 ? ["Basic auth", basic] : ["OAuth", keysOf(value, OAUTH_AUTH_KEYS)]
  return others.length === 0
    ? undefined
    : `profile "${name}" mixes bearer token keys (${bearer.join(", ")}) and ${family} keys (${others.join(", ")}); keep one`
}

/**
 * The bearer rules for the auth object of profile `name` (after the shape checks and the mix
 * check): bearer keys need type bearer or none (a stored token never implies a type), and one
 * token source. Never quotes values.
 */
export function bearerProfileProblem(name: string, value: Record<string, unknown>) {
  const bearer = keysOf(value, BEARER_AUTH_KEYS)
  const { type } = value
  const known = (AUTH_TYPES as readonly unknown[]).includes(type)
  // unknown types are reported by resolution, which names the supported ones
  if (bearer.length > 0 && type !== "bearer" && type !== "none" && (known || type === undefined)) {
    const actual = type === undefined ? "is not set" : `is ${type as string}`
    return `profile "${name}" has bearer token keys (${bearer.join(", ")}) but its auth.type ${actual}; set "type": "bearer"`
  }
  return bearer.length > 1
    ? `profile "${name}" sets both auth.token and auth.tokenEnv; keep one (tokenEnv is recommended)`
    : undefined
}

/** True when the stored auth object has a bearer token setting. */
export function hasBearerKeys(auth: ProfileAuth | undefined): boolean {
  return isRecord(auth) && BEARER_AUTH_KEYS.some((key) => Object.hasOwn(auth, key))
}
