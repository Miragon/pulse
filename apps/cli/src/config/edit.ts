/**
 * Pure edit functions behind `pulse config set|unset|use|delete` (what `list` and `show` print is
 * show.ts's). They take the parsed config file (undefined when it does not exist yet), never
 * modify it and return a new one; the CLI reads and writes the file. Values are validated with the
 * validators of resolve.ts.
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
  type ConfigFile,
  PROFILE_KEYS,
  type Profile,
  type ProfileAuth,
  type ProfileKey,
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

/** The edited file: `current`'s $schema (an edit keeps it), the default profile and profiles. */
function buildFile(current: ConfigFile, profiles: ConfigFile["profiles"], defaultProfile?: string) {
  return { ...compact({ $schema: current.$schema, defaultProfile }), profiles }
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
    current,
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
  return buildFile(current, { ...current.profiles, [name]: edited }, current.defaultProfile)
}

/** Makes an existing profile the default profile. */
export function useProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY
  requireProfile(current, name)
  return buildFile(current, current.profiles, name)
}

/** Removes a profile and clears the default profile if it pointed to it. */
export function deleteProfile(file: ConfigFile | undefined, name: string): ConfigFile {
  const current = file ?? EMPTY
  requireProfile(current, name)
  const profiles = Object.fromEntries(
    Object.entries(current.profiles).filter(([candidate]) => candidate !== name),
  )
  const defaultProfile = current.defaultProfile === name ? undefined : current.defaultProfile
  return buildFile(current, profiles, defaultProfile)
}
