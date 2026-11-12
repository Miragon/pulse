/**
 * What `pulse config list` and `pulse config show` print, pure: the profiles of both files with
 * the file each comes from (a refused one with why instead of its values), and the effective
 * configuration with the source of every value.
 */

import { PROFILE_NAME } from "@miragon/pulse-profile"
import { compact } from "../util.js"
import { refusalOf } from "./profile-file.js"
import { describeProblems } from "./profile-problems.js"
import { findProfile } from "./resolve.js"
import type {
  AuthConfig,
  ConfigFile,
  LoadedConfig,
  OAuthConfig,
  OutputFormat,
  ResolvedConfig,
  Source,
} from "./types.js"

/**
 * One row of `pulse config list`. Values the profile does not set are null; `scope` says
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
  /** Why a command cannot use the profile (its values are not shown then); absent when it can. */
  readonly problems?: string
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
 * Output of `pulse config show`: every effective value with its source (`auth` is the type,
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
  /** Why no profile applies to a `--url` without `--profile`; absent otherwise. */
  readonly noProfile?: string
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

const EMPTY: ConfigFile = { profiles: {} }

/** Profile names are unique, so two summaries never compare equal. */
function byName(a: ProfileSummary, b: ProfileSummary): number {
  return a.name < b.name ? -1 : 1
}

/** What `config list` shows of a profile: its values, or for a refused one why it is refused. */
function summaryValues(file: ConfigFile, name: string) {
  const profile = findProfile(file, name)
  if (profile === undefined) {
    const problems = describeProblems(refusalOf(file, name) ?? [])
    return { url: null, engine: null, auth: null, readOnly: false, problems }
  }
  return {
    url: profile.url ?? null,
    engine: profile.engine ?? null,
    auth: profile.auth?.type ?? (profile.auth?.username === undefined ? null : "basic"),
    readOnly: profile.readOnly === true,
  }
}

/**
 * Profiles sorted by name, with the file each comes from. A refused profile shows why instead of
 * its values; one whose name is no valid name is not listed (the name may be a secret pasted in
 * the wrong place): `config list` reports it on stderr.
 */
export function listProfiles(file: LoadedConfig | undefined): ProfileSummary[] {
  const current = file ?? EMPTY
  const fromProject = file?.project?.profiles ?? []
  return Object.keys(current.profiles)
    .filter((name) => PROFILE_NAME.test(name))
    .map((name) => {
      const { problems, ...values } = summaryValues(current, name)
      return {
        name,
        default: current.defaultProfile === name,
        ...values,
        scope: fromProject.includes(name) ? ("project" as const) : ("user" as const),
        ...compact({ problems }),
      }
    })
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
    ...compact({ noProfile: resolved.noProfile }),
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
