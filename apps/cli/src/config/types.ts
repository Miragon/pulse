/** Configuration model: config file, profiles and the resolved effective configuration. */

export const OUTPUT_FORMATS = ["json", "table"] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/** The engine vendors pulse-cli has an adapter for (`flavor`); without one it uses `camunda7`. */
export const FLAVORS = ["operaton", "cibseven", "camunda7"] as const
export type Flavor = (typeof FLAVORS)[number]
export const DEFAULT_FLAVOR: Flavor = "camunda7"

export const AUTH_TYPES = ["none", "basic", "bearer"] as const
export type AuthType = (typeof AUTH_TYPES)[number]

/**
 * Auth settings of a profile as stored in the config file. Without `type`, a `username` selects
 * Basic auth, a stored bearer token needs `type: "bearer"`. `passwordEnv` / `tokenEnv` name
 * environment variables holding the secret; a literal `password` / `token` is possible but
 * discouraged. A profile never mixes the keys of Basic auth and bearer tokens.
 */
export interface ProfileAuth {
  readonly type?: AuthType
  readonly username?: string
  readonly passwordEnv?: string
  readonly password?: string
  readonly tokenEnv?: string
  readonly token?: string
}

export const BASIC_AUTH_KEYS = [
  "username",
  "passwordEnv",
  "password",
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
  ...BEARER_AUTH_KEYS,
] as const satisfies readonly (keyof ProfileAuth)[]

/** Basic auth credentials and where each value came from. */
export interface BasicAuthConfig {
  readonly type: "basic"
  readonly username: string
  readonly password: string
  readonly sources: { readonly username: Source; readonly password: Source }
}

/**
 * A bearer token obtained outside pulse-cli: sent as `Authorization: Bearer <token>`.
 * A token given as such is never refreshed and never stored; a token command is run
 * again when its token expires or is rejected.
 */
interface BearerBase {
  readonly type: "bearer"
  readonly source: Source
  /**
   * Where the token came from, for messages: `--auth-token-stdin`, `PULSE_CLI_TOKEN`, `CI_TOKEN
   * (auth.tokenEnv of profile "p")`, `auth.token of profile "p"` or `PULSE_CLI_TOKEN_COMMAND`.
   */
  readonly origin: string
  /** The variable that holds the token (PULSE_CLI_TOKEN or the profile's tokenEnv), if any. */
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
 * A bearer token that the command line of PULSE_CLI_TOKEN_COMMAND prints; the shell
 * runs it in the working directory.
 */
export interface CommandBearerConfig extends BearerBase {
  readonly command: string
  readonly token?: undefined
}

export type BearerAuthConfig = StaticBearerConfig | CommandBearerConfig

/**
 * No credentials. `off` says why when Basic auth was switched off or a password is set
 * without a username (`Basic auth is switched off by PULSE_CLI_AUTH=none`), for the hint of a 401.
 */
export interface NoAuthConfig {
  readonly type: "none"
  readonly off?: string
}

/** The resolved authentication: none, Basic auth credentials or a bearer token. */
export type AuthConfig = NoAuthConfig | BasicAuthConfig | BearerAuthConfig

/**
 * A bearer token given by PULSE_CLI_TOKEN or `--auth-token-stdin`, or the token command of
 * PULSE_CLI_TOKEN_COMMAND (`command`), that the resolved auth type does not use (an explicit none,
 * or basic); `config show` reports it. Never validated.
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
  readonly flavor?: Flavor
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
  "flavor",
  "auth",
  "output",
  "timeout",
  "headers",
  "readOnly",
] as const satisfies readonly (keyof Profile)[]
export type ProfileKey = (typeof PROFILE_KEYS)[number]

/**
 * The profile a command uses: none, or a profile of the config file with its name and, when it
 * comes from there, the project file.
 */
export type SelectedProfile =
  | {
      readonly name?: undefined
      readonly profile?: undefined
      readonly project?: undefined
    }
  | {
      readonly name: string
      readonly profile: Profile
      readonly project?: ProjectSource
    }

export interface ConfigFile {
  readonly defaultProfile?: string
  readonly profiles: Readonly<Record<string, Profile>>
}

/** A project file (`.pulse-cli.json`) whose profiles a command uses. */
export interface ProjectSource {
  readonly path: string
  /** Its directory: commands below it share the cached token of PULSE_CLI_TOKEN_COMMAND. */
  readonly directory: string
}

/**
 * The profiles a command sees: the config file named by `--config` or
 * PULSE_CLI_CONFIG, else the project file merged with the user's config file (the user's profile
 * wins on a name clash; the project's defaultProfile wins when it names a profile of the project
 * file that the user's file does not override). Never written to a file.
 */
export interface LoadedConfig extends ConfigFile {
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
  readonly flavor?: string
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
  readonly flavor: Flavor
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
  "url" | "engine" | "flavor" | "auth" | "output" | "timeout" | "headers" | "readOnly"

export const DEFAULT_URL = "http://localhost:8080/engine-rest"
export const DEFAULT_TIMEOUT_MS = 30_000

/** The prefix of every environment variable pulse-cli reads (never bare PULSE_, PulseAudio's). */
export const ENV_PREFIX = "PULSE_CLI_"

export const ENV = {
  url: "PULSE_CLI_URL",
  engine: "PULSE_CLI_ENGINE",
  flavor: "PULSE_CLI_FLAVOR",
  profile: "PULSE_CLI_PROFILE",
  config: "PULSE_CLI_CONFIG",
  output: "PULSE_CLI_OUTPUT",
  timeout: "PULSE_CLI_TIMEOUT",
  auth: "PULSE_CLI_AUTH",
  username: "PULSE_CLI_USERNAME",
  password: "PULSE_CLI_PASSWORD",
  token: "PULSE_CLI_TOKEN",
  tokenCommand: "PULSE_CLI_TOKEN_COMMAND",
  headers: "PULSE_CLI_HEADERS",
  readOnly: "PULSE_CLI_READ_ONLY",
} as const
