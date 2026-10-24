/**
 * The profiles, constants and helpers of the bearer token suite (bearer.it.test.ts), and what its
 * tests share of it: the topology, the tokens Keycloak issued, the CLI and the suite's files.
 */

import { argv, globalFlag } from "../support/catalog.js"
import type { Cli, CliError, CliOptions, CliResult } from "../support/cli.js"
import { expiryOf } from "../support/jwt.js"
import { CLIENTS } from "../support/keycloak.js"
import type { OAuthTopology } from "../support/oauth.js"
import type { EnvOverrides } from "../support/process.js"

/** Profiles of the profiles file (runs without a profile use an empty config file). */
export const PROFILE = {
  /** written by `config set --auth bearer --auth-token-env IT_TOKEN` */
  tokenEnv: "it-token-env",
  /** written by `config set --auth bearer --auth-token-stdin` (a literal token) */
  literal: "it-token-literal",
  /** `auth.tokenEnv: IT_TOKEN`, written by the test (for tests about other things) */
  fixed: "it-fixed",
} as const

/** Variable named by the profiles' `tokenEnv`. */
export const TOKEN_ENV = "IT_TOKEN"
export const AUDIENCE = "engine-rest"
/** `preferred_username` of the tokens of `operate-ci`. */
export const SERVICE_ACCOUNT = `service-account-${CLIENTS.ci}`
/** Generous, like the OAuth suite: Keycloak and the gateway share the machine with many containers. */
export const RUN_TIMEOUT_MS = 90_000
/** operate refuses a JWT whose `exp` lies more than 30 s in the past (design §18). */
export const EXPIRY_GRACE_MS = 30_000
/** Envoy accepts 1 s of clock skew (fixtures/envoy.yaml); beyond that it answers "Jwt is expired". */
export const GATEWAY_SKEW_MS = 2_500
/** An opaque token: a valid RFC 6750 b64token that the gateway cannot parse. */
export const GARBAGE = "garbage-token-it"
/** A password next to a token: Basic auth must not happen by accident, nor print it. */
export const STRAY_PASSWORD = "stray-password-it"
/** Tokens that are no RFC 6750 b64token (space, non-ASCII, `=` inside, comma). */
export const INVALID_TOKENS = [
  "invalid-it-1 invalid-it-2",
  "invalid-ä-it-3",
  "invalid-it-4=invalid-it-5",
  "invalid-it-6,invalid-it-7",
]
export const MASKED_CURL = /'authorization: Bearer \*\*\*'/i
export const ANY_AUTHORIZATION = /^> authorization:/im
export const COUNT_REQUEST = "> GET <engine>/process-definition/count"

/** `operate process-definition count [flags...]`, a read the gateway guards. */
export function countArgs(...flags: string[]): string[] {
  return [...argv("process-definition count"), ...flags]
}

export function profileArgs(profile: string): string[] {
  return [globalFlag("profile"), profile]
}

/** Message, hint and the gateway's text of an error, for checks that do not care which says it. */
export function explanation(error: CliError): string {
  return [error.message, error.hint ?? "", error.engineMessage ?? ""].join("\n")
}

export function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
}

/** `exp` of a JWT as operate prints instants: ISO 8601 UTC with milliseconds (§16.3). */
export function expiryIso(jwt: string): string {
  return new Date(expiryOf(jwt)).toISOString()
}

export function revealedHeader(token: string): RegExp {
  return new RegExp(`^> authorization: Bearer ${token.replaceAll(".", "\\.")}$`, "im")
}

/** A profile as the config file stores it. */
export interface StoredProfile {
  readonly url?: string
  readonly auth?: unknown
}

export interface StoredConfig {
  readonly profiles: Readonly<Record<string, StoredProfile | undefined>>
}

export interface BearerSuite {
  /** Runs the built CLI with the suite's config file (bound once the topology has started). */
  readonly cli: Cli
  /** The running topology: the gateway URL, the issuer and the engine behind them. */
  readonly top: () => OAuthTopology
  /** The suite's temporary directory. */
  readonly workdir: string | undefined
  /** Config file of the runs without a profile: empty, so only the environment counts. */
  readonly configFile: string
  /** Config file of the profile tests. */
  readonly profilesFile: string
  /** A CI pipeline's token: client credentials grant of the CI client, a JWT valid for 300 s. */
  readonly ciToken: string
  /** A person's 5 s token, issued first; it expires while the suite runs. */
  readonly staleToken: string
  /** Requests and answers of a `--verbose` run; `<engine>` is the gateway URL. */
  readonly trace: (result: CliResult) => string[]
  /** Records tokens (for a JWT also its signature) that no output may contain. */
  readonly remember: (...values: readonly string[]) => void
  /** Neither stdout nor stderr contains a secret; `revealed` (a `--show-secrets` run) may show. */
  readonly expectHidden: (result: CliResult, revealed?: string) => void
  /** Runs the CLI and checks that the output contains no secret except `revealed`. */
  readonly run: (
    args: readonly string[],
    options?: CliOptions,
    revealed?: string,
  ) => Promise<CliResult>
  readonly readProfiles: () => Promise<StoredConfig["profiles"]>
  /** Adds or replaces a profile in the profiles file directly (not through `config set`). */
  readonly writeProfile: (name: string, profile: StoredProfile) => Promise<void>
  /** Options of a run with the profiles file: the profile's URL counts, not the URL variable. */
  readonly profiles: (env?: EnvOverrides, options?: CliOptions) => CliOptions
}
