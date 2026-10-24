/** Configuration model: config file, profiles and the resolved effective configuration. */

export const OUTPUT_FORMATS = ["json", "table"] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/** The engines operate has an adapter for (`platform`); without one it uses `camunda7`. */
export const PLATFORMS = ["operaton", "cibseven", "camunda7"] as const
export type Platform = (typeof PLATFORMS)[number]
export const DEFAULT_PLATFORM: Platform = "camunda7"

export const AUTH_TYPES = ["none", "basic", "oauth", "bearer"] as const
export type AuthType = (typeof AUTH_TYPES)[number]

/**
 * Auth settings of a profile as stored in the config file. Without `type`, a `username` selects
 * Basic auth; OAuth needs `type: "oauth"` (it is never implied), a stored bearer token `type:
 * "bearer"`. `passwordEnv` / `clientSecretEnv` / `tokenEnv` name environment variables holding the
 * secret; a literal `password` / `clientSecret` / `token` is possible but discouraged. A profile
 * never mixes the keys of Basic auth, OAuth and bearer tokens.
 */
export interface ProfileAuth {
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

export const BASIC_AUTH_KEYS = [
  "username",
  "passwordEnv",
  "password",
] as const satisfies readonly (keyof ProfileAuth)[]

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
] as const satisfies readonly (keyof ProfileAuth)[]

/** Keys of a stored bearer token: the name of its variable, or the token itself. */
export const BEARER_AUTH_KEYS = [
  "tokenEnv",
  "token",
] as const satisfies readonly (keyof ProfileAuth)[]

/** Keys of a profile's auth object, in the order they are written to the config file. */
export const PROFILE_AUTH_KEYS = [
  "type",
  ...BASIC_AUTH_KEYS,
  ...OAUTH_AUTH_KEYS,
  ...BEARER_AUTH_KEYS,
] as const satisfies readonly (keyof ProfileAuth)[]

/** Scopes requested when neither OPERATE_OAUTH_SCOPES nor the profile sets them. */
export const DEFAULT_OAUTH_SCOPES = ["openid", "offline_access"] as const

/** Basic auth credentials and where each value came from. */
export interface BasicAuthConfig {
  readonly type: "basic"
  readonly username: string
  readonly password: string
  readonly sources: { readonly username: Source; readonly password: Source }
}

/**
 * OAuth 2.0 authorization code flow with PKCE. The issuer is discovered unless both
 * endpoints are configured; without a client secret the client is public.
 */
export interface OAuthConfig {
  readonly type: "oauth"
  readonly issuer?: string
  /** Both endpoints or neither. */
  readonly authorizationEndpoint?: string
  readonly tokenEndpoint?: string
  readonly clientId: string
  /** Absent: public client. */
  readonly clientSecret?: string
  readonly scopes: readonly string[]
  readonly audience?: string
  readonly redirectPort: number
  /** The selected profile. */
  readonly profile?: string
  /**
   * The login of the selected profile: profiles with the same key share one cached
   * login. Absent without a profile: the configuration from the environment has a login of its own.
   */
  readonly login?: LoginKey
  /** The directory of the project file the profile comes from: a person logs in there. */
  readonly projectDirectory?: string
  /** The config file named by `--config` or OPERATE_CONFIG the profile comes from. */
  readonly configFile?: string
  readonly sources: {
    readonly endpoints: Source
    readonly clientId: Source
    readonly clientSecret?: Source
    readonly scopes: Source
    readonly audience?: Source
    readonly redirectPort: Source
  }
}

/**
 * What makes profiles share an OAuth login: where the profile comes from and the
 * OAuth settings it stores, before the environment applies. The resolved settings still decide
 * whether a cached login fits (issuer, client, audience and scopes, `identityOf`).
 */
export interface LoginKey {
  /**
   * Where the profile comes from: `config:<path>` for the user's config file or the one named by
   * `--config` / OPERATE_CONFIG, `repository:<git directory>` for a project file in a repository
   * (shared by its worktrees), `project:<path>` for a project file outside one.
   */
  readonly origin: string
  /**
   * A profile that stores no `type: "oauth"` (OAuth selected by OPERATE_AUTH) has a login of its
   * own: its name. Absent for OAuth profiles, which share by their settings.
   */
  readonly profile?: string
  readonly issuer: string | null
  /** The token endpoint of explicit endpoints; null with discovery. */
  readonly tokenEndpoint: string | null
  readonly clientId: string | null
  readonly audience: string | null
  /** Sorted and deduplicated; the default scopes when the profile stores none. */
  readonly scopes: readonly string[]
}

/**
 * A bearer token obtained outside operate: sent as `Authorization: Bearer <token>`.
 * A token given as such is never refreshed and never stored; a token command is run
 * again when its token expires or is rejected.
 */
interface BearerBase {
  readonly type: "bearer"
  readonly source: Source
  /**
   * Where the token came from, for messages: `--auth-token-stdin`, `OPERATE_TOKEN`, `CI_TOKEN
   * (auth.tokenEnv of profile "p")`, `auth.token of profile "p"` or `OPERATE_TOKEN_COMMAND`.
   */
  readonly origin: string
  /** The variable that holds the token (OPERATE_TOKEN or the profile's tokenEnv), if any. */
  readonly variable?: string
  /** The selected profile. */
  readonly profile?: string
}

/** A bearer token given as such. */
export interface StaticBearerConfig extends BearerBase {
  /** Without a leading "Bearer " and surrounding blanks; an RFC 6750 b64token. */
  readonly token: string
  readonly command?: undefined
}

/**
 * A bearer token that the command line of OPERATE_TOKEN_COMMAND prints; the shell
 * runs it in the working directory.
 */
export interface CommandBearerConfig extends BearerBase {
  readonly command: string
  readonly token?: undefined
}

export type BearerAuthConfig = StaticBearerConfig | CommandBearerConfig

/**
 * No credentials. `off` says why when Basic auth or OAuth was switched off or a password is set
 * without a username (`Basic auth is switched off by OPERATE_AUTH=none`), for the hint of a 401.
 */
export interface NoAuthConfig {
  readonly type: "none"
  readonly off?: string
}

/** The resolved authentication: none, Basic auth credentials, OAuth settings or a bearer token. */
export type AuthConfig = NoAuthConfig | BasicAuthConfig | OAuthConfig | BearerAuthConfig

/**
 * A bearer token given by OPERATE_TOKEN or `--auth-token-stdin`, or the token command of
 * OPERATE_TOKEN_COMMAND (`command`), that the resolved auth type does not use (an explicit none,
 * basic or oauth); `config show` reports it. Never validated.
 */
export interface UnusedToken {
  readonly value: string
  /** `value` is a command line. */
  readonly command?: boolean
  readonly source: Source
  /** `Basic auth is selected by --auth basic`, `bearer auth is switched off by --auth none`. */
  readonly reason: string
}

export interface Profile {
  readonly url?: string
  readonly cockpitUrl?: string
  readonly engine?: string
  readonly platform?: Platform
  readonly auth?: ProfileAuth
  readonly output?: OutputFormat
  readonly timeout?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly readOnly?: boolean
}

/** Keys a profile may contain, in the order they are written to the config file. */
export const PROFILE_KEYS = [
  "url",
  "cockpitUrl",
  "engine",
  "platform",
  "auth",
  "output",
  "timeout",
  "headers",
  "readOnly",
] as const satisfies readonly (keyof Profile)[]
export type ProfileKey = (typeof PROFILE_KEYS)[number]

/**
 * The profile a command uses: none, or a profile of the config file with its name, where it comes
 * from (`LoginKey.origin`) and, when it comes from there, the project file.
 */
export type SelectedProfile =
  | {
      readonly name?: undefined
      readonly profile?: undefined
      readonly project?: undefined
      readonly origin?: undefined
      readonly configFile?: undefined
    }
  | {
      readonly name: string
      readonly profile: Profile
      readonly project?: ProjectSource
      readonly origin?: string
      /** The config file named by `--config` or OPERATE_CONFIG, when the profile comes from it. */
      readonly configFile?: string
    }

export interface ConfigFile {
  readonly defaultProfile?: string
  readonly profiles: Readonly<Record<string, Profile>>
}

/** A project file (`.operate.json`) whose profiles a command uses. */
export interface ProjectSource {
  readonly path: string
  /** Its directory: commands below it share the cached token of OPERATE_TOKEN_COMMAND. */
  readonly directory: string
  /** Where its profiles come from (`LoginKey.origin`): its repository, else the file itself. */
  readonly origin?: string
}

/**
 * The profiles a command sees: the config file named by `--config` or
 * OPERATE_CONFIG, else the project file merged with the user's config file (the user's profile
 * wins on a name clash; the project's defaultProfile wins when it names a profile of the project
 * file that the user's file does not override). Never written to a file.
 */
export interface LoadedConfig extends ConfigFile {
  /** Where the profiles of the config file come from (`config:<path>`, `LoginKey.origin`). */
  readonly origin?: string
  /** The absolute path of the config file when `--config` or OPERATE_CONFIG named it. */
  readonly configFile?: string
  readonly project?: {
    readonly source: ProjectSource
    /** The profiles that come from the project file (the user's file does not override them). */
    readonly profiles: readonly string[]
    /** True when `defaultProfile` is the project file's. */
    readonly defaultProfile: boolean
  }
}

/** Values given on the command line (raw strings, validated during resolution). */
export interface ConfigFlags {
  readonly url?: string
  readonly engine?: string
  readonly platform?: string
  readonly profile?: string
  readonly output?: string
  readonly timeout?: string
  readonly headers?: readonly string[]
  readonly readOnly?: boolean
  /** `--auth <type>` */
  readonly auth?: string
  /** `--auth-user <name>` */
  readonly authUser?: string
  /** The password read from stdin for `--auth-password-stdin`. */
  readonly authPassword?: string
  /** The bearer token read from stdin for `--auth-token-stdin`. */
  readonly authToken?: string
}

export type Source = "flag" | "env" | "profile" | "default"

export interface ResolvedConfig {
  readonly profile?: string
  readonly url: string
  readonly engine?: string
  readonly platform: Platform
  /** `sources.auth` is where the auth type came from; credentials carry their own sources. */
  readonly auth: AuthConfig
  /** Undefined means: choose by terminal (table on a TTY, JSON otherwise). */
  readonly output?: OutputFormat
  readonly timeoutMs: number
  readonly headers: Readonly<Record<string, string>>
  readonly readOnly: boolean
  readonly cockpitUrl?: string
  readonly sources: Readonly<Record<ResolvedKey, Source>>
  /** A bearer token that is set but not used by the resolved auth type. */
  readonly unusedToken?: UnusedToken
  /** The project file the selected profile comes from. */
  readonly project?: ProjectSource
}

type ResolvedKey =
  "url" | "engine" | "platform" | "auth" | "output" | "timeout" | "headers" | "readOnly"

export const DEFAULT_URL = "http://localhost:8080/engine-rest"
export const DEFAULT_TIMEOUT_MS = 30_000

export const ENV = {
  url: "OPERATE_URL",
  engine: "OPERATE_ENGINE",
  platform: "OPERATE_PLATFORM",
  profile: "OPERATE_PROFILE",
  config: "OPERATE_CONFIG",
  output: "OPERATE_OUTPUT",
  timeout: "OPERATE_TIMEOUT",
  auth: "OPERATE_AUTH",
  username: "OPERATE_USERNAME",
  password: "OPERATE_PASSWORD",
  oauthIssuer: "OPERATE_OAUTH_ISSUER",
  oauthAuthorizationEndpoint: "OPERATE_OAUTH_AUTHORIZATION_ENDPOINT",
  oauthTokenEndpoint: "OPERATE_OAUTH_TOKEN_ENDPOINT",
  oauthClientId: "OPERATE_OAUTH_CLIENT_ID",
  oauthClientSecret: "OPERATE_OAUTH_CLIENT_SECRET",
  oauthScopes: "OPERATE_OAUTH_SCOPES",
  oauthAudience: "OPERATE_OAUTH_AUDIENCE",
  oauthRedirectPort: "OPERATE_OAUTH_REDIRECT_PORT",
  token: "OPERATE_TOKEN",
  tokenCommand: "OPERATE_TOKEN_COMMAND",
  headers: "OPERATE_HEADERS",
  readOnly: "OPERATE_READ_ONLY",
} as const
