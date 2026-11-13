/**
 * The auth object of a profile: the shape of each key, what the credential policy lets a file
 * hold, and the rules between the keys (one kind of credentials, a type that fits them, one source
 * per secret, both OAuth endpoints or neither). Never reads a value into a problem.
 */

import { keyed } from "./keys.js"
import type { Members } from "./json-text.js"
import { CONTROL, ENV_NAME, isNonEmptyString } from "./syntax.js"
import {
  AUTH_KEYS,
  AUTH_TYPES,
  type AuthKey,
  type AuthType,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  type CredentialPolicy,
  OAUTH_AUTH_KEYS,
  type Problem,
  type ProblemCode,
  SECRET_KEYS,
  SECRET_VARIABLE_PREFIX,
  VARIABLE_KEYS,
} from "./types.js"

/** RFC 6749 §3.3 scope-token: printable ASCII except space, `"` and `\`. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/
const MAX_PORT = 65_535

/** A Basic auth username: not blank, no ":" (RFC 7617 separates the password with it), no controls. */
export function isUsername(value: unknown): boolean {
  return isNonEmptyString(value) && !value.includes(":") && !CONTROL.test(value)
}

function isVariableName(value: unknown): boolean {
  return typeof value === "string" && ENV_NAME.test(value)
}

/** OAuth scopes: a list of distinct RFC 6749 scope tokens. */
export function isScopeList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((scope) => typeof scope === "string" && SCOPE_TOKEN.test(scope)) &&
    new Set(value).size === value.length
  )
}

/** A port of the login callback: 0 (any free port) to 65535. */
export function isRedirectPort(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PORT
}

/** The shape of each auth key; URL details and syntax a login needs are the reader's to check. */
const AUTH_SHAPES: Readonly<Record<AuthKey, (value: unknown) => boolean>> = {
  type: (value) => typeof value === "string",
  username: isUsername,
  passwordEnv: isVariableName,
  password: isNonEmptyString,
  issuer: isNonEmptyString,
  authorizationEndpoint: isNonEmptyString,
  tokenEndpoint: isNonEmptyString,
  clientId: isNonEmptyString,
  clientSecretEnv: isVariableName,
  clientSecret: isNonEmptyString,
  scopes: isScopeList,
  audience: isNonEmptyString,
  redirectPort: isRedirectPort,
  tokenEnv: isVariableName,
  token: isNonEmptyString,
}

const SECRETS: ReadonlySet<string> = new Set(SECRET_KEYS)
const VARIABLES: ReadonlySet<string> = new Set(VARIABLE_KEYS)

/** True for one of AUTH_TYPES. */
function isAuthType(value: unknown): value is AuthType {
  return AUTH_TYPES.some((type) => type === value)
}

/** What the policy says about a credential key, before its shape counts. */
function policyCode(key: AuthKey, policy: CredentialPolicy): ProblemCode | undefined {
  if (!SECRETS.has(key) && !VARIABLES.has(key)) return undefined
  if (policy === "none") return "credential-in-shared-file"
  return policy === "env" && SECRETS.has(key) ? "literal-secret" : undefined
}

/** A variable the env policy reaches: ENGINE_SECRET_ and at least one more character. */
function outsidePrefix(key: AuthKey, value: unknown, policy: CredentialPolicy): boolean {
  if (policy !== "env" || !VARIABLES.has(key) || typeof value !== "string") return false
  return !value.startsWith(SECRET_VARIABLE_PREFIX) || value === SECRET_VARIABLE_PREFIX
}

function keyCode(key: AuthKey, value: unknown, policy: CredentialPolicy): ProblemCode | undefined {
  const refused = policyCode(key, policy)
  if (refused !== undefined) return refused
  if (!AUTH_SHAPES[key](value)) return "invalid"
  if (key === "type" && !isAuthType(value)) return "auth-type-unknown"
  return outsidePrefix(key, value, policy) ? "variable-prefix" : undefined
}

function present(auth: Readonly<Record<string, unknown>>, keys: readonly string[]): string[] {
  return keys.filter((key) => Object.hasOwn(auth, key))
}

/** The types each kind of keys allows; undefined stands for no type. */
const KIND_TYPES: readonly (readonly [readonly string[], readonly (AuthType | undefined)[]])[] = [
  [BASIC_AUTH_KEYS, ["basic", "none", undefined]],
  [OAUTH_AUTH_KEYS, ["oauth", "none"]],
  [BEARER_AUTH_KEYS, ["bearer", "none"]],
]

/**
 * One kind of credentials per profile, and a type that fits it: OAuth and a stored token are
 * never implied, a username implies Basic auth, `none` switches stored settings off, and
 * `passthrough` takes no other key. An unknown type has its own problem.
 */
function kindProblem(auth: Readonly<Record<string, unknown>>): Problem | undefined {
  const kinds = KIND_TYPES.filter(([keys]) => present(auth, keys).length > 0)
  if (kinds.length > 1) return { code: "auth-keys-mixed", key: "auth" }
  const [kind] = kinds
  const { type } = auth
  if (kind === undefined || (type !== undefined && !isAuthType(type))) return undefined
  return kind[1].includes(type) ? undefined : { code: "auth-type-mismatch", key: "auth.type" }
}

/** A secret and the variable that holds it, both set. */
function twiceProblems(auth: Readonly<Record<string, unknown>>): Problem[] {
  return SECRET_KEYS.filter((key) => present(auth, [key, `${key}Env`]).length === 2).map(
    (key): Problem => ({ code: "secret-twice", key: `auth.${key}` }),
  )
}

/** OAuth takes both endpoints or neither (then the issuer is discovered). */
function endpointProblem(auth: Readonly<Record<string, unknown>>): Problem | undefined {
  if (auth.type !== "oauth") return undefined
  const [only, other] = present(auth, ["authorizationEndpoint", "tokenEndpoint"])
  return only !== undefined && other === undefined
    ? { code: "endpoint-alone", key: `auth.${only}` }
    : undefined
}

function keyProblems(auth: Readonly<Record<string, unknown>>, policy: CredentialPolicy) {
  return AUTH_KEYS.filter((key) => Object.hasOwn(auth, key)).flatMap((key): Problem[] => {
    const code = keyCode(key, auth[key], policy)
    return code === undefined ? [] : [{ code, key: `auth.${key}` }]
  })
}

/**
 * Why the auth object `auth` refuses its profile under `policy`. `members` are the object's keys
 * as the text lists them: the keys it repeats, and the unknown ones in the text's order.
 */
export function authProblems(
  auth: Readonly<Record<string, unknown>>,
  members: Members,
  policy: CredentialPolicy,
): Problem[] {
  const known: readonly string[] = AUTH_KEYS
  return [
    ...members.repeated.map((key) => keyed("duplicate-key", "auth", key)),
    ...members.first
      .filter(({ key }) => !known.includes(key))
      .map(({ key }) => keyed("unknown-key", "auth", key)),
    ...keyProblems(auth, policy),
    ...[kindProblem(auth), ...twiceProblems(auth), endpointProblem(auth)].filter(
      (problem) => problem !== undefined,
    ),
  ]
}
