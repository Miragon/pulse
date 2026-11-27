import type { Client } from "@miragon/pulse-c7-client"
import { callerCacheKey } from "@miragon/pulse-widget-shell/server"
import type { RuntimeEngine } from "./resolve-engine.js"
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
 * What the module keeps per configured engine keys on, for an engine a dialect-neutral read
 * resolved (`resolveRuntimeEngine`): a Camunda 7 engine's client (`engineClientKey`), else its
 * backend.
 */
export function runtimeEngineKey(engine: RuntimeEngine): object {
  return "client" in engine ? engineClientKey(engine.client) : engine.backend
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

/** One read of a held cache (`createHeldCache`): its answer, and how to take it off the cache. */
export interface HeldRead<T> {
  readonly read: Promise<T>
  /**
   * Takes the read this call waits on off the cache, if the cache still holds it: the next call
   * reads anew and the read's answer is kept nowhere, while the calls that share it still wait on
   * it. For a read its caller gave up on while it is out (a board's deadline cut it).
   */
  release(): void
}

/** Answers `id` of `owner` from the cache, or from `read`, with the handle that releases it. */
export type HeldCache<T> = (owner: object, id: string, read: () => Promise<T>) => HeldRead<T>

/** Takes `entry` out of `slot` of `entries`, only while the slot still holds it. */
const releaseOf =
  <T>(entries: Map<string, Entry<T>>, slot: string, entry: Entry<T>) =>
  (): void => {
    if (entries.get(slot) === entry) entries.delete(slot)
  }

/**
 * A call that shares `hit`, a read another call started: when THAT call was cancelled, it reads
 * again through its own view (`again`), so only its own cancellation fails it. Its release takes
 * off whichever read it waits on.
 */
function joined<T>(hit: Entry<T>, release: () => void, again: () => HeldRead<T>): HeldRead<T> {
  let retried: HeldRead<T> | undefined
  return {
    read: hit.read.catch((error: unknown) => {
      if (!isCancelled(error)) throw error
      retried = again()
      return retried.read
    }),
    release: () => {
      release()
      retried?.release()
    },
  }
}

/**
 * Reads kept per owner (an engine client's interceptors, a board, whatever the reads belong to)
 * and per CALLER: under passthrough auth the engine decides per token what a caller may read.
 * Concurrent calls share one read; a failed read is not kept, and neither is a value `keep`
 * refuses, nor a read its call released while it was out (`HeldRead.release`). A shared read runs
 * on the signal of the call that started it: when THAT call is cancelled, the read is dropped and
 * a joiner reads again through its own view, so only its own cancellation fails it. With
 * `dropOnWrite`, a write to the owner's engine drops the owner's entries (`dropAfterWrite`): a read
 * in flight then answers its callers and is kept no longer.
 */
export function createHeldCache<T>({
  maxEntries,
  ttlMs = Infinity,
  now = Date.now,
  keep = () => true,
  readAt = () => Infinity,
  dropOnWrite = false,
}: OwnerCacheOptions<T>): HeldCache<T> {
  const caches = new WeakMap<object, Map<string, Entry<T>>>()
  if (dropOnWrite) droppedOnWrite.add(caches)
  const held: HeldCache<T> = (owner, id, read) => {
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
      return joined(hit, releaseOf(entries, slot, hit), () => held(owner, id, read))
    }
    // Async, so even a synchronous failure reaches the callers as a rejection.
    const entry: Entry<T> = { read: (async () => read())(), at: now() }
    entries.set(slot, entry)
    const kept = entries
    const drop = releaseOf(kept, slot, entry)
    entry.read.then((value) => {
      if (!keep(value)) drop()
      entry.at = Math.min(entry.at, readAt(value))
    }, drop)
    for (const oldest of kept.keys()) {
      if (kept.size <= maxEntries) break
      kept.delete(oldest)
    }
    return { read: entry.read, release: drop }
  }
  return held
}

/** Reads kept per owner and per caller (`createHeldCache`, without the handle). */
export function createOwnerCache<T>(options: OwnerCacheOptions<T>): OwnerCache<T> {
  const held = createHeldCache(options)
  return (owner, id, read) => held(owner, id, read).read
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
