/**
 * The profile format: the keys a profile file may hold, the values they take, and the verdicts
 * the parser returns. A verdict is data (a code and the key it is about), never a sentence with a
 * value in it: a value may be a credential pasted into the wrong place.
 */

/**
 * The vendors a profile names in `flavor`, each with the API dialect it speaks. The one table of
 * flavors: a new vendor of a known dialect is a row here, a new dialect a new value.
 */
export const FLAVORS = { camunda7: "c7", cibseven: "c7", operaton: "c7" } as const
export type Flavor = keyof typeof FLAVORS
export type Dialect = (typeof FLAVORS)[Flavor]
/** The flavor of a profile that names none. */
export const DEFAULT_FLAVOR: Flavor = "camunda7"

export const AUTH_TYPES = ["none", "basic", "bearer", "oauth", "passthrough"] as const
export type AuthType = (typeof AUTH_TYPES)[number]

export const OUTPUT_FORMATS = ["json", "table"] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/** The keys of the file's root object. */
export const ROOT_KEYS = ["$schema", "defaultProfile", "profiles"] as const

/** The keys of a profile, in the order a file lists them. */
export const PROFILE_KEYS = [
  "url",
  "cockpitUrl",
  "engine",
  "flavor",
  "environment",
  "auth",
  "output",
  "timeout",
  "headers",
  "readOnly",
] as const
export type ProfileKey = (typeof PROFILE_KEYS)[number]

/** Basic auth: the username, and the password or the variable that holds it. */
export const BASIC_AUTH_KEYS = ["username", "passwordEnv", "password"] as const
/** OAuth: discovery or both endpoints, the client, its secret, scopes, audience, callback port. */
export const OAUTH_AUTH_KEYS = [
  "issuer",
  "authorizationEndpoint",
  "tokenEndpoint",
  "clientId",
  "clientSecretEnv",
  "clientSecret",
  "scopes",
  "audience",
  "redirectPort",
] as const
/** A bearer token obtained elsewhere: the variable that holds it, or the token itself. */
export const BEARER_AUTH_KEYS = ["tokenEnv", "token"] as const
/** The keys of a profile's auth object, in the order a file lists them. */
export const AUTH_KEYS = [
  "type",
  ...BASIC_AUTH_KEYS,
  ...OAUTH_AUTH_KEYS,
  ...BEARER_AUTH_KEYS,
] as const
export type AuthKey = (typeof AUTH_KEYS)[number]

/** The keys that hold a secret itself. */
export const SECRET_KEYS = ["password", "clientSecret", "token"] as const
/** The keys that name the environment variable holding a secret, each next to its secret key. */
export const VARIABLE_KEYS = ["passwordEnv", "clientSecretEnv", "tokenEnv"] as const

/**
 * Where a file comes from decides which credentials it may hold:
 * - `none`: a file others share (a repository's project file): neither a secret nor the name of
 *   the variable that holds one, so a cloned repository can neither carry a secret nor send a
 *   variable of its choice to the URL it names;
 * - `env`: the operator's profiles of an MCP server: only variables, each named
 *   SECRET_VARIABLE_PREFIX…, never a secret itself (fail-closed: no other variable of the
 *   process is reachable from the file);
 * - `env-or-literal`: a person's own config file (the CLI's): a variable or the secret itself.
 */
export const CREDENTIAL_POLICIES = ["none", "env", "env-or-literal"] as const
export type CredentialPolicy = (typeof CREDENTIAL_POLICIES)[number]

/** The prefix of every variable a profile under the `env` policy names. */
export const SECRET_VARIABLE_PREFIX = "ENGINE_SECRET_"

/** A profile's auth object as the file states it. */
export interface ProfileAuth {
  /** Absent: a username selects Basic auth, else none (`authTypeOf`). */
  readonly type?: AuthType
  readonly username?: string
  readonly passwordEnv?: string
  readonly password?: string
  readonly issuer?: string
  readonly authorizationEndpoint?: string
  readonly tokenEndpoint?: string
  readonly clientId?: string
  readonly clientSecretEnv?: string
  readonly clientSecret?: string
  readonly scopes?: readonly string[]
  readonly audience?: string
  readonly redirectPort?: number
  readonly tokenEnv?: string
  readonly token?: string
}

/**
 * A usable profile: what the file states, checked. `url` and `cockpitUrl` are trimmed and lose
 * their trailing slashes (`cockpitUrl` also a trailing `#`), `engine` is trimmed; everything else
 * is as given. Defaults are the reader's: a flavor (DEFAULT_FLAVOR), an auth type (`authTypeOf`).
 */
export interface Profile {
  readonly url?: string
  readonly cockpitUrl?: string
  readonly engine?: string
  readonly flavor?: Flavor
  readonly environment?: string
  readonly auth?: ProfileAuth
  readonly output?: OutputFormat
  readonly timeout?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly readOnly?: boolean
}

/** Every code a verdict carries; `describeProblem` words each. */
export const PROBLEM_CODES = [
  // The file gives no profiles.
  "not-json",
  "root-not-object",
  "profiles-not-object",
  // A key twice: at the root the file fails, in a profile the profile.
  "duplicate-key",
  // Notes on the root object: the file loads.
  "unknown-root-key",
  "default-not-found",
  // A profile is refused.
  "invalid",
  "invalid-name",
  "duplicate-name",
  "unknown-key",
  "flavor-unknown",
  "auth-type-unknown",
  "auth-keys-mixed",
  "auth-type-mismatch",
  "secret-twice",
  "endpoint-alone",
  "url-invalid",
  "url-not-http",
  "url-credentials",
  "url-query-or-fragment",
  // The credential policy refuses a profile.
  "credential-in-shared-file",
  "literal-secret",
  "variable-prefix",
  "secret-header",
  // A reader refuses a profile it cannot serve (`refusalsOn`).
  "dialect-not-served",
  "auth-type-not-served",
  "url-missing",
  "process-engine-not-served",
  "key-not-served",
] as const
export type ProblemCode = (typeof PROBLEM_CODES)[number]

/**
 * What is wrong, as data. `key` names the key it is about (`url`, `auth.passwordEnv`,
 * `headers.X-Api-Key`); absent for the profile itself, its name, or a key that does not look like
 * one (it is never shown). No problem carries a value.
 */
export interface Problem {
  readonly code: ProblemCode
  readonly key?: string
  /** Where the text stops being valid JSON (`not-json`), 1-based; never the text itself. */
  readonly line?: number
  readonly column?: number
}

/** One profile of the file. */
export interface ProfileVerdict {
  /** Its name; absent when the name is no valid profile name (it is never shown then). */
  readonly name?: string
  /** Its position among the file's profiles, 0-based, in the order of the file's text. */
  readonly index: number
  /** Why it cannot be used; empty for a usable profile. */
  readonly problems: readonly Problem[]
  /** The checked profile, only when `problems` is empty. */
  readonly profile?: Profile
}

/** What a profile file says, under one credential policy. */
export interface ProfileFile {
  /** Why the file gives no profiles at all: invalid JSON, a wrong outer shape, a root key twice. */
  readonly problem?: Problem
  /** What is off at the root besides the profiles: the file loads, and nothing falls back. */
  readonly notes: readonly Problem[]
  /** `$schema`, when it is a string. */
  readonly schema?: string
  /** `defaultProfile`, trimmed, when it names one of the file's profiles. */
  readonly defaultProfile?: string
  /** Every profile, refused ones included, in the order of the file's text. */
  readonly profiles: readonly ProfileVerdict[]
}
