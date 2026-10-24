/**
 * Pure edit functions behind `pulse-cli config set|unset|use|delete|list|show`. They take the parsed
 * config file (undefined when it does not exist yet), never modify it and return a new one; the CLI
 * reads and writes the file. Values are validated with the validators of resolve.ts.
 */

import { compact, mergeHeaders } from "../util.js"
import { changedAuth, settleAuthorization } from "./auth-edit.js"
import { type BearerChanges, BEARER_UNSET_KEYS, bearerUnsetKeys } from "./bearer-edit.js"
import { configError } from "./config-error.js"
import { parseHeaders } from "./headers.js"
import {
  type OAuthChanges,
  OAUTH_UNSET_KEYS,
  oauthUnsetKeys,
  withoutAuthKeys,
} from "./oauth-edit.js"
import { PROFILE_NAME } from "./syntax.js"
import {
  findProfile,
  missingProfileError,
  parseTimeout,
  validateCockpitUrl,
  validateEngine,
  validateOutput,
  validateFlavor,
  validateUrl,
} from "./resolve.js"
import {
  type AuthConfig,
  type ConfigFile,
  type LoadedConfig,
  type OAuthConfig,
  type OutputFormat,
  PROFILE_KEYS,
  type Profile,
  type ProfileAuth,
  type ProfileKey,
  type ResolvedConfig,
  type Source,
} from "./types.js"

export interface ProfileChanges extends OAuthChanges, BearerChanges {
  readonly url?: string
  readonly cockpitUrl?: string
  readonly engine?: string
  readonly flavor?: string
  /** Auth type: none, basic, oauth or bearer. */
  readonly auth?: string
  /** Basic auth username. */
  readonly authUser?: string
  /** Name of the environment variable holding the password; replaces a stored password. */
  readonly authPasswordEnv?: string
  /** Literal password (discouraged: stored in plain text); replaces a stored passwordEnv. */
  readonly authPassword?: string
  readonly output?: string
  readonly timeout?: string | number
  /** Headers in the form "Name: value", merged into the existing headers of the profile. */
  readonly headers?: readonly string[]
  readonly readOnly?: boolean
  /** Make this profile the default profile. */
  readonly makeDefault?: boolean
}

/**
 * One row of `pulse-cli config list`. Values the profile does not set are null; `scope` says
 * whether it comes from the project file or the user's (or the named) config file.
 */
export interface ProfileSummary {
  readonly name: string
  readonly default: boolean
  readonly url: string | null
  readonly engine: string | null
  readonly auth: string | null
  readonly readOnly: boolean
  readonly scope: "user" | "project"
}

interface ConfigValue<T> {
  readonly value: T
  readonly source: Source
}

/** The OAuth rows of `config show`, only for auth type oauth. */
interface OAuthValues {
  readonly issuer: ConfigValue<string | null>
  readonly authorizationEndpoint: ConfigValue<string | null>
  readonly tokenEndpoint: ConfigValue<string | null>
  readonly clientId: ConfigValue<string>
  readonly clientSecret: ConfigValue<string | null>
  readonly scopes: ConfigValue<readonly string[]>
  readonly audience: ConfigValue<string | null>
  readonly redirectPort: ConfigValue<number>
}

/**
 * The `token` row of `config show`: the bearer token of type bearer, or a token that is set but
 * not used by the resolved type (`unused` says why). The `tokenCommand` row: the command of
 * PULSE_CLI_TOKEN_COMMAND that prints the token (`config show` never runs it).
 */
interface TokenValue extends ConfigValue<string> {
  readonly unused?: string
}

/**
 * Output of `pulse-cli config show`: every effective value with its source (`auth` is the type,
 * `username` and `password` the Basic auth credentials, the OAuth settings only for type oauth,
 * `token` or `tokenCommand` for type bearer or an unused one). Header values, the password, the
 * client secret and the token are not masked here; the CLI masks them unless --show-secrets is
 * given. A token command is no secret: it is shown as it is.
 */
export interface ConfigView {
  readonly configFile: string
  /** The project file in effect, null without one. */
  readonly projectFile: string | null
  readonly profile: string | null
  /** The file the selected profile comes from: the project file or the config file. */
  readonly profileFile: string | null
  readonly values: {
    readonly url: ConfigValue<string>
    readonly cockpitUrl: ConfigValue<string | null>
    readonly engine: ConfigValue<string | null>
    readonly flavor: ConfigValue<ResolvedConfig["flavor"]>
    readonly auth: ConfigValue<string>
    readonly username: ConfigValue<string | null>
    readonly password: ConfigValue<string | null>
  } & Partial<OAuthValues> & {
      readonly token?: TokenValue
      readonly tokenCommand?: TokenValue
      readonly output: ConfigValue<OutputFormat | null>
      readonly timeout: ConfigValue<number>
      readonly headers: ConfigValue<Readonly<Record<string, string>>>
      readonly readOnly: ConfigValue<boolean>
    }
}

/** Accepted spellings for `config unset` besides the profile keys themselves. */
const KEY_ALIASES: Readonly<Record<string, ProfileKey>> = {
  "read-only": "readOnly",
  "cockpit-url": "cockpitUrl",
  header: "headers",
}

const EMPTY: ConfigFile = { profiles: {} }

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME.test(name)) {
    throw configError(
      `Invalid profile name "${name}"`,
      'Use letters, digits, ".", "_" and "-", starting with a letter or digit, e.g. "local" or "prod-eu".',
    )
  }
  return name
}

function ifGiven<T, R>(value: T | undefined, convert: (value: T) => R): R | undefined {
  return value === undefined ? undefined : convert(value)
}

function changedHeaders(
  existing: Profile | undefined,
  headers: readonly string[],
): Record<string, string> | undefined {
  const merged = mergeHeaders(existing?.headers ?? {}, parseHeaders(headers))
  return Object.keys(merged).length > 0 ? merged : undefined
}

function changedValues(existing: Profile | undefined, changes: ProfileChanges): Profile {
  return compact({
    url: ifGiven(changes.url, validateUrl),
    cockpitUrl: ifGiven(changes.cockpitUrl, validateCockpitUrl),
    engine: ifGiven(changes.engine, validateEngine),
    flavor: ifGiven(changes.flavor, validateFlavor),
    auth: changedAuth(existing?.auth, changes),
    output: ifGiven(changes.output, validateOutput),
    timeout: ifGiven(changes.timeout, parseTimeout),
    headers: ifGiven(changes.headers, (headers) => changedHeaders(existing, headers)),
    readOnly: changes.readOnly,
  })
}

/** Writes the keys in their canonical order and drops absent ones. */
function canonical(profile: Profile): Profile {
  return compact(Object.fromEntries(PROFILE_KEYS.map((key) => [key, profile[key]])))
}

function buildFile(
  profiles: Readonly<Record<string, Profile>>,
  defaultProfile: string | undefined,
): ConfigFile {
  return defaultProfile === undefined ? { profiles } : { defaultProfile, profiles }
}

function requireProfile(file: ConfigFile, name: string): Profile {
  const profile = findProfile(file, name)
  if (profile === undefined) throw missingProfileError(name, file)
  return profile
}

/**
 * Creates or updates a profile; only the given keys change, headers are merged. The first profile
 * of a file becomes the default profile automatically. Basic auth options replace a stored
 * Authorization header; any other mix of the two is a CONFIG error (`settleAuthorization`).
 */
export function setProfile(
  file: ConfigFile | undefined,
  name: string,
  changes: ProfileChanges,
): ConfigFile {
  validateProfileName(name)
  const current = file ?? EMPTY
  const existing = findProfile(current, name)
  const merged = { ...existing, ...changedValues(existing, changes) }
  const profile = canonical(settleAuthorization(merged, changes, name))
  const first = Object.keys(current.profiles).length === 0
  const makeDefault = changes.makeDefault === true || first
  return buildFile(
    { ...current.profiles, [name]: profile },
    makeDefault ? name : current.defaultProfile,
  )
}

function profileKey(key: string): ProfileKey {
  const wanted = KEY_ALIASES[key] ?? key
  const known = PROFILE_KEYS.find((candidate) => candidate === wanted)
  if (known === undefined) {
    throw configError(
      `Unknown profile key "${key}"`,
      `Valid keys: ${PROFILE_KEYS.join(", ")}; OAuth settings: ${OAUTH_UNSET_KEYS.join(", ")}; bearer token: ${BEARER_UNSET_KEYS.join(", ")}.`,
    )
  }
  return known
}

/** The keys of the auth object an unset key name removes: OAuth settings or the bearer token. */
function authUnsetKeys(key: string): readonly (keyof ProfileAuth)[] | undefined {
  return oauthUnsetKeys(key) ?? bearerUnsetKeys(key)
}

/**
 * Removes keys from a profile: profile keys, or single OAuth settings or the bearer token of its
 * auth object (`audience`, `clientSecret`, `token`, ...; `auth` removes all auth settings).
 * Unknown key names fail; keys the profile does not set are ignored.
 */
export function unsetProfileKeys(
  file: ConfigFile | undefined,
  name: string,
  keys: readonly string[],
): ConfigFile {
  const current = file ?? EMPTY
  const profile = requireProfile(current, name)
  const authKeys = keys.flatMap((key) => authUnsetKeys(key) ?? [])
  const plain = keys.filter((key) => authUnsetKeys(key) === undefined)
  const removed = new Set<string>(plain.map(profileKey))
  const { auth, ...kept }: Profile = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !removed.has(key)),
  )
  const rest = withoutAuthKeys(auth, authKeys)
  const edited = canonical(rest === undefined ? kept : { ...kept, auth: rest })
  return buildFile({ ...current.profiles, [name]: edited }, current.defaultProfile)
}

/** Makes an existing profile the default profile. */
export function useProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY
  requireProfile(current, name)
  return buildFile(current.profiles, name)
}

/** Removes a profile and clears the default profile if it pointed to it. */
export function deleteProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY
  requireProfile(current, name)
  const profiles = Object.fromEntries(
    Object.entries(current.profiles).filter(([candidate]) => candidate !== name),
  )
  const defaultProfile = current.defaultProfile === name ? undefined : current.defaultProfile
  return buildFile(profiles, defaultProfile)
}

/** Profile names are unique, so two summaries never compare equal. */
function byName(a: ProfileSummary, b: ProfileSummary): number {
  return a.name < b.name ? -1 : 1
}

/** Profiles sorted by name, with the file each comes from. */
export function listProfiles(file: LoadedConfig | undefined): ProfileSummary[] {
  const current = file ?? EMPTY
  const fromProject = file?.project?.profiles ?? []
  return Object.entries(current.profiles)
    .map(([name, profile]) => ({
      name,
      default: current.defaultProfile === name,
      url: profile.url ?? null,
      engine: profile.engine ?? null,
      auth: profile.auth?.type ?? (profile.auth?.username === undefined ? null : "basic"),
      readOnly: profile.readOnly === true,
      scope: fromProject.includes(name) ? ("project" as const) : ("user" as const),
    }))
    .sort(byName)
}

const NOT_SET = { value: null, source: "default" } as const

function optionalValue<T>(value: T | undefined, source: Source | undefined): ConfigValue<T | null> {
  return value === undefined || source === undefined ? NOT_SET : { value, source }
}

/** The OAuth rows of `config show`; endpoints that are not set are null with source default. */
function oauthValues(oauth: OAuthConfig): OAuthValues {
  const { sources } = oauth
  return {
    issuer: optionalValue(oauth.issuer, sources.endpoints),
    authorizationEndpoint: optionalValue(oauth.authorizationEndpoint, sources.endpoints),
    tokenEndpoint: optionalValue(oauth.tokenEndpoint, sources.endpoints),
    clientId: { value: oauth.clientId, source: sources.clientId },
    clientSecret: optionalValue(oauth.clientSecret, sources.clientSecret),
    scopes: { value: oauth.scopes, source: sources.scopes },
    audience: optionalValue(oauth.audience, sources.audience),
    redirectPort: { value: oauth.redirectPort, source: sources.redirectPort },
  }
}

/**
 * The `token` (or `tokenCommand`) row: the bearer token or its command, or one the resolved type
 * leaves unused.
 */
function tokenValue(resolved: ResolvedConfig): { token?: TokenValue; tokenCommand?: TokenValue } {
  const { auth, unusedToken } = resolved
  if (auth.type === "bearer") {
    const { source, command } = auth
    if (command === undefined) return { token: { value: auth.token, source } }
    return { tokenCommand: { value: command, source } }
  }
  if (unusedToken === undefined) return {}
  const { value, source, reason } = unusedToken
  const row = { value, source, unused: reason }
  return unusedToken.command === true ? { tokenCommand: row } : { token: row }
}

function credentialValues(auth: AuthConfig) {
  if (auth.type !== "basic") {
    return {
      username: NOT_SET,
      password: NOT_SET,
      ...(auth.type === "oauth" ? oauthValues(auth) : {}),
    }
  }
  return {
    username: { value: auth.username, source: auth.sources.username },
    password: { value: auth.password, source: auth.sources.password },
  }
}

/**
 * The effective configuration with the source of every value; `projectFile` is the project file
 * in effect, if any. Values of source `profile` come from the file of the profile (`profileFile`).
 */
export function showConfig(
  resolved: ResolvedConfig,
  configFile: string,
  projectFile?: string,
): ConfigView {
  const { sources, auth } = resolved
  const profileFile = resolved.project?.path ?? (resolved.profile === undefined ? null : configFile)
  return {
    configFile,
    projectFile: projectFile ?? null,
    profile: resolved.profile ?? null,
    profileFile,
    values: {
      url: { value: resolved.url, source: sources.url },
      cockpitUrl: optionalValue(resolved.cockpitUrl, "profile"),
      engine: { value: resolved.engine ?? null, source: sources.engine },
      flavor: { value: resolved.flavor, source: sources.flavor },
      auth: { value: auth.type, source: sources.auth },
      ...credentialValues(auth),
      ...tokenValue(resolved),
      output: { value: resolved.output ?? null, source: sources.output },
      timeout: { value: resolved.timeoutMs, source: sources.timeout },
      headers: { value: resolved.headers, source: sources.headers },
      readOnly: { value: resolved.readOnly, source: sources.readOnly },
    },
  }
}
