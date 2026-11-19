/**
 * `pulse config set` changes of a profile's auth object: the type,
 * the Basic auth username and password (stored as the name of an environment variable,
 * recommended, or literally), the OAuth settings (oauth-edit.ts) and the bearer token
 * (bearer-edit.ts). Only given values change; a passwordEnv replaces a stored password and the
 * other way round. The options of one family (or its type) drop the stored keys of the other
 * families, and a profile never keeps credentials and an Authorization header together
 * (`settleAuthorization`).
 */

import { compact, isRecord } from "../util.js"
import { validateAuthType, validatePassword, validateUsername } from "./auth.js"
import { hasBearerKeys } from "./bearer.js"
import { type BearerChanges, changedBearerKeys, hasBearerOptions } from "./bearer-edit.js"
import { configError } from "./config-error.js"
import { hasAuthorization } from "./headers.js"
import { hasOAuthKeys } from "./oauth.js"
import { changedOAuthKeys, hasOAuthOptions, type OAuthChanges } from "./oauth-edit.js"
import {
  type AuthType,
  BASIC_AUTH_KEYS,
  DEFAULT_FLAVOR,
  DIALECT_AUTH_TYPES,
  PROFILE_AUTH_KEYS,
  PROFILE_AUTH_TYPES,
  PROFILE_FLAVORS,
  type Profile,
  type ProfileAuth,
} from "./types.js"
import { PASSWORD_VARIABLE, validateVariableName } from "./variable.js"

export interface AuthChanges extends OAuthChanges, BearerChanges {
  readonly auth?: string
  readonly authUser?: string
  readonly authPasswordEnv?: string
  readonly authPassword?: string
}

/** The kinds of credentials a profile can store; one at a time. */
export type Family = "basic" | "oauth" | "bearer"
type Secret = Pick<ProfileAuth, "password" | "passwordEnv">

const FAMILIES: readonly Family[] = ["basic", "oauth", "bearer"]

/** How messages name the auth of a family (`OAuth replaces them`). */
export const FAMILY_NAMES: Readonly<Record<Family, string>> = {
  basic: "Basic auth",
  oauth: "OAuth",
  bearer: "bearer auth",
}

/** How messages name the options and settings of a family (`bearer token options`). */
export const SETTING_NAMES: Readonly<Record<Family, string>> = {
  basic: "Basic auth",
  oauth: "OAuth",
  bearer: "bearer token",
}

const BASIC_OPTIONS = ["authUser", "authPasswordEnv", "authPassword"] as const

function hasBasicOptions(changes: AuthChanges): boolean {
  return BASIC_OPTIONS.some((key) => changes[key] !== undefined)
}

const HAS_OPTIONS: Readonly<Record<Family, (changes: AuthChanges) => boolean>> = {
  basic: hasBasicOptions,
  oauth: hasOAuthOptions,
  bearer: hasBearerOptions,
}

/** The families whose options were given. */
function givenFamilies(changes: AuthChanges): Family[] {
  return FAMILIES.filter((family) => HAS_OPTIONS[family](changes))
}

/** True when any auth option (type, Basic auth, OAuth or bearer token) was given. */
export function hasAuthOptions(changes: AuthChanges): boolean {
  return changes.auth !== undefined || givenFamilies(changes).length > 0
}

/** The auth type of Camunda 8's client credentials, which another Pulse client serves. */
const CLIENT_CREDENTIALS = "clientCredentials" satisfies (typeof PROFILE_AUTH_TYPES)[number]

/**
 * Refuses to edit one auth setting of a profile that signs in with client credentials, which
 * another Pulse client serves and the CLI does not: the CLI knows none of their rules and could
 * not put a removed setting back. `config unset <profile> auth` still removes the whole object.
 * The MCP server's passthrough holds no setting, so an auth option replaces it, and a type no
 * client knows stays for an auth option to repair.
 */
export function checkAuthType(auth: unknown, name: string): void {
  if (!isRecord(auth) || auth.type !== CLIENT_CREDENTIALS) return
  throw configError(
    `Profile "${name}" signs in with ${CLIENT_CREDENTIALS}, which the CLI does not edit`,
    `Edit its auth in the file, or remove all its auth settings with \`pulse config unset ${name} auth\`.`,
  )
}

type ProfileFlavor = keyof typeof PROFILE_FLAVORS
type ProfileAuthType = (typeof PROFILE_AUTH_TYPES)[number]

function isProfileFlavor(value: unknown): value is ProfileFlavor {
  return typeof value === "string" && Object.hasOwn(PROFILE_FLAVORS, value)
}

function isProfileAuthType(value: unknown): value is ProfileAuthType {
  return PROFILE_AUTH_TYPES.some((type) => type === value)
}

/** The flavor of a profile and the auth type it names, as the file holds them. */
interface FlavorAuth {
  readonly flavor: ProfileFlavor
  readonly type: ProfileAuthType
}

/** The flavor and auth type of `profile` when the API of the flavor does not take the type. */
function outsideDialect(profile: Profile | undefined): FlavorAuth | undefined {
  const flavor: unknown = profile?.flavor ?? DEFAULT_FLAVOR
  const auth: unknown = profile?.auth
  const type = isRecord(auth) ? auth.type : undefined
  if (!isProfileFlavor(flavor) || !isProfileAuthType(type)) return undefined
  const taken: readonly ProfileAuthType[] = DIALECT_AUTH_TYPES[PROFILE_FLAVORS[flavor]]
  return taken.includes(type) ? undefined : { flavor, type }
}

/**
 * Refuses an edit that gives a profile an auth type the API of its flavor does not take (an OAuth
 * login on camunda8, client credentials on a Camunda 7 flavor), which every Pulse client would
 * refuse. A profile the file already holds that way stays editable, so an edit can repair it.
 */
export function checkDialect(before: Profile | undefined, after: Profile, name: string): void {
  const outside = outsideDialect(after)
  if (outside === undefined || outsideDialect(before) !== undefined) return
  const { flavor, type } = outside
  const taken = DIALECT_AUTH_TYPES[PROFILE_FLAVORS[flavor]]
  throw configError(
    `Profile "${name}" would sign in with ${type}, which its flavor ${flavor} does not take`,
    `Flavor ${flavor} takes the auth types ${taken.join(", ")}: choose one of them with --auth, or remove all auth settings with \`pulse config unset ${name} auth\` first.`,
  )
}

function secretOf(existing: ProfileAuth | undefined, changes: AuthChanges): Secret {
  const { authPasswordEnv, authPassword } = changes
  if (authPasswordEnv !== undefined && authPassword !== undefined) {
    throw configError(
      "--auth-password-env and --auth-password-stdin exclude each other",
      "Store the name of the environment variable that holds the password (recommended), or the password itself.",
    )
  }
  if (authPasswordEnv !== undefined) {
    return { passwordEnv: validateVariableName(authPasswordEnv, PASSWORD_VARIABLE) }
  }
  if (authPassword !== undefined) {
    return { password: validatePassword(authPassword, "from --auth-password-stdin") }
  }
  return compact({ passwordEnv: existing?.passwordEnv, password: existing?.password })
}

function basicKeys(existing: ProfileAuth | undefined, changes: AuthChanges): Partial<ProfileAuth> {
  const { authUser } = changes
  const username =
    authUser === undefined
      ? existing?.username
      : validateUsername(authUser.trim(), "from --auth-user")
  return { ...compact({ username }), ...secretOf(existing, changes) }
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

/** Options of several families, or of a family the explicit type does not use: CONFIG. */
function checkFamilies(type: AuthType | undefined, families: readonly Family[]): void {
  if (families.length > 1) {
    throw configError(
      `${families.map((family) => SETTING_NAMES[family]).join(" options and ")} options exclude each other`,
      "A profile uses Basic auth (--auth basic --auth-user <name> --auth-password-env <VAR>), OAuth (--auth oauth --oauth-issuer <url> --oauth-client-id <id>) or a bearer token (--auth bearer --auth-token-env <VAR>).",
    )
  }
  const [family] = families
  if (family !== undefined && type !== undefined && type !== "none" && type !== family) {
    throw configError(
      `${capitalized(SETTING_NAMES[family])} options need --auth ${family}, not --auth ${type}`,
    )
  }
}

/**
 * The stored type: `--auth` if given; else bearer token or OAuth options select their type; else
 * Basic auth options select basic, also for a profile stored without a type or with another one
 * (none, oauth, bearer), so a written profile always states its type.
 */
function typeOf(existing: ProfileAuth | undefined, changes: AuthChanges): AuthType | undefined {
  if (changes.auth !== undefined) return validateAuthType(changes.auth.trim())
  if (hasBearerOptions(changes)) return "bearer"
  if (hasOAuthOptions(changes)) return "oauth"
  return hasBasicOptions(changes) ? "basic" : existing?.type
}

/** The family the change is about; its keys stay, the other families' keys are dropped. */
function familyOf(type: AuthType | undefined, changes: AuthChanges): Family | undefined {
  const [given] = givenFamilies(changes)
  if (given !== undefined) return given
  return FAMILIES.find((family) => family === type)
}

/** The keys of a stored auth object that the format does not know, as the file holds them. */
function unknownKeys(existing: ProfileAuth | undefined) {
  const known: readonly string[] = PROFILE_AUTH_KEYS
  return Object.entries(existing ?? {}).filter(([key]) => !known.includes(key))
}

/**
 * The changed auth object of a profile, or undefined when no auth option was given. Keys the
 * format does not know stay behind the known ones, as the file held them: they still refuse the
 * profile until `config unset <profile> auth.<key>` removes them, never silently.
 */
export function changedAuth(
  existing: ProfileAuth | undefined,
  changes: AuthChanges,
): ProfileAuth | undefined {
  if (!hasAuthOptions(changes)) return undefined
  const type = typeOf(existing, changes)
  checkFamilies(changes.auth === undefined ? undefined : type, givenFamilies(changes))
  const family = familyOf(type, changes)
  const keeps = (candidate: Family) => family === undefined || family === candidate
  const merged: ProfileAuth = {
    ...compact({ type }),
    ...(keeps("basic") ? basicKeys(existing, changes) : {}),
    ...(keeps("oauth") ? changedOAuthKeys(existing, changes) : {}),
    ...(keeps("bearer") ? changedBearerKeys(existing, changes) : {}),
  }
  return {
    ...compact(Object.fromEntries(PROFILE_AUTH_KEYS.map((key) => [key, merged[key]]))),
    ...Object.fromEntries(unknownKeys(existing)),
  }
}

function hasBasicKeys(auth: ProfileAuth | undefined): boolean {
  return BASIC_AUTH_KEYS.some((key) => auth?.[key] !== undefined)
}

const HAS_KEYS: Readonly<Record<Family, (auth: ProfileAuth | undefined) => boolean>> = {
  basic: hasBasicKeys,
  oauth: hasOAuthKeys,
  bearer: hasBearerKeys,
}

/**
 * The family whose settings `config set` removed (another family replaced them), for the
 * notice on stderr; undefined when nothing was removed.
 */
export function replacedFamily(
  before: ProfileAuth | undefined,
  after: ProfileAuth | undefined,
): Family | undefined {
  return FAMILIES.find((family) => HAS_KEYS[family](before) && !HAS_KEYS[family](after))
}

/**
 * The family of the settings a profile stores: by its type, else (type none) by its keys; for the
 * notices of `config set`.
 */
export function settingsFamily(auth: ProfileAuth | undefined): Family | undefined {
  return storedFamily(auth) ?? FAMILIES.find((family) => HAS_KEYS[family](auth))
}

/** The family a stored profile's credentials belong to, by its type (a username: basic). */
export function storedFamily(auth: ProfileAuth | undefined): Family | undefined {
  if (usesBasicAuth(auth)) return "basic"
  return FAMILIES.find((family) => family === auth?.type)
}

/** True when a stored profile selects Basic auth: type basic, or a username without a type. */
export function usesBasicAuth(auth: ProfileAuth | undefined): boolean {
  return auth?.type === undefined ? auth?.username !== undefined : auth.type === "basic"
}

/** True when a stored profile sends credentials: Basic auth, OAuth or a bearer token. */
export function usesCredentials(auth: ProfileAuth | undefined): boolean {
  return storedFamily(auth) !== undefined
}

function isAuthorizationHeader(header: string): boolean {
  return header.slice(0, header.indexOf(":")).trim().toLowerCase() === "authorization"
}

function withoutAuthorization(profile: Profile): Profile {
  const headers = Object.entries(profile.headers ?? {}).filter(
    ([name]) => name.toLowerCase() !== "authorization",
  )
  return compact({
    ...profile,
    headers: headers.length > 0 ? Object.fromEntries(headers) : undefined,
  })
}

/**
 * Credentials (Basic auth, OAuth or a bearer token) and an Authorization header in one profile
 * would make every command fail. Auth options given without an Authorization header replace a
 * stored one (the upgrade path from `Authorization: Basic ...` or bearer token headers; the CLI
 * says so); every other combination is a CONFIG error. `--auth none` keeps a header and the
 * stored credentials.
 */
export function settleAuthorization(
  profile: Profile,
  changes: AuthChanges & { readonly headers?: readonly string[] },
  name: string,
): Profile {
  const type = storedFamily(profile.auth)
  if (type === undefined || !hasAuthorization(profile.headers ?? {})) return profile
  if (hasAuthOptions(changes) && changes.headers?.some(isAuthorizationHeader) !== true) {
    return withoutAuthorization(profile)
  }
  const family = FAMILY_NAMES[type]
  throw configError(
    `Profile "${name}" would have both ${family} and an Authorization header`,
    `Keep one: ${family} options replace a stored Authorization header (\`pulse config set ${name} --auth ${type}\`); --auth none switches ${family} off and keeps the header (\`pulse config set ${name} --auth none -H 'Authorization: ...'\`).`,
  )
}

/** True when `config set` removed the Authorization header of the profile (`settleAuthorization`). */
export function replacedAuthorization(before: Profile | undefined, after: Profile | undefined) {
  return hasAuthorization(before?.headers ?? {}) && !hasAuthorization(after?.headers ?? {})
}
