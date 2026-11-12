/**
 * Validation of the auth settings given on the command line or in the environment: the auth
 * type, Basic auth usernames and passwords (RFC 7617: no control characters, no ":" in the
 * username). The auth object of a profile is the profile format's to check
 * (@miragon/pulse-profile); the names of the variables that hold secrets live in variable.ts.
 * Messages never repeat a username, password or token.
 */

import { configError } from "./config-error.js"
import { CONTROL } from "./syntax.js"
import { AUTH_TYPES, type AuthType } from "./types.js"

const CONTROL_HINT =
  "Remove line breaks, tabs, NUL and other control characters; Basic auth (RFC 7617) does not allow them."

/** A value that may be quoted as a mistyped auth type; anything else may be a credential. */
const TYPE_LIKE = /^[A-Za-z-]{0,20}$/

/**
 * The auth type. An unsupported value is quoted only when it looks like a type name: since
 * `bearer` is a type, `--auth "Bearer <token>"` or `PULSE_CLI_AUTH=<token>` are likely mistakes.
 */
export function validateAuthType(type: string): AuthType {
  const known = AUTH_TYPES.find((candidate) => candidate === type)
  if (known !== undefined) return known
  const supported = `Supported: ${AUTH_TYPES.join(", ")}.`
  if (TYPE_LIKE.test(type)) throw configError(`Unsupported auth type "${type}"`, supported)
  throw configError(
    `Unsupported auth type (not one of ${AUTH_TYPES.join(", ")})`,
    "The auth type (--auth, PULSE_CLI_AUTH, auth.type) is only the word, so the value is not repeated: it may be a credential. A bearer token itself goes into PULSE_CLI_TOKEN or --auth-token-stdin, e.g. --auth bearer with PULSE_CLI_TOKEN=<token>.",
  )
}

/** Checks a Basic auth username; `label` says where it came from (`from --auth-user`). */
export function validateUsername(username: string, label: string): string {
  if (username.trim() === "") {
    throw configError(`The username (${label}) must not be empty`, "Example: --auth-user demo")
  }
  if (username.includes(":")) {
    throw configError(
      `The username (${label}) must not contain ":"`,
      'Basic auth (RFC 7617) separates the username from the password with ":"; only the password may contain it.',
    )
  }
  if (CONTROL.test(username)) {
    throw configError(`The username (${label}) must not contain control characters`, CONTROL_HINT)
  }
  return username
}

/** Checks a Basic auth password; `label` says where it came from. Never repeats the value. */
export function validatePassword(password: string, label: string): string {
  if (CONTROL.test(password)) {
    throw configError(
      `The password (${label}) must not contain control characters (line breaks, NUL, tab, ...)`,
      CONTROL_HINT,
    )
  }
  return password
}
