/**
 * Pure edit functions behind `pulse config set|unset|use|delete` (what `list` and `show` print is
 * show.ts's). They take the parsed
 * config file (undefined when it does not exist yet), never modify it and return a new one; the CLI
 * reads and writes the file. Values are validated with the validators of resolve.ts. An edit works
 * on a profile as the file holds it, a refused one too, so `config set` and `config unset` can
 * repair it; it keeps the keys it does not know (they still refuse the profile) and the profiles
 * it does not change.
 */

import { PROFILE_NAME } from "@miragon/pulse-profile"
import { compact, isRecord, mergeHeaders } from "../util.js"
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
import {
  missingProfileError,
  parseTimeout,
  storedProfile,
  validateCockpitUrl,
  validateEngine,
  validateOutput,
  validateFlavor,
  validateUrl,
} from "./resolve.js"
import { type ConfigFile, PROFILE_KEYS, type Profile, type ProfileKey } from "./types.js"

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

/** A stored object of a profile (its auth, its headers), unless the file holds something else. */
function storedObject<T>(value: T | undefined): T | undefined {
  return isRecord(value) ? value : undefined
}

function changedHeaders(
  existing: Profile | undefined,
  headers: readonly string[],
): Record<string, string> | undefined {
  const merged = mergeHeaders(storedObject(existing?.headers) ?? {}, parseHeaders(headers))
  return Object.keys(merged).length > 0 ? merged : undefined
}

function changedValues(existing: Profile | undefined, changes: ProfileChanges): Profile {
  return compact({
    url: ifGiven(changes.url, validateUrl),
    cockpitUrl: ifGiven(changes.cockpitUrl, validateCockpitUrl),
    engine: ifGiven(changes.engine, validateEngine),
    flavor: ifGiven(changes.flavor, validateFlavor),
    auth: changedAuth(storedObject(existing?.auth), changes),
    output: ifGiven(changes.output, validateOutput),
    timeout: ifGiven(changes.timeout, parseTimeout),
    headers: ifGiven(changes.headers, (headers) => changedHeaders(existing, headers)),
    readOnly: changes.readOnly,
  })
}

/**
 * Writes the keys of the format in their canonical order and drops absent ones; keys the format
 * does not know stay behind them, as the file held them, so an edit never drops one silently.
 */
function canonical(profile: Profile): Profile {
  const known: readonly string[] = PROFILE_KEYS
  const unknown = Object.entries(profile).filter(([key]) => !known.includes(key))
  return {
    ...compact(Object.fromEntries(PROFILE_KEYS.map((key) => [key, profile[key]]))),
    ...Object.fromEntries(unknown),
  }
}

/**
 * The edited file: `current`'s $schema and unknown root keys (an edit keeps them), the default
 * profile and profiles. What the reader found (refused profiles, notes) is the next read's.
 */
function buildFile(current: ConfigFile, profiles: ConfigFile["profiles"], defaultProfile?: string) {
  return {
    ...compact({ $schema: current.$schema, defaultProfile, unknown: current.unknown }),
    profiles,
  }
}

/** The profile an edit changes, as the file holds it (a refused one too). */
function requireProfile(file: ConfigFile, name: string): Profile {
  const profile = storedProfile(file, name)
  if (profile === undefined && !Object.hasOwn(file.profiles, name)) {
    throw missingProfileError(name, file)
  }
  return profile ?? {}
}

/** A new profile needs a URL: a profile without one would reach the default engine silently. */
function checkNewProfile(name: string, existing: Profile | undefined, changes: ProfileChanges) {
  if (existing !== undefined || changes.url !== undefined) return
  throw configError(
    `Profile "${name}" needs a URL`,
    `Create it with \`pulse config set ${name} --url <url>\`, e.g. --url http://localhost:8080/engine-rest.`,
  )
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
  const existing = storedProfile(current, name)
  const changed = changedValues(existing, changes)
  checkNewProfile(name, existing, changes)
  const merged = { ...existing, ...changed }
  const profile = canonical(settleAuthorization(merged, changes, name))
  const first = Object.keys(current.profiles).length === 0
  const makeDefault = changes.makeDefault === true || first
  return buildFile(
    current,
    { ...current.profiles, [name]: profile },
    makeDefault ? name : current.defaultProfile,
  )
}

/** A key `config unset` removes from `profile`: a key of the format, or one the profile holds. */
function profileKey(key: string, profile: Profile): string {
  const wanted = KEY_ALIASES[key] ?? key
  const known = PROFILE_KEYS.find((candidate) => candidate === wanted)
  if (known === undefined && !Object.hasOwn(profile, key)) {
    throw configError(
      `Unknown profile key "${key}"`,
      `Valid keys: ${PROFILE_KEYS.join(", ")}; OAuth settings: ${OAUTH_UNSET_KEYS.join(", ")}; bearer token: ${BEARER_UNSET_KEYS.join(", ")}; or any key the profile holds, auth.<key> for one of its auth object.`,
    )
  }
  return known ?? key
}

/**
 * The keys of the auth object an unset key name removes: OAuth settings, the bearer token, or
 * `auth.<key>` for any key the stored auth object holds (one the format does not know, too).
 */
function authUnsetKeys(key: string, profile: Profile): readonly string[] | undefined {
  const named = oauthUnsetKeys(key) ?? bearerUnsetKeys(key)
  if (named !== undefined) return named
  const bare = key.startsWith("auth.") ? key.slice("auth.".length) : undefined
  const auth: unknown = profile.auth
  return bare !== undefined && isRecord(auth) && Object.hasOwn(auth, bare) ? [bare] : undefined
}

/**
 * Removes keys from a profile: profile keys, or single OAuth settings or the bearer token of its
 * auth object (`audience`, `clientSecret`, `token`, ...; `auth` removes all auth settings), and
 * any key the profile or its auth object holds (`auth.<key>`), so a key the format refuses can
 * go. Unknown key names fail; keys of the format the profile does not set are ignored.
 */
export function unsetProfileKeys(
  file: ConfigFile | undefined,
  name: string,
  keys: readonly string[],
): ConfigFile {
  const current = file ?? EMPTY
  const profile = requireProfile(current, name)
  const authKeys = keys.flatMap((key) => authUnsetKeys(key, profile) ?? [])
  const plain = keys.filter((key) => authUnsetKeys(key, profile) === undefined)
  const removed = new Set<string>(plain.map((key) => profileKey(key, profile)))
  const { auth, ...kept }: Profile = Object.fromEntries(
    Object.entries(profile).filter(([key]) => !removed.has(key)),
  )
  const rest = withoutAuthKeys(isRecord(auth) ? auth : undefined, authKeys)
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
