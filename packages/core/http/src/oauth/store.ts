/**
 * Keeping tokens: a store in memory for a server or an editor, and the key a token is kept
 * under, a SHA-256 digest, so no secret that goes into it ever stands in clear as a key.
 */
import type { TokenRecord, TokenStore } from "./types.js"

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
