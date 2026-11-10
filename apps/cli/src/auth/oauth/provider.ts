/**
 * The OAuth AuthProvider: Bearer tokens from the cache of `pulse auth login`, renewed by
 * @miragon/pulse-http/oauth's `refreshingTokens` on the cache file (store.ts) under the shared
 * policy: shortly before they expire, and after a 401 when the token is old enough for a new one
 * to help. It never starts a login: without a usable token a command fails with LOGIN_REQUIRED
 * (exit 4) and the hint names the command a person runs in a terminal. Network problems, a slow
 * authorization server or a busy lock do not fail a command whose token is still valid.
 */

import { bearerCredential, type Credential, type TokenSource } from "@miragon/pulse-http"
import { EXPIRY, isDue, refreshingTokens, TokenFailure } from "@miragon/pulse-http/oauth"
import { endpointSource } from "../../config/resolve-oauth.js"
import type { OAuthConfig } from "../../config/types.js"
import { PulseCliError } from "../../errors.js"
import type { AuthPreview, AuthProvider, Principal } from "../types.js"
import { cachePath, clientAuthOf } from "./cache.js"
import {
  cannotRefresh,
  inTerminal,
  iso,
  type LoginOwner,
  owner,
  profileNote,
  statusCommand,
} from "./errors.js"
import { canRefresh, isExpired, receivedAt } from "./expiry.js"
import { limitsOf, platformOf } from "./http.js"
import { type LoginStore, loginStore, recordOf } from "./store.js"
import { type TokenClient, tokenEndpointOf, tokenError } from "./token.js"
import type { CachedLogin, OAuthDeps } from "./types.js"

/** The cache of a login, read once, and the token source over it. */
interface Opened {
  readonly store: LoginStore
  readonly tokens: TokenSource
  /** The login of the first reading. */
  readonly login: CachedLogin
}

function bearer(login: CachedLogin): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${login.accessToken}` }
}

function who(login: CachedLogin | undefined): string {
  return login?.user ?? login?.subject ?? "an unknown user"
}

function rejectedHint(
  config: OAuthConfig,
  login: CachedLogin | undefined,
  renewed: boolean,
  status: number,
): string | undefined {
  const user = `${who(login)} ${profileNote(config.profile)}`
  if (status === 403) {
    return `The gateway or the engine refused the OAuth access token of ${user}. A JWT gateway answers 403 when the token's audience or scopes do not fit (e.g. "Audiences in Jwt are not allowed"): check the audience mapper or auth.audience and auth.scopes; otherwise the user lacks an engine authorization.`
  }
  if (status !== 401) return undefined
  const again = renewed ? ", also after refreshing it" : ""
  return `The engine (or the gateway in front of it) rejected the OAuth access token of ${user}${again}. The authorization server issued it, but it is not accepted here: the gateway must expect exactly the issuer pulse logged in with (auth.issuer: ${config.issuer ?? "not set"}; localhost and 127.0.0.1 are different issuers), and its clock must agree; \`${statusCommand(config)}\` shows scopes and expiry. If the login was revoked, run ${inTerminal(config)}.`
}

/** When the cached access token expires, for a note: received at a time when it names no expiry. */
function expiryNote(login: CachedLogin, expired: boolean): string {
  if (login.expiresAt === null) return `has no known expiry (received at ${iso(receivedAt(login))})`
  return `${expired ? "expired" : "expires"} at ${iso(login.expiresAt)}`
}

function previewNote(login: CachedLogin, now: number, who: LoginOwner): string | undefined {
  if (login.refreshRejected !== undefined) {
    return `The authorization server rejected the refresh token at ${iso(login.refreshRejected.at)}: the request would fail with LOGIN_REQUIRED. Run ${inTerminal(who)}.`
  }
  if (!isDue(recordOf(login), now, EXPIRY)) return undefined
  const expired = isExpired(now, login.expiresAt)
  const when = expiryNote(login, expired)
  if (canRefresh(login, now)) {
    return `The cached access token ${when}; pulse would refresh it before sending.`
  }
  return expired
    ? `The cached access token ${when} and pulse cannot refresh it: the request would fail with LOGIN_REQUIRED. Run ${inTerminal(who)}.`
    : `The cached access token ${when} and pulse cannot refresh it.`
}

class OAuthProvider implements AuthProvider {
  readonly type = "oauth"
  readonly loginStatusCommand: string
  /** A bearer credential over the login's access token, renewed by the shared policy. */
  readonly credential: Credential = bearerCredential({
    renewable: true,
    token: () => this.token(),
    rejected: (sent) => this.rejected(sent),
  })
  private store: LoginStore | undefined
  private source: Promise<Opened> | undefined
  /** A 401 renewed the token, for the hint of the 401 that may follow. */
  private renewed = false

  constructor(
    private readonly config: OAuthConfig,
    private readonly deps: OAuthDeps,
  ) {
    this.loginStatusCommand = statusCommand(config)
  }

  get principal(): Principal | undefined {
    const login = this.store?.current
    const user = login?.user ?? login?.subject ?? null
    return user === null
      ? undefined
      : { user, source: `OAuth login of ${owner(this.config.profile)}` }
  }

  /** The token client of a cached login: its endpoint and method, the settings' secret. */
  private client(login: CachedLogin): TokenClient {
    return {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      method: clientAuthOf(login),
      endpoint: { url: login.endpoints.token, source: endpointSource(this.config) },
      who: this.config,
    }
  }

  /** The cache read once; LOGIN_REQUIRED without a usable login, read again on the next call. */
  private async opened(): Promise<Opened> {
    const path = await cachePath(this.config, this.deps)
    const store = loginStore(path, this.config, this.deps)
    this.store = store
    const login = await store.load()
    const tokens = refreshingTokens({
      // Asked under the lock: the endpoint and method of the login read there, which another
      // terminal may have replaced meanwhile.
      endpoint: () => tokenEndpointOf(this.client(store.current ?? login)),
      key: path,
      store,
      platform: platformOf(this.deps),
      policy: EXPIRY,
      limits: limitsOf(this.deps),
      kept: (failure, record) => {
        this.kept(failure, record.expiresAt)
      },
    })
    return { store, tokens, login }
  }

  private opening(): Promise<Opened> {
    this.source ??= this.opened().catch((error: unknown) => {
      this.source = undefined
      throw error
    })
    return this.source
  }

  /** What the package threw, as the CLI words it; the store's own errors are the CLI's already. */
  private worded(error: unknown): unknown {
    const login = this.store?.current
    if (!(error instanceof TokenFailure) || login === undefined) return error
    if (error.kind === "expired" || error.recordedAt !== undefined) {
      return cannotRefresh(login, this.deps.now(), this.config)
    }
    return tokenError(error, "refresh", this.client(login), this.deps.timeoutMs)
  }

  /** --verbose shows the token request without an answer; say why the command goes on. */
  private kept(failure: unknown, expiresAt: number | undefined): void {
    const worded = this.worded(failure)
    const reason = worded instanceof Error ? worded.message : String(worded)
    const valid =
      expiresAt === undefined ? "whose expiry is unknown" : `valid until ${iso(expiresAt)}`
    this.deps.trace?.({
      type: "note",
      message: `Refreshing the access token failed (${reason}); using the cached one, ${valid}.`,
    })
  }

  private async token(): Promise<string | undefined> {
    const { tokens } = await this.opening()
    try {
      return await tokens.token()
    } catch (error) {
      throw this.worded(error)
    }
  }

  private async rejected(sent: string): Promise<boolean> {
    const { tokens } = await this.opening()
    try {
      const renewed = await tokens.rejected(sent)
      this.renewed ||= renewed
      return renewed
    } catch (error) {
      throw this.worded(error)
    }
  }

  async preview(): Promise<AuthPreview> {
    try {
      const opened = await this.opening()
      const login = opened.store.current ?? opened.login
      const note = previewNote(login, this.deps.now(), this.config)
      return note === undefined ? { headers: bearer(login) } : { headers: bearer(login), note }
    } catch (error) {
      if (!(error instanceof PulseCliError) || error.code !== "LOGIN_REQUIRED") throw error
      return {
        headers: {},
        note: `Not logged in with OAuth ${profileNote(this.config.profile)}; the request would fail with LOGIN_REQUIRED. Run ${inTerminal(this.config)}.`,
      }
    }
  }

  rejectedHint(status: number): string | undefined {
    return rejectedHint(this.config, this.store?.current, this.renewed, status)
  }
}

export function oauthAuth(config: OAuthConfig, deps: OAuthDeps): AuthProvider {
  return new OAuthProvider(config, deps)
}
