/**
 * Tokens of the client credentials grant (RFC 6749 §4.4), after the C8 adapter of Pulse for VS
 * Code (#543): one request for every caller at a time, a new token shortly before the old one
 * expires (one whose answer names no lifetime counts as 300 s), and after a refusal or a failure
 * a hold, so a wrong secret costs one request a minute and a rate limit is waited out as its
 * Retry-After asks. A renewal that fails for a passing reason (no answer, a 5xx, a rate limit, a
 * busy lock) keeps the token that is still valid, as a login's renewal does (owner decision
 * 2026-11-10; the adapter failed the request): it goes out until it expires, and the renewal is
 * tried again once the hold ends. Over a store the token that lives longer is kept, the stored one
 * when another source renewed it meanwhile. The kept token goes out only once the renewal failed:
 * the read that started it and every read meanwhile wait for its answer, for an endpoint that does
 * not answer up to the request's deadline (30 s by default), as a login's do. A refusal fails the
 * request at once. After a 401 only a token old enough gets renewed: a young one was refused for
 * another reason (a wrong audience), which a new token does not mend.
 */
import type { TokenSource } from "../credential.js"
import type { Platform } from "../types.js"
import { EXPIRY, isDue, isExpired, renewsAfterRefusal } from "./expiry.js"
import { TokenFailure } from "./failure.js"
import { causeOf, isPassingRenewal, tokenKey, underLock } from "./store.js"
import { requestToken } from "./token.js"
import type {
  ExpiryPolicy,
  Grant,
  TokenEndpoint,
  TokenLimits,
  TokenRecord,
  TokenStore,
} from "./types.js"

export interface ClientCredentialsOptions {
  readonly endpoint: TokenEndpoint
  readonly grant: Extract<Grant, { readonly type: "client_credentials" }>
  readonly platform: Platform
  /**
   * Where the token is kept beyond this source, so a source built anew (a connection rebuilt)
   * takes it over; its key is the digest of the endpoint, the client, its secret, the audience
   * and the scopes. Holds stay with the source.
   */
  readonly store?: TokenStore
  /**
   * When a token is renewed (`EXPIRY` by default); a token whose answer names no lifetime counts
   * as one of 300 s under it, so the policy renews it before it might run out.
   */
  readonly policy?: ExpiryPolicy
  readonly limits?: TokenLimits
}

interface Hold {
  readonly failure: TokenFailure
  readonly since: number
  readonly until: number
}

/**
 * The lifetime of a token whose answer names none, for this grant alone (owner decision
 * 2026-11-10): the client gets a new token by itself whenever it asks, so the guess costs one
 * request every 270 s and nothing else. A login and a command's token assume none: renewing them
 * spends a refresh token or runs a command, so they wait for a 401 (`EXPIRY`).
 */
const ASSUMED_LIFETIME_MS = 300_000

/** When `record` expires: at its expiry, else the assumed lifetime after its receipt. */
function expiryOf(record: TokenRecord): number {
  return record.expiresAt ?? record.receivedAt + ASSUMED_LIFETIME_MS
}

/** `record` as its renewal reads it: with the assumed lifetime when its answer named none. */
function withLifetime(record: TokenRecord): TokenRecord {
  return { ...record, expiresAt: expiryOf(record) }
}

/** The key of a client credentials token: no secret in clear, the scopes in any order alike. */
function keyOf({ endpoint, grant }: ClientCredentialsOptions): Promise<string> {
  return tokenKey([
    "client_credentials",
    endpoint.url,
    endpoint.clientId,
    endpoint.clientSecret ?? null,
    grant.audience ?? null,
    [...(grant.scopes ?? [])].sort(),
  ])
}

/** The failure `hold` holds at `now`, if any: none before it began (a clock that stepped back). */
function heldAt(hold: Hold | undefined, now: number): TokenFailure | undefined {
  return hold !== undefined && hold.since <= now && now < hold.until ? hold.failure : undefined
}

/**
 * The token a read sends while its renewal fails or is held: `record` while it is valid and the
 * failure passes; else the failure is thrown, the store's own for a busy lock.
 */
function keptToken(failure: unknown, record: TokenRecord | undefined, now: number): string {
  if (!isPassingRenewal(failure) || record === undefined || isExpired(withLifetime(record), now)) {
    throw causeOf(failure)
  }
  return record.accessToken
}

/** A renewing token source over the client credentials grant: see the module comment. */
export function clientCredentialsTokens(options: ClientCredentialsOptions): TokenSource {
  const { endpoint, grant, platform, store, policy = EXPIRY, limits } = options
  let current: TokenRecord | undefined
  /** A token the endpoint's API refused: never taken over from the store again. */
  let refused: string | undefined
  let pending: Promise<TokenRecord> | undefined
  let hold: Hold | undefined

  const due = (record: TokenRecord, now: number): boolean =>
    isDue(withLifetime(record), now, policy)

  const requested = async (): Promise<TokenRecord> => {
    try {
      current = await requestToken(endpoint, grant, platform, limits)
      hold = undefined
      return current
    } catch (error) {
      // A URL the wire refuses is the caller's mistake, not the endpoint's: no hold.
      if (!(error instanceof TokenFailure)) throw error
      const since = platform.now()
      hold = { failure: error, since, until: since + error.holdMs }
      throw error
    }
  }

  const stored = async (keep: TokenStore): Promise<TokenRecord> => {
    const key = await keyOf(options)
    return underLock(keep, key, async () => {
      const found = await keep.read(key)
      if (found !== undefined && found.accessToken !== refused) {
        if (!due(found, platform.now())) {
          current = found
          return found
        }
        // While the renewal fails the token that lives longer is kept: the stored one for a
        // source built anew, or when another source renewed it meanwhile.
        if (current === undefined || expiryOf(found) > expiryOf(current)) current = found
      }
      const record = await requested()
      await keep.write(key, record)
      return record
    })
  }

  return {
    renewable: true,
    async token() {
      const now = platform.now()
      if (current !== undefined && !due(current, now)) return current.accessToken
      const failure = heldAt(hold, now)
      if (failure !== undefined) return keptToken(failure, current, now)
      pending ??= (store === undefined ? requested() : stored(store)).finally(() => {
        pending = undefined
      })
      return pending.then(
        (record) => record.accessToken,
        (error: unknown) => keptToken(error, current, platform.now()),
      )
    },
    rejected(sent) {
      // Another request renewed it meanwhile: the next attempt takes that one.
      if (current?.accessToken !== sent) return Promise.resolve(true)
      if (!renewsAfterRefusal(current, platform.now(), policy)) return Promise.resolve(false)
      refused = sent
      current = undefined
      return Promise.resolve(true)
    },
  }
}
