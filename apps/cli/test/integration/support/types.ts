/** The parts of CLI and engine responses that the integration tests look at. */

export interface PingOutput {
  readonly url: string
  readonly reachable: boolean
  readonly version: string
  readonly engines: readonly string[]
  /** Auth type: `none`, `basic`, `oauth` or `bearer`. */
  readonly auth: string
  /**
   * The username with `basic`; with `oauth` the logged-in user (null when unknown); with `bearer`
   * the `preferred_username` of a JWT.
   */
  readonly user?: string | null
  /** With `bearer` and a JWT: its `sub` (`user` is its `preferred_username`). */
  readonly subject?: string | null
}

/**
 * `pulse-cli auth status` of a bearer token: where it came from and, for a JWT, what its
 * claims say (no signature check); never the token.
 */
export interface BearerStatusOutput {
  readonly type: "bearer"
  readonly profile: string | null
  /** `flag`, `env` or `profile`. */
  readonly source: string
  /** `PULSE_CLI_TOKEN`, `--auth-token-stdin`, `IT_TOKEN (auth.tokenEnv of profile "p")`, ... */
  readonly origin: string
  /** The token command that printed the token, else null. */
  readonly command: string | null
  /** The token of the command came from pulse-cli's cache. */
  readonly cached: boolean
  readonly format: "jwt" | "opaque"
  /** `sub` of a JWT. */
  readonly subject: string | null
  /** `preferred_username` of a JWT. */
  readonly user: string | null
  readonly issuer: string | null
  readonly audience: readonly string[]
  /** `exp` of a JWT (ISO 8601 UTC); null for an opaque token. */
  readonly expiresAt: string | null
  /** `exp` lies more than 30 s in the past. */
  readonly expired: boolean
}

/** `pulse-cli auth login` (stdout) and `pulse-cli auth status`: the cached login, never a token. */
export interface LoginOutput {
  readonly profile: string | null
  /** Every profile that uses the login, in file order. */
  readonly profiles: readonly string[]
  readonly issuer: string | null
  readonly clientId: string
  /** `preferred_username`, else the email of the ID token. */
  readonly user: string | null
  /** `sub` of the ID token. */
  readonly subject: string | null
  /** Granted scopes, else the requested ones. */
  readonly scopes: readonly string[]
  /** ISO 8601 UTC; null when unknown. */
  readonly accessTokenExpiresAt: string | null
  readonly accessTokenValid: boolean
  readonly refreshTokenExpiresAt: string | null
  readonly canRefresh: boolean
  readonly loggedInAt: string
  readonly refreshedAt: string | null
  /** Absolute path of the token cache file. */
  readonly tokenCache: string
}

/** `pulse-cli auth logout`. */
export interface LogoutOutput {
  readonly profile: string | null
  /** OAuth: every profile that used the login. */
  readonly profiles?: readonly string[]
  readonly tokenCache: string
  readonly removed: boolean
  /** null: nothing to revoke or no revocation endpoint. */
  readonly revoked: boolean | null
}

/** `pulse-cli config show`: every effective value with the source it came from. */
export interface ConfigShowOutput {
  readonly configFile: string
  readonly profile: string | null
  readonly values: Readonly<Record<string, unknown>>
}

interface DefinitionRef {
  readonly id: string
  readonly key: string
  readonly resource: string
}

export interface Deployment {
  readonly id: string
  readonly name: string | null
  readonly deployedProcessDefinitions: Readonly<Record<string, DefinitionRef>> | null
  readonly deployedDecisionDefinitions: Readonly<Record<string, DefinitionRef>> | null
}

export interface ProcessDefinition {
  readonly id: string
  readonly key: string
  readonly version: number
}

export interface ProcessDefinitionXml {
  readonly id: string
  readonly bpmn20Xml: string
}

export interface ProcessInstance {
  readonly id: string
  readonly businessKey: string | null
  readonly ended: boolean
}

export interface TypedValue {
  readonly type: string
  readonly value: unknown
}

export interface Task {
  readonly id: string
  readonly name: string
  readonly assignee: string | null
}

export interface ExternalTask {
  readonly id: string
  readonly topicName: string
  readonly workerId: string
  readonly processInstanceId: string
}

export interface Incident {
  readonly id: string
  readonly processInstanceId: string
  readonly incidentType: string
  readonly incidentMessage: string | null
}

export interface Count {
  readonly count: number
}

export interface DryRunOutput {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly curl: string
}

export interface OutFileSummary {
  readonly outFile: string
  readonly bytes: number
  readonly contentType: string
}
