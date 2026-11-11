/**
 * Keeping tokens: a store in memory for a server or an editor, the key a token is kept under, a
 * SHA-256 digest, so no secret that goes into it ever stands in clear as a key, and the one rule
 * for a renewal under a store's lock that every token source reads.
 */
import { isPassing } from "./failure.js"
import type { TokenRecord, TokenStore } from "./types.js"

/** The store could not take its lock, so nothing was sent: `cause` is the store's own failure. */
class Busy {
  constructor(readonly cause: unknown) {}
}

/**
 * `store.exclusive`, with a lock it cannot take thrown as `Busy`: a store throws before `work`
 * starts then (`TokenStore.exclusive`), and its caller keeps a still valid token; what fails under
 * the lock is thrown as it is.
 */
export async function underLock<T>(
  store: TokenStore,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const lock = { taken: false }
  try {
    return await store.exclusive(key, () => {
      lock.taken = true
      return work()
    })
  } catch (error) {
    throw lock.taken ? error : new Busy(error)
  }
}

/**
 * Whether a renewal that threw `error` failed for a passing reason, so a still valid token goes
 * out: a busy lock or a failure that passes (`isPassing`: no answer, a 5xx, a rate limit).
 */
export function isPassingRenewal(error: unknown): boolean {
  return error instanceof Busy || isPassing(error)
}

/** What a renewal threw, as its caller sees it: the store's own failure for a busy lock. */
export function causeOf(error: unknown): unknown {
  return error instanceof Busy ? error.cause : error
}

/**
 * The key of whatever `identity` names (an endpoint, a client, its secret, an audience, the
 * scopes): the SHA-256 of its JSON, in hex. The caller orders what must not matter (sorted
 * scopes), so two equal identities share one key.
 */
export async function tokenKey(identity: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(identity))
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * A store in memory, for one process: its lock queues the holders of a key one after the other,
 * so concurrent renewals of one token send one request.
 */
export function memoryTokenStore(): TokenStore {
  const records = new Map<string, TokenRecord>()
  const tails = new Map<string, Promise<unknown>>()
  return {
    read: (key) => Promise.resolve(records.get(key)),
    write: (key, record) => {
      records.set(key, record)
      return Promise.resolve()
    },
    exclusive: <T>(key: string, work: () => Promise<T>): Promise<T> => {
      const before = tails.get(key) ?? Promise.resolve()
      const run = before.then(work)
      // The next holder waits for this one, however it ends.
      tails.set(
        key,
        run.then(
          () => undefined,
          () => undefined,
        ),
      )
      return run
    },
  }
}
