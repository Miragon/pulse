/**
 * Tokens a command prints (the CLI's token command, a cloud CLI's `print-access-token`): run when
 * no token is fresh, a token of known expiry kept in the store until shortly before it expires,
 * so later and parallel callers do not run the command again, one of unknown expiry (an opaque
 * token) used by this source until a 401, and after a 401 run once more (an old enough token
 * only), which helps only when the command printed another token. That token goes out with the
 * attempt it was printed for, even when the policy finds it due at once.
 */
import type { TokenSource } from "../credential.js"
import { EXPIRY, isDue, isExpired, renewsAfterRefusal } from "./expiry.js"
import { jwtClaims } from "./jwt.js"
import type { ExpiryPolicy, TokenRecord, TokenStore } from "./types.js"

export interface CommandOptions {
  /** The command's key in the store (`tokenKey` of the command line and its scope). */
  readonly key: string
  /** The clock: a command's token counts its lifetime from when the command printed it. */
  now(): number
  /** Keeps a token of known expiry beyond this source; one of unknown expiry is never kept. */
  readonly store?: TokenStore
  readonly policy?: ExpiryPolicy
  /** When a printed token expires (epoch ms): a JWT's `exp` by default, none for an opaque one. */
  readonly expiryOf?: (token: string) => number | undefined
}

const jwtExpiry = (token: string): number | undefined => jwtClaims(token)?.expiresAt ?? undefined

/**
 * A renewing token source over `run`, which runs the command and returns its token (checked:
 * an RFC 6750 b64token) or throws its own failure.
 */
export function commandTokens(run: () => Promise<string>, options: CommandOptions): TokenSource {
  const { key, store, policy = EXPIRY, expiryOf = jwtExpiry } = options
  const now = (): number => options.now()
  let current: TokenRecord | undefined
  /** The token a 401 brought, sent once more without asking the policy. */
  let retry: string | undefined

  const fresh = (record: TokenRecord | undefined): record is TokenRecord =>
    record !== undefined && !isDue(record, now(), policy)

  const ran = async (): Promise<TokenRecord> => {
    const accessToken = await run()
    const expiresAt = expiryOf(accessToken)
    const record = { accessToken, receivedAt: now(), expiresAt }
    if (expiresAt !== undefined) await store?.write(key, record)
    return record
  }

  /** The store's token while it is fresh and not `refused`, else the command's. */
  const renewed = async (refused?: string): Promise<TokenRecord> => {
    if (store === undefined) return ran()
    return store.exclusive(key, async () => {
      const kept = await store.read(key)
      return fresh(kept) && kept.accessToken !== refused ? kept : ran()
    })
  }

  return {
    renewable: true,
    async token() {
      const retried = retry
      retry = undefined
      if (current !== undefined && current.accessToken === retried && !isExpired(current, now())) {
        return current.accessToken
      }
      if (!fresh(current)) current = await renewed()
      return current.accessToken
    },
    async rejected(sent) {
      if (current?.accessToken !== sent) return true
      if (!renewsAfterRefusal(current, now(), policy)) return false
      current = await renewed(sent)
      if (current.accessToken === sent) return false
      retry = current.accessToken
      return true
    },
  }
}
