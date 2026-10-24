/**
 * `pulse-cli auth login`: the authorization code flow with PKCE and a loopback
 * redirect on 127.0.0.1 (RFC 8252). It prints the authorization URL (also over SSH), opens the
 * system browser unless --no-browser, waits for the callback with the right state, exchanges the
 * code and writes the token cache under the lock. Only `src/cli/commands/auth.ts` imports this
 * module: no other command can start a loopback server or a browser.
 */

import { configError } from "../../config/config-error.js"
import { endpointSource } from "../../config/resolve-oauth.js"
import { ENV, type OAuthConfig } from "../../config/types.js"
import { isRecord } from "../../util.js"
import type { LoopbackRequest, LoopbackResponse, LoopbackServer } from "../../runtime.js"
import { cachePath, withCacheLock, writeCache } from "./cache.js"
import { authorizationUrl, callbackCode, hasState } from "./callback.js"
import { serverMetadata } from "./discovery.js"
import { iso, loginFailed, profileNote } from "./errors.js"
import { expiryOf } from "./expiry.js"
import { identityOf } from "./identity.js"
import { failurePage, successPage } from "./pages.js"
import { createPkce, type PkceRequest } from "./pkce.js"
import { exchangeCode } from "./token.js"
import type { CachedLogin, LoginDeps, ServerMetadata, TokenResponse } from "./types.js"

export interface LoginOptions {
  readonly noBrowser: boolean
  readonly loginTimeoutMs: number
}

export interface LoginResult {
  readonly login: CachedLogin
  readonly tokenFile: string
}

/** The notice for a callback without the right state, printed at most once per login. */
export const IGNORED_STATE_NOTICE =
  "Ignored a login callback without the right state (not from this login; a stale browser tab or another program)."

const EXCHANGE_FAILED = "pulse-cli could not exchange the authorization code."

interface Accepted {
  readonly completion: Promise<CachedLogin>
}

/** One login: its parameters and the state of the callback handling. */
interface Flow {
  readonly config: OAuthConfig
  readonly deps: LoginDeps
  readonly metadata: ServerMetadata
  readonly pkce: PkceRequest
  readonly tokenFile: string
  redirectUri: string
  accepted: boolean
  noticed: boolean
  accept: (accepted: Accepted) => void
}

/**
 * How to choose the callback port where it is configured: PULSE_CLI_OAUTH_REDIRECT_PORT overrides
 * the profile, so a `config set` would change nothing while the variable is set.
 */
function portSetting(config: OAuthConfig): string {
  return config.sources.redirectPort === "env" || config.profile === undefined
    ? `${ENV.oauthRedirectPort}=<port>`
    : `pulse-cli config set ${config.profile} --oauth-redirect-port <port>`
}

function listenError(error: unknown, config: OAuthConfig) {
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "unknown error"
  const port = config.redirectPort
  if (code !== "EADDRINUSE") {
    return configError(`Cannot listen on 127.0.0.1:${port} for the login callback (${code})`)
  }
  return configError(
    `Port ${port} for the login callback is in use`,
    `Stop the program that uses it or choose another port: ${portSetting(config)} (0 = any free port); the port must match the redirect URI registered for client ${config.clientId}.`,
  )
}

/**
 * What to register for the client when the authorization server refused the redirect URI: the
 * port-less loopback URI, or with a fixed port that URI; never the ephemeral port of this run.
 */
function redirectRegistration(config: OAuthConfig): string {
  const any = "http://127.0.0.1/callback (any port; Keycloak, Entra ID)"
  return config.redirectPort === 0
    ? `register ${any} for client ${config.clientId}, or set a fixed port (${portSetting(config)}) and register http://127.0.0.1:<port>/callback`
    : `register ${any} or http://127.0.0.1:${config.redirectPort}/callback for client ${config.clientId}`
}

function newLogin(flow: Flow, tokens: TokenResponse, now: number): CachedLogin {
  const { config, metadata } = flow
  return {
    version: 1,
    identity: identityOf(config),
    endpoints: {
      token: metadata.tokenEndpoint,
      revocation: metadata.revocationEndpoint,
      clientAuthMethod: config.clientSecret === undefined ? "none" : metadata.clientAuthMethod,
    },
    tokenType: "Bearer",
    accessToken: tokens.accessToken,
    expiresAt: expiryOf(now, tokens.expiresIn),
    refreshToken: tokens.refreshToken,
    refreshExpiresAt: tokens.refreshToken === null ? null : expiryOf(now, tokens.refreshExpiresIn),
    scope: tokens.scope,
    subject: tokens.subject,
    user: tokens.user,
    loggedInAt: now,
    refreshedAt: null,
  }
}

/** Exchanges the code and writes the cache under the lock. */
async function finish(flow: Flow, code: string): Promise<CachedLogin> {
  const { config, deps, metadata } = flow
  const client = {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    method: metadata.clientAuthMethod,
    endpoint: { url: metadata.tokenEndpoint, source: endpointSource(config) },
    who: config,
  }
  const exchange = { code, redirectUri: flow.redirectUri, verifier: flow.pkce.verifier }
  const tokens = await exchangeCode(client, exchange, deps)
  const login = newLogin(flow, tokens, deps.now())
  await withCacheLock(flow.tokenFile, deps, () => writeCache(flow.tokenFile, login, deps))
  return login
}

/** A callback with the right state: it decides the login, success or failure. */
async function complete(flow: Flow, query: URLSearchParams): Promise<LoopbackResponse> {
  flow.accepted = true
  const checked = callbackCode(query, flow.metadata, flow.config)
  const completion = "code" in checked ? finish(flow, checked.code) : Promise.reject(checked.error)
  // the login awaits it; this only keeps an early rejection from counting as unhandled
  completion.catch(() => undefined)
  flow.accept({ completion })
  const reason = "code" in checked ? EXCHANGE_FAILED : checked.reason
  return completion.then(
    () => ({ status: 200, html: successPage() }),
    () => ({ status: 400, html: failurePage(reason) }),
  )
}

function handle(
  flow: Flow,
  request: LoopbackRequest,
): Promise<LoopbackResponse> | LoopbackResponse {
  if (request.method !== "GET") {
    return { status: 405, html: failurePage("Only GET requests are accepted here.") }
  }
  if (request.path !== "/callback") return { status: 404, html: failurePage("Not found.") }
  if (flow.accepted) {
    return { status: 409, html: failurePage("pulse-cli already received the login callback.") }
  }
  if (!hasState(request.query, flow.pkce.state)) {
    if (!flow.noticed) flow.deps.stderr.write(`${IGNORED_STATE_NOTICE}\n`)
    flow.noticed = true
    return { status: 400, html: failurePage("This is not the callback of the running login.") }
  }
  return complete(flow, request.query)
}

/** The callback handler: one request at a time. */
function serialized(flow: Flow) {
  let queue: Promise<unknown> = Promise.resolve()
  return (request: LoopbackRequest): Promise<LoopbackResponse> => {
    const response = queue.then(() => handle(flow, request))
    queue = response.catch(() => undefined)
    return response
  }
}

async function listen(flow: Flow): Promise<LoopbackServer> {
  try {
    return await flow.deps.listenLoopback(flow.config.redirectPort, serialized(flow))
  } catch (error) {
    throw listenError(error, flow.config)
  }
}

/** The lines on stderr; the URL line is the only one indented by two spaces. */
async function announce(flow: Flow, url: string, options: LoginOptions): Promise<void> {
  const { config, deps, metadata } = flow
  const target = metadata.issuer ?? new URL(metadata.authorizationEndpoint).origin
  const write = (line: string) => {
    deps.stderr.write(`${line}\n`)
  }
  write(`Logging in to ${target} as client ${config.clientId} ${profileNote(config.profile)}.`)
  write("Open this URL in a browser to log in:")
  write(`  ${url}`)
  if (!options.noBrowser) {
    write(
      (await deps.openBrowser(url))
        ? "Opened the system browser."
        : "Could not open a browser; open the URL above yourself.",
    )
  }
  write(
    `Waiting up to ${options.loginTimeoutMs / 1000} s for the login at ${flow.redirectUri} (Ctrl+C cancels).`,
  )
}

/** Waits for an accepted callback; the timeout no longer applies once one arrived. */
async function wait(flow: Flow, accepted: Promise<Accepted>, timeoutMs: number) {
  const timeout = flow.deps.deadline(timeoutMs).then(() => undefined)
  const winner = await Promise.race([accepted, timeout])
  if (winner !== undefined) return winner.completion
  throw loginFailed(
    `No login arrived within ${timeoutMs / 1000} s`,
    `Complete the login in the browser. If it showed an error such as "Invalid parameter: redirect_uri", ${redirectRegistration(flow.config)}; then run the command again.`,
  )
}

function report(flow: Flow, login: CachedLogin): void {
  const { config, deps } = flow
  if (login.refreshToken === null) {
    const until = login.expiresAt === null ? "" : ` at ${iso(login.expiresAt)}`
    deps.stderr.write(
      `Warning: the authorization server issued no refresh token; commands fail with LOGIN_REQUIRED (exit 4) once the access token expires${until}. Request the offline_access scope or allow refresh tokens for client ${config.clientId}.\n`,
    )
  }
  const user = login.user ?? login.subject ?? "an unknown user"
  deps.stderr.write(`Logged in as ${user} ${profileNote(config.profile)}.\n`)
}

/** Runs the login and replaces the cached one. */
export async function login(
  config: OAuthConfig,
  options: LoginOptions,
  deps: LoginDeps,
): Promise<LoginResult> {
  const metadata = await serverMetadata(config, deps)
  const pkce = await createPkce(deps.randomBytes)
  const tokenFile = await cachePath(config, deps)
  let accept: (accepted: Accepted) => void = () => undefined
  const accepted = new Promise<Accepted>((resolve) => {
    accept = resolve
  })
  const flow: Flow = {
    config,
    deps,
    metadata,
    pkce,
    tokenFile,
    accept,
    redirectUri: "",
    accepted: false,
    noticed: false,
  }
  const server = await listen(flow)
  let result: CachedLogin
  try {
    flow.redirectUri = `http://127.0.0.1:${server.port}/callback`
    const url = authorizationUrl(metadata.authorizationEndpoint, config, pkce, flow.redirectUri)
    await announce(flow, url, options)
    result = await wait(flow, accepted, options.loginTimeoutMs)
  } finally {
    await server.close()
  }
  report(flow, result)
  return { login: result, tokenFile }
}
