/**
 * Validation of the auth settings: the auth type, Basic auth usernames and
 * passwords (RFC 7617: no control characters, no ":" in the username) and the auth object of a
 * profile in the config file (the bearer token rules live in bearer.ts, the names of the variables that hold secrets in variable.ts). Messages never repeat
 * a username, password or token.
 */

import { isRecord } from "../util.js"
import { BEARER_CHECKS, bearerMixProblem, bearerProfileProblem } from "./bearer.js"
import { configError } from "./config-error.js"
import { CONTROL, ENV_NAME, isNonEmptyString } from "./syntax.js"
import {
  AUTH_TYPES,
  type AuthType,
  BASIC_AUTH_KEYS,
  ENV,
  PROFILE_AUTH_KEYS,
  type ProfileAuth,
} from "./types.js"

const CONTROL_HINT =
  "Remove line breaks, tabs, NUL and other control characters; Basic auth (RFC 7617) does not allow them."

/** Why `oauth` is gone, and what replaces it. */
const OAUTH_REMOVED =
  'pulse-cli no longer logs in with OAuth. Let a command print the token instead: export PULSE_CLI_TOKEN_COMMAND, e.g. "az account get-access-token --query accessToken -o tsv" (docs/cli/authentication.md shows Keycloak, Entra ID and Auth0).'

/** A value that may be quoted as a mistyped auth type; anything else may be a credential. */
const TYPE_LIKE = /^[A-Za-z-]{0,20}$/

/**
 * The auth type. An unsupported value is quoted only when it looks like a type name: since
 * `bearer` is a type, `--auth "Bearer <token>"` or `PULSE_CLI_AUTH=<token>` are likely mistakes.
 */
export function validateAuthType(type: string): AuthType {
  const known = AUTH_TYPES.find((candidate) => candidate === type)
  if (known !== undefined) return known
  if (type === "oauth") throw configError('The auth type "oauth" was removed', OAUTH_REMOVED)
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
  ...BEARER_CHECKS,
}

/** The type rule of Basic auth keys: type basic, none or no type. */
function basicTypeProblem(name: string, value: Record<string, unknown>): string | undefined {
  const { type } = value
  const keys = BASIC_AUTH_KEYS.filter((key) => Object.hasOwn(value, key))
  if (keys.length === 0 || type === undefined || type === "basic" || type === "none") {
    return undefined
  }
  // unknown types are reported by resolution, which names the supported ones
  if (!(AUTH_TYPES as readonly unknown[]).includes(type)) return undefined
  return `profile "${name}" has Basic auth keys (${keys.join(", ")}) but its auth.type is ${type as string}; set "type": "basic"`
}

const AUTH_EXAMPLE = '{"type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD"}'

/**
 * Why the auth object of profile `name` in the config file is invalid, or undefined. The type is
 * only checked to be a string here; resolution names the supported types. Never quotes values.
 */
export function profileAuthProblem(name: string, value: unknown): string | undefined {
  if (!isRecord(value)) return `profile "${name}" has an invalid auth (expected ${AUTH_EXAMPLE})`
  // the token command of 0.6.0: only the environment gives one now
  if (Object.hasOwn(value, "tokenCommand")) {
    return `profile "${name}" sets auth.tokenCommand, which pulse-cli no longer reads: remove the key from the file and export ${ENV.tokenCommand}=<command> instead`
  }
  if (value.type === "oauth") {
    return `profile "${name}" uses auth type "oauth", which was removed. ${OAUTH_REMOVED}`
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
        basicTypeProblem(name, value) ??
        bearerProfileProblem(name, value))
}
