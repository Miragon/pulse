/**
 * Resolves the authentication (design §15, §16, §18). Type: `--auth` > OPERATE_AUTH > the
 * profile's auth.type; without a type anywhere, a username from any source or
 * `--auth-password-stdin` selects Basic auth, a token from `--auth-token-stdin` or OPERATE_TOKEN
 * selects bearer auth (both at once is a CONFIG error), otherwise none (OAuth is never implied;
 * resolve-oauth.ts resolves it, resolve-bearer.ts the bearer token). Username: `--auth-user` >
 * OPERATE_USERNAME > the profile's auth.username. Password: `--auth-password-stdin` >
 * OPERATE_PASSWORD > the variable named by the profile's auth.passwordEnv > the profile's
 * auth.password. Basic auth needs both values; errors never show a secret.
 */

import type { OperateError } from "../errors.js"
import { compact } from "../util.js"
import { validateAuthType, validatePassword, validateUsername } from "./auth.js"
import { hasBearerKeys } from "./bearer.js"
import { configError } from "./config-error.js"
import { hasOAuthKeys } from "./oauth.js"
import { type Env, nonEmpty, pick } from "./pick.js"
import {
  type BearerSource,
  bearerSource,
  givenToken,
  inferenceConflict,
  mentioningUnused,
  resolveBearer,
  tokenNoun,
  unusedToken,
  unusedTokenNote,
} from "./resolve-bearer.js"
import { oauthEnvVariable, resolveOAuth } from "./resolve-oauth.js"
import {
  type AuthConfig,
  type AuthType,
  type ConfigFlags,
  ENV,
  type NoAuthConfig,
  type ProfileAuth,
  type SelectedProfile,
  type Source,
  type UnusedToken,
} from "./types.js"
import { PASSWORD_VARIABLE, unsetVariable } from "./variable.js"

interface Context {
  readonly flags: ConfigFlags
  readonly env: Env
  readonly selected: SelectedProfile
  readonly authCommand?: boolean
}

/** A value, its source and where exactly it came from, for messages (which never show values). */
interface Found<T> {
  readonly value: T
  readonly source: Source
  readonly label: string
}

export interface ResolvedAuth {
  readonly auth: AuthConfig
  /** Where the type came from; for a type implied by a username or token, its source. */
  readonly source: Source
  /** OPERATE_TOKEN (or a switched off `--auth-token-stdin`) that the type does not use. */
  readonly unusedToken?: UnusedToken
}

type Credential = "username" | "password"

/** A password value: blank counts as unset, other values are kept exactly (spaces included). */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value
}

function found<T>(value: T | undefined, source: Source, label: string): Found<T> | undefined {
  return value === undefined ? undefined : { value, source, label }
}

/** A value of the selected profile's auth object; `label` gets the profile name. */
function fromProfile<T>(
  selected: SelectedProfile,
  read: (auth: ProfileAuth) => T | undefined,
  label: (profile: string) => string,
): Found<T> | undefined {
  if (selected.profile === undefined) return undefined
  return found(read(selected.profile.auth ?? {}), "profile", label(`profile "${selected.name}"`))
}

/**
 * The variable named by auth.passwordEnv; it must be set. Its name is repeated only in the usual
 * form (`unsetVariable`): a password typed in its place must not show up in the error.
 */
function passwordFromEnv(variable: string, name: string, env: Env): string {
  const value = present(env[variable])
  if (value !== undefined) return value
  throw unsetVariable(variable, name, PASSWORD_VARIABLE)
}

/** The password of the profile: from the variable it names, else stored literally. */
function storedPassword({ env, selected }: Context): Found<string> | undefined {
  if (selected.profile === undefined) return undefined
  const { name, profile } = selected
  const variable = profile.auth?.passwordEnv
  if (variable === undefined) {
    return found(present(profile.auth?.password), "profile", `auth.password of profile "${name}"`)
  }
  const label = `from ${variable}, auth.passwordEnv of profile "${name}"`
  return { value: passwordFromEnv(variable, name, env), source: "profile", label }
}

/** Where the type was set (`--auth none`, `OPERATE_AUTH=basic`, ...), for messages. */
function typeLabel(source: Source, type: AuthType, profile: string | undefined): string {
  if (source === "flag") return `--auth ${type}`
  if (source === "env") return `${ENV.auth}=${type}`
  return `the auth.type of profile "${profile ?? ""}"`
}

/** The explicit type; its label says where it was set. */
function pickType({ flags, env, selected }: Context): Found<AuthType> | undefined {
  const picked = pick(nonEmpty(flags.auth), nonEmpty(env[ENV.auth]), selected.profile?.auth?.type)
  if (picked.value === undefined) return undefined
  const value = validateAuthType(picked.value)
  return { value, source: picked.source, label: typeLabel(picked.source, value, selected.name) }
}

function pickUsername({ flags, env, selected }: Context): Found<string> | undefined {
  return (
    found(nonEmpty(flags.authUser), "flag", "from --auth-user") ??
    found(nonEmpty(env[ENV.username]), "env", `from ${ENV.username}`) ??
    fromProfile(
      selected,
      (auth) => nonEmpty(auth.username),
      (profile) => `auth.username of ${profile}`,
    )
  )
}

function pickPassword(context: Context): Found<string> | undefined {
  const { flags, env } = context
  return (
    found(present(flags.authPassword), "flag", "from --auth-password-stdin") ??
    found(present(env[ENV.password]), "env", `from ${ENV.password}`) ??
    storedPassword(context)
  )
}

/** The sources looked up for a value, for the error about missing credentials. */
function lookedUp(credential: Credential, selected: SelectedProfile): string {
  const flag = credential === "username" ? "--auth-user" : "--auth-password-stdin"
  const keys = credential === "username" ? "auth.username" : "auth.passwordEnv or auth.password"
  const profile =
    selected.profile === undefined
      ? "a profile (none is selected)"
      : `the ${keys} of profile "${selected.name}"`
  return `the ${credential} in ${flag}, ${ENV[credential]} and ${profile}`
}

function missingError(missing: readonly Credential[], selectedBy: string, context: Context) {
  const values = missing.map((credential) => `the ${credential}`).join(" and ")
  const places = missing.map((credential) => lookedUp(credential, context.selected))
  return configError(
    `Basic auth is selected but ${values} ${missing.length > 1 ? "are" : "is"} missing`,
    `Basic auth was selected by ${selectedBy}. Looked up ${places.join("; ")}. Pipe the password into --auth-password-stdin, set ${ENV.username} and ${ENV.password}, or store them with \`operate config set <profile> --auth basic --auth-user <name> --auth-password-env <VAR>\`; --auth none switches Basic auth off.`,
  )
}

function basicAuth(
  username: Found<string> | undefined,
  selectedBy: string,
  context: Context,
): AuthConfig {
  const password = pickPassword(context)
  if (username === undefined || password === undefined) {
    const missing = (["username", "password"] as const).filter(
      (credential) => (credential === "username" ? username : password) === undefined,
    )
    throw missingError(missing, selectedBy, context)
  }
  return {
    type: "basic",
    username: validateUsername(username.value, username.label),
    password: validatePassword(password.value, password.label),
    sources: { username: username.source, password: password.source },
  }
}

/**
 * Basic auth selected without a type: by a username (from any source), else by
 * `--auth-password-stdin`, which reads stdin for nothing else. The label names the source.
 */
function impliedBasic(
  username: Found<string> | undefined,
  flags: ConfigFlags,
): Found<AuthType> | undefined {
  if (username !== undefined) {
    const label = `a username (${username.label}) without an auth type`
    return { value: "basic", source: username.source, label }
  }
  return present(flags.authPassword) === undefined
    ? undefined
    : { value: "basic", source: "flag", label: "--auth-password-stdin without an auth type" }
}

/**
 * The type without an explicit one: Basic auth (`impliedBasic`), or bearer auth for a token of
 * `--auth-token-stdin` or OPERATE_TOKEN. Both at once is a CONFIG error.
 */
function impliedType(
  username: Found<string> | undefined,
  context: Context,
): Found<AuthType> | undefined {
  const basic = impliedBasic(username, context.flags)
  const token = givenToken(context)
  if (token === undefined) return basic
  if (basic !== undefined) {
    const by = username === undefined ? "--auth-password-stdin" : `A username (${username.label})`
    throw inferenceConflict(by, token)
  }
  const label = `${tokenNoun(token)} (from ${token.origin}) without an auth type`
  return { value: "bearer", source: token.source, label }
}

/** Where a password is set that nothing uses (no username, no type); never reads a variable. */
function unusedPassword({ env, selected }: Context): string | undefined {
  if (present(env[ENV.password]) !== undefined) return `from ${ENV.password}`
  if (selected.profile === undefined) return undefined
  const { name, profile } = selected
  if (profile.auth?.passwordEnv !== undefined) return `auth.passwordEnv of profile "${name}"`
  return profile.auth?.password === undefined ? undefined : `auth.password of profile "${name}"`
}

/** Why nothing is sent although settings exist: an unused password, or OAuth env values. */
function unusedSettings(context: Context): string | undefined {
  const password = unusedPassword(context)
  if (password !== undefined) return `a password is set (${password}), but no username`
  const variable = oauthEnvVariable(context.env)
  return variable === undefined
    ? undefined
    : `OAuth settings are set (from ${variable}), but no auth type selects OAuth; set ${ENV.auth}=oauth or --auth oauth`
}

/** What an explicit none switches off: stored OAuth settings, a bearer token, else Basic auth. */
function offFamily(context: Context): string {
  const auth = context.selected.profile?.auth
  if (hasOAuthKeys(auth)) return "OAuth"
  return hasBearerKeys(auth) || givenToken(context) !== undefined ? "Bearer auth" : "Basic auth"
}

/**
 * No credentials, and why when that may surprise: an explicit none (switching off the OAuth
 * settings of the profile, else Basic auth), an unused password or OAuth values in the env.
 */
function withoutAuth(type: Found<AuthType> | undefined, context: Context): NoAuthConfig {
  if (type !== undefined) {
    return { type: "none", off: `${offFamily(context)} is switched off by ${type.label}` }
  }
  const off = unusedSettings(context)
  return off === undefined ? { type: "none" } : { type: "none", off }
}

function authOf(
  type: Found<AuthType> | undefined,
  username: Found<string> | undefined,
  context: Context,
): AuthConfig {
  switch (type?.value) {
    case "oauth":
      return resolveOAuth(context, type.label)
    case "bearer":
      return resolveBearer(context, type.label)
    case "basic":
      return basicAuth(username, type.label, context)
    default:
      return withoutAuth(type, context)
  }
}

/** `authCommand`: for `operate auth` commands, whose hints never suggest `--auth`. */
export function resolveAuth(
  flags: ConfigFlags,
  env: Env,
  selected: SelectedProfile,
  authCommand = false,
): ResolvedAuth {
  const context: Context = { flags, env, selected, authCommand }
  const explicit = pickType(context)
  const username = pickUsername(context)
  const type = explicit ?? impliedType(username, context)
  const unused =
    explicit === undefined || explicit.value === "bearer"
      ? undefined
      : unusedToken(context, explicit.value, explicit.label)
  const note = unused === undefined ? undefined : unusedTokenNote(unused, authCommand)
  return {
    auth: mentioningUnused(note, () => authOf(type, username, context)),
    source: type?.source ?? "default",
    ...compact({ unusedToken: unused }),
  }
}

function headerOrigin(source: Source, profile: string | undefined): string {
  if (source === "flag") return "given with -H/--header"
  if (source === "env") return `from ${ENV.headers}`
  const name = profile ?? "<profile>"
  return `from the headers of profile "${name}"; \`operate config unset ${name} headers\` removes them`
}

/** The credentials of an auth type, and what operate sends in the Authorization header. */
const CREDENTIALS: Readonly<Record<Exclude<AuthType, "none">, readonly [string, string]>> = {
  basic: ["Basic auth", "with Basic auth, operate sends the credentials in it"],
  oauth: ["OAuth", "with OAuth, operate sends the access token in it"],
  bearer: ["Bearer auth", "with bearer auth, operate sends the token in it"],
}

/**
 * Basic auth, OAuth or a bearer token and an explicit Authorization header (`-H`,
 * OPERATE_HEADERS, profile headers) would fight over the same header: a CONFIG error asks to drop
 * one. For `operate auth` commands (`authCommand`) only the header can go.
 */
export function authorizationConflict(
  auth: AuthConfig,
  authorization: Source | undefined,
  profile: string | undefined,
  authCommand = false,
): OperateError | undefined {
  if (auth.type === "none" || authorization === undefined) return undefined
  const [name, sent] = CREDENTIALS[auth.type]
  const origin = headerOrigin(authorization, profile)
  return configError(
    `${name} and an Authorization header are both configured`,
    authCommand
      ? `Remove the Authorization header (${origin}): ${sent}.`
      : `Drop one: remove the Authorization header (${origin}), or switch ${name} off with --auth none, ${ENV.auth}=none or \`operate config unset ${profile ?? "<profile>"} auth\`.`,
  )
}

/**
 * The auth type of `selectedAuth`; `label` says what selected it (`OPERATE_AUTH=basic`), `token`
 * where the token of bearer auth would come from.
 */
export interface SelectedAuth {
  readonly type: AuthType
  readonly source: Source
  readonly label: string
  readonly token?: BearerSource
}

/**
 * The auth type a command would use and where it came from, without resolving credentials (no
 * password or token variable is read, no command is run): the explicit type, else basic for a
 * username or `--auth-password-stdin`, bearer for a token of `--auth-token-stdin` or
 * OPERATE_TOKEN or for OPERATE_TOKEN_COMMAND, else none (source default). Undefined for an unknown
 * type or an inference conflict (resolution reports them).
 */
export function selectedAuth(
  flags: ConfigFlags,
  env: Env,
  selected: SelectedProfile,
): SelectedAuth | undefined {
  const context: Context = { flags, env, selected }
  try {
    const type = pickType(context) ?? impliedType(pickUsername(context), context)
    if (type === undefined) return { type: "none", source: "default", label: "no auth settings" }
    const token = type.value === "bearer" ? bearerSource(context) : undefined
    return { type: type.value, source: type.source, label: type.label, ...compact({ token }) }
  } catch {
    return undefined
  }
}
