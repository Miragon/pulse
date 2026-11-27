import type { Client } from "@miragon/pulse-c7-client"
import { callerCacheKey } from "@miragon/pulse-widget-shell/server"
import { cancellationOf } from "./runtime-errors.js"

/**
 * The engine client behind `client`: every call reaches its engine through a per-call view
 * (`withCallerSignal`, bound to the MCP request's signal) that shares the client's interceptors,
 * so what the module keeps per engine keys on them, not on the view, and the tools and the feeds
 * share it per configured engine. A stand-in client without interceptors keys on itself.
 */
export function engineClientKey(client: Client): object {
  const { interceptors } = client as Partial<Pick<Client, "interceptors">>
  return interceptors ?? client
}

/**
 * A read the caller that started it cancelled (its MCP request's signal), not the engine, on
 * either wire the server reads (`cancellationOf`).
 */
function isCancelled(error: unknown): boolean {
  return cancellationOf(error) !== undefined
}

interface CallerCacheOptions {
  /** Entries per owner (per engine client for a caller cache); past it the least recently used one goes. */
  maxEntries: number
  /** How long an entry answers, from the start of its read; default: for good. */
  ttlMs?: number
  /** The clock the TTL reads (tests pass their own). */
  now?: () => number
}

/** Answers `id` from the cache, or from `read` (which reaches the engine through `client`). */
export type CallerCache<T> = (client: Client, id: string, read: () => Promise<T>) => Promise<T>

export interface OwnerCacheOptions<T> extends CallerCacheOptions {
  /**
   * Whether a value that answered stays for the TTL; default: every one. A value it refuses
   * answers the calls that shared its read and goes then.
   */
  keep?: (value: T) => boolean
  /**
   * When the oldest read a value holds was sent, its TTL running from then once it answered: a
   * value built on a kept read ages with that read. Default: the start of its own read.
   */
  readAt?: (value: T) => number
  /**
   * Whether a write to its owner's engine drops every caller's entries of that owner
   * (`dropAfterWrite`), so the next read after a write reads anew. Default: no.
   */
  dropOnWrite?: boolean
}

/** Answers `id` of `owner` from the cache, or from `read`. */
export type OwnerCache<T> = (owner: object, id: string, read: () => Promise<T>) => Promise<T>

interface Entry<T> {
  read: Promise<T>
  at: number
}

/** Each cache's entries per owner, of the caches a write to the owner's engine drops. */
const droppedOnWrite = new Set<WeakMap<object, unknown>>()

/**
 * After a write to the engine `owner` stands for (an engine client's interceptors,
 * `engineClientKey`): every caller's entries of that owner in the caches made with `dropOnWrite`
 * go, so the views a write changed read anew. Every other cache keeps its entries.
 */
export function dropAfterWrite(owner: object): void {
  for (const caches of droppedOnWrite) caches.delete(owner)
}

/**
 * Reads kept per owner (an engine client's interceptors, a board, whatever the reads belong to)
 * and per CALLER: under passthrough auth the engine decides per token what a caller may read.
 * Concurrent calls share one read; a failed read is not kept, and neither is a value `keep`
 * refuses. A shared read runs on the signal of the call that started it: when THAT call is
 * cancelled, the read is dropped and a joiner reads again through its own view, so only its own
 * cancellation fails it. With `dropOnWrite`, a write to the owner's engine drops the owner's
 * entries (`dropAfterWrite`): a read in flight then answers its callers and is kept no longer.
 */
export function createOwnerCache<T>({
  maxEntries,
  ttlMs = Infinity,
  now = Date.now,
  keep = () => true,
  readAt = () => Infinity,
  dropOnWrite = false,
}: OwnerCacheOptions<T>): OwnerCache<T> {
  const caches = new WeakMap<object, Map<string, Entry<T>>>()
  if (dropOnWrite) droppedOnWrite.add(caches)
  const cached: OwnerCache<T> = (owner, id, read) => {
    let entries = caches.get(owner)
    if (!entries) {
      entries = new Map()
      caches.set(owner, entries)
    }
    const slot = JSON.stringify([callerCacheKey(), id])
    const hit = entries.get(slot)
    entries.delete(slot)
    if (hit && now() - hit.at < ttlMs) {
      entries.set(slot, hit)
      return hit.read.catch((error: unknown) => {
        if (!isCancelled(error)) throw error
        return cached(owner, id, read)
      })
    }
    // Async, so even a synchronous failure reaches the callers as a rejection.
    const entry: Entry<T> = { read: (async () => read())(), at: now() }
    entries.set(slot, entry)
    const kept = entries
    const drop = () => {
      if (kept.get(slot) === entry) kept.delete(slot)
    }
    entry.read.then((value) => {
      if (!keep(value)) drop()
      entry.at = Math.min(entry.at, readAt(value))
    }, drop)
    for (const oldest of kept.keys()) {
      if (kept.size <= maxEntries) break
      kept.delete(oldest)
    }
    return entry.read
  }
  return cached
}

/** Reads kept per engine client and per caller (`createOwnerCache`, the client its owner). */
export function createCallerCache<T>(options: OwnerCacheOptions<T>): CallerCache<T> {
  const cached = createOwnerCache<T>(options)
  return (client, id, read) => cached(engineClientKey(client), id, read)
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
