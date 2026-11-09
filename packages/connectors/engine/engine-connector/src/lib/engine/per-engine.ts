import type { Client } from "@miragon/pulse-c7-client"
import { callerCacheKey } from "@miragon/pulse-widget-shell/server"
import { EngineRequestError } from "./engine-error.js"

/**
 * The engine client behind `client`: every call reaches its engine through a per-call view
 * (`withCallerSignal`, bound to the MCP request's signal) that shares the client's interceptors,
 * so what the module keeps per engine keys on them, not on the view, and the tools and the feeds
 * share it per configured engine. A stand-in client without interceptors keys on itself.
 */
function engineClientKey(client: Client): object {
  const { interceptors } = client as Partial<Pick<Client, "interceptors">>
  return interceptors ?? client
}

/** A read the caller that started it cancelled (its MCP request's signal), not the engine. */
function isCancelled(error: unknown): boolean {
  return error instanceof EngineRequestError && error.kind === "cancelled"
}

export interface CallerCacheOptions {
  /** Entries per engine client; past it the least recently used one goes. */
  maxEntries: number
  /** How long an entry answers, from the start of its read; default: for good. */
  ttlMs?: number
  /** The clock the TTL reads (tests pass their own). */
  now?: () => number
}

/** Answers `id` from the cache, or from `read` (which reaches the engine through `client`). */
export type CallerCache<T> = (client: Client, id: string, read: () => Promise<T>) => Promise<T>

interface Entry<T> {
  read: Promise<T>
  at: number
}

/**
 * Reads kept per engine client and per CALLER: under passthrough auth the engine decides per
 * token what a caller may read. Concurrent calls share one read; a failed read is not kept. A
 * shared read runs on the signal of the call that started it: when THAT call is cancelled, the
 * read is dropped and a joiner reads again through its own view, so only its own cancellation
 * fails it.
 */
export function createCallerCache<T>({
  maxEntries,
  ttlMs = Infinity,
  now = Date.now,
}: CallerCacheOptions): CallerCache<T> {
  const caches = new WeakMap<object, Map<string, Entry<T>>>()
  const cached: CallerCache<T> = (client, id, read) => {
    const key = engineClientKey(client)
    let entries = caches.get(key)
    if (!entries) {
      entries = new Map()
      caches.set(key, entries)
    }
    const slot = JSON.stringify([callerCacheKey(), id])
    const hit = entries.get(slot)
    entries.delete(slot)
    if (hit && now() - hit.at < ttlMs) {
      entries.set(slot, hit)
      return hit.read.catch((error: unknown) => {
        if (!isCancelled(error)) throw error
        return cached(client, id, read)
      })
    }
    // Async, so even a synchronous failure reaches the callers as a rejection.
    const entry: Entry<T> = { read: (async () => read())(), at: now() }
    entries.set(slot, entry)
    const kept = entries
    entry.read.catch(() => {
      if (kept.get(slot) === entry) kept.delete(slot)
    })
    for (const oldest of kept.keys()) {
      if (kept.size <= maxEntries) break
      kept.delete(oldest)
    }
    return entry.read
  }
  return cached
}

const turns = new WeakMap<object, Promise<void>>()

/**
 * Runs `read` once every earlier read through this gate on the same engine has settled: one at a
 * time per configured engine, whoever asks. For a read that loads the engine's database (the
 * history statistics); a queued read whose caller has gone fails fast on its cancelled signal.
 */
export function oneAtATime<T>(client: Client, read: () => Promise<T>): Promise<T> {
  const key = engineClientKey(client)
  const turn = (turns.get(key) ?? Promise.resolve()).then(read)
  turns.set(
    key,
    turn.then(
      () => undefined,
      () => undefined,
    ),
  )
  return turn
}
