/**
 * Validation of bearer tokens obtained outside pulse: the token itself (a pasted `Bearer ` prefix
 * is dropped, the rest must be an RFC 6750 b64token). A profile's bearer keys are the profile
 * format's to check, the name of the variable that holds the token variable.ts's. Messages name
 * where a value came from and never repeat a token.
 */

import { isRecord } from "../util.js"
import { configError } from "./config-error.js"
import { CONTROL } from "./syntax.js"
import { BEARER_AUTH_KEYS, type ProfileAuth } from "./types.js"

/** RFC 6750 §2.1 b64token: the only syntax a Bearer credential may have. */
const B64TOKEN = /^[A-Za-z0-9\-._~+/]+=*$/
/** A pasted header value: `Bearer <token>` (any case), or the bare word. */
const BEARER_PREFIX = /^bearer(?:\s+|$)/i

const TOKEN_HINT =
  'A bearer token consists of letters, digits and - . _ ~ + / (optionally ending with =), e.g. a JWT. Pass the token alone (a leading "Bearer " is fine), not a whole header line, a JSON answer or several lines.'

/**
 * The token as sent: surrounding blanks and a leading `Bearer ` (case-insensitive) removed. A
 * token that is empty or not a b64token is a CONFIG error naming `origin` (`PULSE_CLI_TOKEN`),
 * never the token.
 */
export function normalizeToken(raw: string, origin: string): string {
  const token = raw.trim().replace(BEARER_PREFIX, "").trim()
  if (token === "") {
    throw configError(
      `The bearer token from ${origin} is empty`,
      "Set the token itself, e.g. export PULSE_CLI_TOKEN=<token> or pipe it into --auth-token-stdin.",
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

/** True when the stored auth object has a bearer token setting. */
export function hasBearerKeys(auth: ProfileAuth | undefined): boolean {
  return isRecord(auth) && BEARER_AUTH_KEYS.some((key) => Object.hasOwn(auth, key))
}
