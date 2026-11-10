/**
 * Tokens of the client credentials grant (RFC 6749 §4.4), after the C8 adapter of Pulse for VS
 * Code (#543): one request for every caller at a time, a new token shortly before the old one
 * expires, and after a refusal or a failure a hold, so a wrong secret costs one request a minute
 * and a rate limit is waited out as its Retry-After asks. After a 401 only a token old enough
 * gets renewed: a young one was refused for another reason (a wrong audience), which a new token
 * does not mend.
 */
import type { TokenSource } from "../credential.js"
import type { Platform } from "../types.js"
import { EXPIRY, isDue, renewsAfterRefusal } from "./expiry.js"
import { TokenFailure } from "./failure.js"
import { tokenKey } from "./store.js"
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
  readonly policy?: ExpiryPolicy
  readonly limits?: TokenLimits
}

interface Hold {
  readonly failure: TokenFailure
  readonly since: number
  readonly until: number
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

/** A renewing token source over the client credentials grant: see the module comment. */
export function clientCredentialsTokens(options: ClientCredentialsOptions): TokenSource {
  const { endpoint, grant, platform, store, policy = EXPIRY, limits } = options
  let current: TokenRecord | undefined
  /** A token the endpoint's API refused: never taken over from the store again. */
  let refused: string | undefined
  let pending: Promise<TokenRecord> | undefined
  let hold: Hold | undefined

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
    return keep.exclusive(key, async () => {
      const found = await keep.read(key)
      if (
        found !== undefined &&
        found.accessToken !== refused &&
        !isDue(found, platform.now(), policy)
      ) {
        current = found
        return found
      }
      const record = await requested()
      await keep.write(key, record)
      return record
    })
  }

  const held = (now: number): TokenFailure | undefined =>
    hold !== undefined && hold.since <= now && now < hold.until ? hold.failure : undefined

  return {
    renewable: true,
    async token() {
      const now = platform.now()
      if (current !== undefined && !isDue(current, now, policy)) return current.accessToken
      const failure = held(now)
      if (failure !== undefined) throw failure
      pending ??= (store === undefined ? requested() : stored(store)).finally(() => {
        pending = undefined
      })
      return (await pending).accessToken
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
