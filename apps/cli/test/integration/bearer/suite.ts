/**
 * The constants and helpers of the bearer token suite (bearer.it.test.ts), and what its tests
 * share of it: the topology, the token Keycloak issued, the CLI and the suite's files.
 */

import { argv } from "../support/catalog.js"
import type { Cli, CliError, CliOptions, CliResult } from "../support/cli.js"
import { expiryOf } from "../support/jwt.js"
import { CLIENTS } from "../support/keycloak.js"
import type { GatewayTopology } from "../support/gateway.js"

export const AUDIENCE = "engine-rest"
/** `preferred_username` of the tokens of `pulse-ci`. */
export const SERVICE_ACCOUNT = `service-account-${CLIENTS.ci}`
/** Generous: Keycloak and the gateway share the machine with many containers. */
export const RUN_TIMEOUT_MS = 90_000
/** pulse-cli refuses a JWT whose `exp` lies more than 30 s in the past. */
export const EXPIRY_GRACE_MS = 30_000
/** Envoy accepts 1 s of clock skew (fixtures/envoy.yaml); beyond that it answers "Jwt is expired". */
export const GATEWAY_SKEW_MS = 2_500
/** An opaque token: a valid RFC 6750 b64token that the gateway cannot parse. */
export const GARBAGE = "garbage-token-it"
export const COUNT_REQUEST = "> GET <engine>/process-definition/count"

/** `pulse-cli process-definition count [flags...]`, a read the gateway guards. */
export function countArgs(...flags: string[]): string[] {
  return [...argv("process-definition count"), ...flags]
}

/** Message, hint and the gateway's text of an error, for checks that do not care which says it. */
export function explanation(error: CliError): string {
  return [error.message, error.hint ?? "", error.engineMessage ?? ""].join("\n")
}

/** `exp` of a JWT as pulse-cli prints instants: ISO 8601 UTC with milliseconds. */
export function expiryIso(jwt: string): string {
  return new Date(expiryOf(jwt)).toISOString()
}

export function revealedHeader(token: string): RegExp {
  return new RegExp(`^> authorization: Bearer ${token.replaceAll(".", "\\.")}$`, "im")
}

export interface BearerSuite {
  /** Runs the built CLI with the suite's config file (bound once the topology has started). */
  readonly cli: Cli
  /** The running topology: the gateway URL, the issuer and the engine behind them. */
  readonly top: () => GatewayTopology
  /** The suite's temporary directory. */
  readonly workdir: string | undefined
  /** Config file of the runs: empty, so only the environment counts. */
  readonly configFile: string
  /** A CI pipeline's token: client credentials grant of the CI client, a JWT valid for 300 s. */
  readonly ciToken: string
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
}
