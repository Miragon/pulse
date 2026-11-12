/**
 * Tokens a command prints (the CLI's token command, a cloud CLI's `print-access-token`): run when
 * no token is fresh, once for every caller at a time, so parallel reads (and the 401s they get)
 * wait for one run and send its token; a run that fails fails each of them once, and the next read
 * runs the command anew, never sending the token a 401 refused. A token of known expiry is kept in
 * the store until shortly before it expires, so later callers and a source built anew do not run
 * the command again, one of unknown expiry (an opaque token) is used by this source until a 401;
 * after a 401 the command runs once more (for an old enough token only), which helps only when it
 * printed another token. That token goes out with the attempt it was printed for even when the
 * policy finds it due at once (a lifetime of 5 s or less), for one attempt only: after parallel
 * 401s the others run the command again, as the policy renews such a token for every request.
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
  /** The token a 401 refused, until a run brings one: no read sends it, a run never takes it. */
  let refused: string | undefined
  /** The run under way: every caller meanwhile waits for it instead of running the command. */
  let pending: Promise<TokenRecord> | undefined

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
  const renewed = async (): Promise<TokenRecord> => {
    if (store === undefined) return ran()
    return store.exclusive(key, async () => {
      const kept = await store.read(key)
      return fresh(kept) && kept.accessToken !== refused ? kept : ran()
    })
  }

  /** One renewal for every caller at a time; once it ends, failed or not, the next may start. */
  const shared = (): Promise<TokenRecord> => {
    pending ??= renewed()
      .then((record) => {
        refused = undefined
        return (current = record)
      })
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  return {
    renewable: true,
    async token() {
      const retried = retry
      retry = undefined
      if (current !== undefined && current.accessToken === retried && !isExpired(current, now())) {
        return current.accessToken
      }
      // A token a 401 refused waits for the run under way, or after one that failed, starts one.
      if (fresh(current) && current.accessToken !== refused) return current.accessToken
      return (await shared()).accessToken
    },
    async rejected(sent) {
      if (current?.accessToken !== sent) return true
      if (!renewsAfterRefusal(current, now(), policy)) return false
      refused = sent
      const renewal = await shared()
      if (renewal.accessToken === sent) return false
      retry = renewal.accessToken
      return true
    },
  }
}
