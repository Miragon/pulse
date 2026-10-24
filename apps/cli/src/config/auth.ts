/**
 * Validation of the auth settings (design §15, §16, §18): the auth type, Basic auth usernames and
 * passwords (RFC 7617: no control characters, no ":" in the username) and the auth object of a
 * profile in the config file (the OAuth rules live in oauth.ts, the bearer token rules in
 * bearer.ts, the names of the variables that hold secrets in variable.ts). Messages never repeat
 * a username, password or token.
 */

import { isRecord } from "../util.js"
import { BEARER_CHECKS, bearerMixProblem, bearerProfileProblem } from "./bearer.js"
import { configError } from "./config-error.js"
import { OAUTH_CHECKS, oauthProfileProblem } from "./oauth.js"
import { CONTROL, ENV_NAME, isNonEmptyString } from "./syntax.js"
import { AUTH_TYPES, type AuthType, ENV, PROFILE_AUTH_KEYS, type ProfileAuth } from "./types.js"

const CONTROL_HINT =
  "Remove line breaks, tabs, NUL and other control characters; Basic auth (RFC 7617) does not allow them."

/** A value that may be quoted as a mistyped auth type; anything else may be a credential. */
const TYPE_LIKE = /^[A-Za-z-]{0,20}$/

/**
 * The auth type. An unsupported value is quoted only when it looks like a type name: since
 * `bearer` is a type, `--auth "Bearer <token>"` or `OPERATE_AUTH=<token>` are likely mistakes.
 */
export function validateAuthType(type: string): AuthType {
  const known = AUTH_TYPES.find((candidate) => candidate === type)
  if (known !== undefined) return known
  const supported = `Supported: ${AUTH_TYPES.join(", ")}.`
  if (TYPE_LIKE.test(type)) throw configError(`Unsupported auth type "${type}"`, supported)
  throw configError(
    `Unsupported auth type (not one of ${AUTH_TYPES.join(", ")})`,
    "The auth type (--auth, OPERATE_AUTH, auth.type) is only the word, so the value is not repeated: it may be a credential. A bearer token itself goes into OPERATE_TOKEN or --auth-token-stdin, e.g. --auth bearer with OPERATE_TOKEN=<token>.",
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

type Check = readonly [check: (value: unknown) => boolean, expected: string]

const AUTH_CHECKS: Readonly<Record<keyof ProfileAuth, Check>> = {
  type: [
    (value) => typeof value === "string",
    `${AUTH_TYPES.slice(0, -1).join(", ")} or ${AUTH_TYPES.at(-1) ?? ""}`,
  ],
  username: [isNonEmptyString, "a non-empty string"],
  passwordEnv: [
    (value) => typeof value === "string" && ENV_NAME.test(value),
    "the name of an environment variable, e.g. CAMUNDA_PASSWORD",
  ],
  password: [isNonEmptyString, "a non-empty string"],
  ...OAUTH_CHECKS,
  ...BEARER_CHECKS,
}

const AUTH_EXAMPLE = '{"type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD"}'

/**
 * Why the auth object of profile `name` in the config file is invalid, or undefined. The type is
 * only checked to be a string here; resolution names the supported types. Never quotes values.
 * Values the environment may complete (an OAuth type without issuer or client id) are valid.
 */
export function profileAuthProblem(name: string, value: unknown): string | undefined {
  if (!isRecord(value)) return `profile "${name}" has an invalid auth (expected ${AUTH_EXAMPLE})`
  // the token command of 0.6.0 (design §23): only the environment gives one now
  if (Object.hasOwn(value, "tokenCommand")) {
    return `profile "${name}" sets auth.tokenCommand, which operate no longer reads: remove the key from the file and export ${ENV.tokenCommand}=<command> instead`
  }
  const allowed: readonly string[] = PROFILE_AUTH_KEYS
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    return `unknown key(s) ${unknown.join(", ")} in the auth of profile "${name}" (allowed: ${allowed.join(", ")})`
  }
  const invalid = PROFILE_AUTH_KEYS.find(
    (key) => Object.hasOwn(value, key) && !AUTH_CHECKS[key][0](value[key]),
  )
  if (invalid !== undefined) {
    return `profile "${name}" has an invalid auth.${invalid} (expected ${AUTH_CHECKS[invalid][1]})`
  }
  return Object.hasOwn(value, "password") && Object.hasOwn(value, "passwordEnv")
    ? `profile "${name}" sets both auth.password and auth.passwordEnv; keep one (passwordEnv is recommended)`
    : (bearerMixProblem(name, value) ??
        oauthProfileProblem(name, value) ??
        bearerProfileProblem(name, value))
}
