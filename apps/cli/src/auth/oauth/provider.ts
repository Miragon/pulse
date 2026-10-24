/**
 * The OAuth AuthProvider: Bearer tokens from the cache of `pulse-cli auth login`,
 * refreshed shortly before they expire and once after a 401. It never starts a login: without a
 * usable token a command fails with LOGIN_REQUIRED (exit 4) and the hint names the command a
 * person runs in a terminal. Network problems, a slow authorization server or a busy lock do not
 * fail a command whose token is still valid.
 */

import type { OAuthConfig } from "../../config/types.js"
import { OperateError } from "../../errors.js"
import type { AuthPreview, AuthProvider, Principal } from "../types.js"
import { cachePath, isLockError, readCache } from "./cache.js"
import {
  checkUsable,
  inTerminal,
  iso,
  type LoginOwner,
  notLoggedIn,
  otherIdentity,
  owner,
  profileNote,
  statusCommand,
} from "./errors.js"
import { canRefresh, isExpired, needsRefresh } from "./expiry.js"
import { identityOf, sameIdentity } from "./identity.js"
import { refreshUnderLock } from "./refresh.js"
import type { CachedLogin, OAuthDeps } from "./types.js"

/** Failures after which the still valid current token is used: nothing is wrong with the login. */
const TRANSIENT: ReadonlySet<string> = new Set(["NETWORK", "TIMEOUT", "HTTP_SERVER_ERROR"])

function isTransient(error: unknown): boolean {
  return isLockError(error) || (error instanceof OperateError && TRANSIENT.has(error.code))
}

function bearer(login: CachedLogin): Readonly<Record<string, string>> {
  return { Authorization: `Bearer ${login.accessToken}` }
}

interface State {
  readonly current?: CachedLogin | undefined
  readonly reactiveRefreshDone: boolean
}

function who(login: CachedLogin | undefined): string {
  return login?.user ?? login?.subject ?? "an unknown user"
}

function rejectedHint(config: OAuthConfig, state: State, status: number): string | undefined {
  const user = `${who(state.current)} ${profileNote(config.profile)}`
  if (status === 403) {
    return `The gateway or the engine refused the OAuth access token of ${user}. A JWT gateway answers 403 when the token's audience or scopes do not fit (e.g. "Audiences in Jwt are not allowed"): check the audience mapper or auth.audience and auth.scopes; otherwise the user lacks an engine authorization.`
  }
  if (status !== 401) return undefined
  const again = state.reactiveRefreshDone ? ", also after refreshing it" : ""
  return `The engine (or the gateway in front of it) rejected the OAuth access token of ${user}${again}. The authorization server issued it, but it is not accepted here: the gateway must expect exactly the issuer pulse-cli logged in with (auth.issuer: ${config.issuer ?? "not set"}; localhost and 127.0.0.1 are different issuers), and its clock must agree; \`${statusCommand(config)}\` shows scopes and expiry. If the login was revoked, run ${inTerminal(config)}.`
}

function previewNote(login: CachedLogin, now: number, who: LoginOwner): string | undefined {
  if (login.refreshRejected !== undefined) {
    return `The authorization server rejected the refresh token at ${iso(login.refreshRejected.at)}: the request would fail with LOGIN_REQUIRED. Run ${inTerminal(who)}.`
  }
  if (!needsRefresh(now, login)) return undefined
  const expired = isExpired(now, login.expiresAt)
  const when = `${expired ? "expired" : "expires"} at ${iso(login.expiresAt ?? now)}`
  if (canRefresh(login, now)) {
    return `The cached access token ${when}; pulse-cli would refresh it before sending.`
  }
  return expired
    ? `The cached access token ${when} and pulse-cli cannot refresh it: the request would fail with LOGIN_REQUIRED. Run ${inTerminal(who)}.`
    : `The cached access token ${when} and pulse-cli cannot refresh it.`
}

class OAuthProvider implements AuthProvider {
  readonly type = "oauth"
  readonly loginStatusCommand: string
  private path: string | undefined
  private current: CachedLogin | undefined
  private inflight: Promise<CachedLogin> | undefined
  private reactiveRefreshDone = false

  constructor(
    private readonly config: OAuthConfig,
    private readonly deps: OAuthDeps,
  ) {
    this.loginStatusCommand = statusCommand(config)
  }

  get principal(): Principal | undefined {
    const user = this.current?.user ?? this.current?.subject ?? null
    return user === null
      ? undefined
      : { user, source: `OAuth login of ${owner(this.config.profile)}` }
  }

  /** The cached login, read once per process; LOGIN_REQUIRED without a usable one. */
  private async load(): Promise<CachedLogin> {
    if (this.current !== undefined) return this.current
    this.path ??= await cachePath(this.config, this.deps)
    const login = await readCache(this.path, this.deps, this.config)
    if (login === undefined) throw notLoggedIn(this.config)
    if (!sameIdentity(login.identity, identityOf(this.config))) {
      throw otherIdentity(login.identity, this.config)
    }
    this.current = login
    return login
  }

  /** One refresh per process at a time: concurrent calls share it. */
  private refreshShared(current: CachedLogin): Promise<CachedLogin> {
    this.inflight ??= refreshUnderLock(this.config, this.path ?? "", current, this.deps)
      .then((login) => {
        this.current = login
        return login
      })
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  /** A refresh before expiry; transient failures keep the still valid token. */
  private async proactive(login: CachedLogin): Promise<CachedLogin> {
    try {
      return await this.refreshShared(login)
    } catch (error) {
      if (!isTransient(error) || isExpired(this.deps.now(), login.expiresAt)) throw error
      // --verbose shows the token request without an answer; say why the command goes on
      const reason = error instanceof Error ? error.message : String(error)
      this.deps.trace?.({
        type: "note",
        message: `Refreshing the access token failed (${reason}); using the cached one, valid until ${iso(login.expiresAt ?? 0)}.`,
      })
      return login
    }
  }

  async headers(): Promise<Readonly<Record<string, string>>> {
    const login = await this.load()
    const now = this.deps.now()
    if (login.refreshRejected === undefined && !needsRefresh(now, login)) return bearer(login)
    if (canRefresh(login, now)) return bearer(await this.proactive(login))
    checkUsable(login, now, this.config)
    return bearer(login)
  }

  /** After a 401: at most one refresh per process (a rejected fresh token stays rejected). */
  async refresh(): Promise<boolean> {
    const login = await this.load()
    if (login.refreshToken === null || this.reactiveRefreshDone) return false
    this.reactiveRefreshDone = true
    await this.refreshShared(login)
    return true
  }

  async preview(): Promise<AuthPreview> {
    try {
      const login = await this.load()
      const note = previewNote(login, this.deps.now(), this.config)
      return note === undefined ? { headers: bearer(login) } : { headers: bearer(login), note }
    } catch (error) {
      if (!(error instanceof OperateError) || error.code !== "LOGIN_REQUIRED") throw error
      return {
        headers: {},
        note: `Not logged in with OAuth ${profileNote(this.config.profile)}; the request would fail with LOGIN_REQUIRED. Run ${inTerminal(this.config)}.`,
      }
    }
  }

  rejectedHint(status: number): string | undefined {
    const state = { current: this.current, reactiveRefreshDone: this.reactiveRefreshDone }
    return rejectedHint(this.config, state, status)
  }
}

export function oauthAuth(config: OAuthConfig, deps: OAuthDeps): AuthProvider {
  return new OAuthProvider(config, deps)
}
