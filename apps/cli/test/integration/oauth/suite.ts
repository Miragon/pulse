/**
 * The profiles, constants and helpers of the OAuth suite (oauth.it.test.ts), and what its tests
 * share of it: the topology, the CLI bound to it and the suite's files.
 */

import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { networkInterfaces } from "node:os"
import { setTimeout as sleep } from "node:timers/promises"
import { argv, globalFlag } from "../support/catalog.js"
import type { Cli, CliOptions, CliResult, StartCli } from "../support/cli.js"
import { CLIENTS } from "../support/keycloak.js"
import type { CompletedLogin } from "../support/login.js"
import type { OAuthTopology } from "../support/oauth.js"
import type { SecretLedger } from "../support/secrets.js"
import type { CachedLogin } from "../support/token-cache.js"
import type { LoginOutput } from "../support/types.js"

/** Profiles of the suite's config file (design §16.14.2). */
export const PROFILE = {
  /** operate-cli, audience engine-rest (sent, ignored by Keycloak), offline token */
  it: "it",
  /** operate-cli-short: 5 s access tokens */
  short: "short",
  /** operate-cli-short with scopes ["openid"]: an online session, which an admin logout ends */
  online: "online",
  /** operate-cli-confidential, secret from IT_CLIENT_SECRET */
  conf: "conf",
  /** operate-cli-noaud: Envoy answers 403 */
  noaud: "noaud",
  /** a client id Keycloak does not know */
  wrongClient: "wrong-client",
  /** operate-cli with the issuer spelled http://127.0.0.1:<port>/... (only with Docker on localhost) */
  loopbackIp: "loopback-ip",
  /** operate-cli like "it" with the email scope: two profiles that share a login, names differ in case */
  caseLower: "case-it",
  caseUpper: "Case-It",
} as const

export const CLIENT_SECRET_ENV = "IT_CLIENT_SECRET"
export const UNKNOWN_CLIENT = "operate-cli-unknown"
export const AUDIENCE = "engine-rest"
export const DEFAULT_SCOPES = ["openid", "offline_access"]
/** The scopes of the profiles that share a login: other than those of "it", so a login of their own. */
export const SHARED = ["openid", "offline_access", "email"]
/** Generous: once, with ~25 unrelated containers running, a Keycloak login took 40 s. */
export const RUN_TIMEOUT_MS = 90_000
export const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/
export const IGNORED_STATE = /Ignored a login callback without the right state/g

export function loginArgs(profile: string, ...extra: string[]): string[] {
  return ["auth", "login", "--profile", profile, "--no-browser", ...extra]
}

export function authArgs(
  command: "status" | "logout",
  profile: string,
  ...extra: string[]
): string[] {
  return ["auth", command, "--profile", profile, ...extra]
}

/** `operate process-definition count --profile <profile> [flags...]`, a read the gateway guards. */
export function countArgs(profile: string, ...flags: string[]): string[] {
  return [...argv("process-definition count"), globalFlag("profile"), profile, ...flags]
}

export function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  return Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
}

/** A non-loopback IPv4 address of this machine, if it has one. */
export function externalIpv4(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((info) => info?.family === "IPv4" && !info.internal)?.address
}

/** Whether an HTTP server answers at `url` (any status); false when the connection fails. */
export async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(5_000) })
    return true
  } catch {
    return false
  }
}

export function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const value = await read()
    if (done(value) || Date.now() > deadline) return value
    await sleep(50)
  }
}

export function profilesOf({ url, issuer, host, keycloakPort }: OAuthTopology) {
  const oauth = (auth: Readonly<Record<string, unknown>>) => ({
    url,
    auth: { type: "oauth", issuer, ...auth },
  })
  const loopbackIssuer = `http://127.0.0.1:${keycloakPort}/realms/operate`
  return {
    [PROFILE.it]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE }),
    [PROFILE.short]: oauth({ clientId: CLIENTS.short }),
    [PROFILE.online]: oauth({ clientId: CLIENTS.short, scopes: ["openid"] }),
    [PROFILE.conf]: oauth({ clientId: CLIENTS.confidential, clientSecretEnv: CLIENT_SECRET_ENV }),
    [PROFILE.noaud]: oauth({ clientId: CLIENTS.noAudience }),
    [PROFILE.wrongClient]: oauth({ clientId: UNKNOWN_CLIENT, audience: AUDIENCE }),
    [PROFILE.caseLower]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE, scopes: SHARED }),
    [PROFILE.caseUpper]: oauth({ clientId: CLIENTS.public, audience: AUDIENCE, scopes: SHARED }),
    // Keycloak issues tokens for whatever host name the client used; only "localhost" has a twin
    ...(host === "localhost"
      ? { [PROFILE.loopbackIp]: oauth({ clientId: CLIENTS.public, issuer: loopbackIssuer }) }
      : {}),
  }
}

/** A login the test completed: the browser step, the CLI's output and the cache it wrote. */
export interface SuiteLogin extends CompletedLogin {
  readonly view: LoginOutput
  readonly cache: CachedLogin
}

export interface OAuthSuite {
  /** Runs the built CLI with the suite's config file (bound once the topology has started). */
  readonly cli: Cli
  /** Starts the built CLI without waiting for it, for a login whose browser step a test plays. */
  readonly start: StartCli
  /** The running topology: the gateway URL, the issuer and the engine behind them. */
  readonly top: () => OAuthTopology
  /** The suite's temporary directory. */
  readonly workdir: string
  /** Every token, code and client secret the suite has seen; no output may contain one. */
  readonly ledger: SecretLedger
  /** The login command of a hint (the suite's config file is named by --config). */
  readonly LOGIN_HINT: (profile: string) => string
  readonly tokenEndpoint: () => string
  /** The cache file of a profile's login. */
  readonly cacheFile: (profile: string) => string
  /** Requests and answers of a run; `<engine>` is the gateway URL, `<token>` the token endpoint. */
  readonly trace: (result: CliResult) => string[]
  readonly COUNT_REQUEST: string
  /** Runs the CLI and checks that the output contains no secret. */
  readonly run: (args: readonly string[], options?: CliOptions) => Promise<CliResult>
  /** Logs in with --no-browser, the browser step done by the test. */
  readonly login: (profile: string, options?: CliOptions) => Promise<SuiteLogin>
}
