/**
 * The tokens of a login, renewed with its refresh token (RFC 6749 §6) under the store's lock.
 * Under the lock the store is the only source of the refresh token: another process may have
 * rotated it meanwhile, and sending the old one again is a replay that ends the session
 * (Keycloak's reuse detection). A newer token in the store is taken over without a request, so
 * concurrent renewals send one refresh token exactly once. A refused refresh token is recorded in
 * the store, so nothing asks with it again, and a renewal that fails for a passing reason keeps
 * the still valid token. A token whose answer named no lifetime is renewed only after a 401: a
 * lifetime assumed for it would spend the refresh token early, and a refusal then would end a
 * login whose access token may still hold. A token renewed after a 401 goes out with the attempt
 * it was renewed for, even when the policy finds it due at once (a lifetime of 5 s or less): one
 * renewal per attempt.
 */
import type { TokenSource } from "../credential.js"
import type { Platform } from "../types.js"
import { canRefresh, EXPIRY, isDue, isExpired, renewsAfterRefusal } from "./expiry.js"
import { isPassing, TokenFailure } from "./failure.js"
import { requestToken } from "./token.js"
import type {
  ExpiryPolicy,
  RefreshRejection,
  TokenEndpoint,
  TokenLimits,
  TokenRecord,
  TokenStore,
} from "./types.js"

export interface RefreshingOptions {
  /**
   * Where the refresh token goes: the endpoint and the client of the login. A function is asked
   * under the lock after the store's reading, so a store that keeps the endpoint with the login
   * (the CLI's cache files) hands in the one of the login it read there.
   */
  readonly endpoint: TokenEndpoint | (() => TokenEndpoint)
  /** The login's key in the store. */
  readonly key: string
  readonly store: TokenStore
  readonly platform: Platform
  readonly policy?: ExpiryPolicy
  readonly limits?: TokenLimits
  /**
   * Told when a renewal failed for a passing reason (no answer, a 5xx, a rate limit, a busy
   * lock) and the still valid token goes out instead; `failure` is what the renewal threw.
   */
  readonly kept?: (failure: unknown, record: TokenRecord) => void
}

/** The store could not take its lock: nothing was sent. */
class Busy {
  constructor(readonly cause: unknown) {}
}

/** What a renewal threw, as its caller sees it: the store's own failure for a busy lock. */
const causeOf = (error: unknown): unknown => (error instanceof Busy ? error.cause : error)

/** A refusal recorded earlier: no request asks again, a new login is needed. */
function recordedFailure({ at, error, description }: RefreshRejection): TokenFailure {
  return new TokenFailure("grant", { error, description, recordedAt: at })
}

/** The refresh token's expiry after a refresh: the new one's, none after a rotation, else the old. */
function refreshExpiryOf(stored: TokenRecord, fresh: TokenRecord): number | undefined {
  if (fresh.refreshExpiresAt !== undefined) return fresh.refreshExpiresAt
  return fresh.refreshToken === undefined ? stored.refreshExpiresAt : undefined
}

/**
 * The login after a refresh: the new access token and its expiry; the new refresh token when the
 * server rotated it (the old one is spent, RFC 6749 §6), else the old one; the scope and the ID
 * token when the answer has them, else the old ones.
 */
function merged(stored: TokenRecord, fresh: TokenRecord, refreshToken: string): TokenRecord {
  return {
    accessToken: fresh.accessToken,
    receivedAt: fresh.receivedAt,
    expiresAt: fresh.expiresAt,
    refreshToken: fresh.refreshToken ?? refreshToken,
    refreshExpiresAt: refreshExpiryOf(stored, fresh),
    scope: fresh.scope ?? stored.scope,
    idToken: fresh.idToken ?? stored.idToken,
  }
}

class RefreshingTokens implements TokenSource {
  readonly renewable = true
  private current: TokenRecord | undefined
  /** The access token a 401 renewed, sent once more without asking the policy. */
  private retry: string | undefined
  private inflight: Promise<TokenRecord> | undefined
  private readonly policy: ExpiryPolicy

  constructor(private readonly options: RefreshingOptions) {
    this.policy = options.policy ?? EXPIRY
  }

  async token(): Promise<string> {
    const record = await this.load()
    const now = this.options.platform.now()
    if (record.refreshRejected !== undefined) throw recordedFailure(record.refreshRejected)
    if (this.retried(record, now)) return record.accessToken
    if (!isDue(record, now, this.policy)) return record.accessToken
    if (canRefresh(record, now)) return (await this.proactive(record)).accessToken
    if (isExpired(record, now)) throw new TokenFailure("expired")
    return record.accessToken
  }

  async rejected(sent: string): Promise<boolean> {
    const record = await this.load()
    if (record.accessToken !== sent) return true
    const young = !renewsAfterRefusal(record, this.options.platform.now(), this.policy)
    if (record.refreshToken === undefined || young) return false
    try {
      this.retry = (await this.shared(record)).accessToken
    } catch (error) {
      throw causeOf(error)
    }
    return true
  }

  /** Whether `record` is the token a 401 renewed, not expired yet: it goes out once as it is. */
  private retried(record: TokenRecord, now: number): boolean {
    const retry = this.retry
    this.retry = undefined
    return record.accessToken === retry && !isExpired(record, now)
  }

  private async load(): Promise<TokenRecord> {
    this.current ??= await this.options.store.read(this.options.key)
    if (this.current === undefined) throw new TokenFailure("expired")
    return this.current
  }

  /** A renewal before expiry: a passing failure keeps the still valid token. */
  private async proactive(record: TokenRecord): Promise<TokenRecord> {
    try {
      return await this.shared(record)
    } catch (error) {
      const passing = error instanceof Busy || isPassing(error)
      if (!passing || isExpired(record, this.options.platform.now())) throw causeOf(error)
      this.options.kept?.(causeOf(error), record)
      return record
    }
  }

  /** One renewal at a time for every caller of this source. */
  private shared(sent: TokenRecord): Promise<TokenRecord> {
    this.inflight ??= this.locked(sent)
      .then((record) => (this.current = record))
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  private async locked(sent: TokenRecord): Promise<TokenRecord> {
    const lock = { taken: false }
    try {
      return await this.options.store.exclusive(this.options.key, () => {
        lock.taken = true
        return this.renewed(sent)
      })
    } catch (error) {
      throw lock.taken ? error : new Busy(error)
    }
  }

  /** Under the lock: take over a newer token, else refresh with the stored refresh token. */
  private async renewed(sent: TokenRecord): Promise<TokenRecord> {
    const { store, key, platform } = this.options
    const stored = await store.read(key)
    if (stored === undefined) throw new TokenFailure("expired")
    const now = platform.now()
    if (stored.accessToken !== sent.accessToken && !isExpired(stored, now)) return stored
    if (stored.refreshRejected !== undefined) throw recordedFailure(stored.refreshRejected)
    if (!canRefresh(stored, now)) throw new TokenFailure("expired")
    const { refreshToken } = stored
    const fresh = merged(stored, await this.refreshed(stored, refreshToken), refreshToken)
    await store.write(key, fresh)
    return fresh
  }

  /** The refresh request with the stored refresh token; a refusal of it is recorded. */
  private async refreshed(stored: TokenRecord, refreshToken: string): Promise<TokenRecord> {
    const { endpoint, platform, limits, store, key } = this.options
    const target = typeof endpoint === "function" ? endpoint() : endpoint
    try {
      return await requestToken(target, { type: "refresh_token", refreshToken }, platform, limits)
    } catch (error) {
      // A TokenFailure, or a RangeError for a URL the wire refuses, which has no kind.
      const failure = error as TokenFailure
      if (failure.kind === "grant") {
        const refreshRejected = {
          at: platform.now(),
          error: String(failure.error),
          description: failure.description,
        }
        // Best effort: the refusal itself is what the caller learns.
        await store.write(key, { ...stored, refreshRejected }).catch(() => undefined)
      }
      throw error
    }
  }
}

/** A renewing token source over a login in a store: see the module comment. */
export function refreshingTokens(options: RefreshingOptions): TokenSource {
  return new RefreshingTokens(options)
}
