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
  /**
   * Entries per owner and CALLER (per engine client for a caller cache); past it the caller's least
   * recently used one goes, so one caller's reads never evict another's.
   */
  maxEntries: number
  /**
   * Callers kept per owner, counting only a caller that holds a kept answer (one whose reads
   * failed or were refused takes no place); past it the least recently active caller's entries go,
   * all of them. An owner keeps `maxEntries` × `maxCallers` answers at most. The calls that name no
   * caller and send no token (on a server without OAuth) share one caller, which keeps that whole
   * bound itself, so where they mix with calls that send one, an owner keeps up to twice as many.
   */
  maxCallers: number
  /** How long an entry answers, from the start of its read; default: for good. */
  ttlMs?: number
  /** The clock the TTL reads (tests pass their own). */
  now?: () => number
}

/** Answers `id` from the cache, or from `read` (which reaches the engine through `client`). */
export interface CallerCache<T> {
  (client: Client, id: string, read: () => Promise<T>): Promise<T>
  /** This caller's kept answer of `id` while it answers, without reading (`HeldCache.peek`). */
  readonly peek: (client: Client, id: string) => T | undefined
}

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
  /**
   * Whether a read still out answers every call that asks meanwhile, however long it waits, its
   * TTL running from its answer (or `readAt`, where that is older) instead of the start of its
   * read: for a read that queues for its engine's turn (`createGate`) before it starts. Default:
   * no.
   */
  ageFromAnswer?: boolean
}

/** Answers `id` of `owner` from the cache, or from `read`. */
export interface OwnerCache<T> {
  (owner: object, id: string, read: () => Promise<T>): Promise<T>
  /** This caller's kept answer of `id` while it answers, without reading (`HeldCache.peek`). */
  readonly peek: (owner: object, id: string) => T | undefined
}

interface Entry<T> {
  read: Promise<T>
  at: number
}

/** An entry whose read answered and stays, with its answer. */
interface Kept<T> extends Entry<T> {
  readonly value: T
}

/**
 * One owner's entries: the reads still out, by caller and id, and each caller's kept answers by
 * id, least recently used first, its callers least recently active first. A caller enters the
 * kept ones with its first kept answer and leaves them with its last.
 */
interface OwnerEntries<T> {
  readonly out: Map<string, Entry<T>>
  readonly kept: Map<string, Map<string, Kept<T>>>
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

/** Sets `key` of `map` to `value` as its most recently used. */
function touch<K, V>(map: Map<K, V>, key: K, value: V): V {
  map.delete(key)
  map.set(key, value)
  return value
}

/** Drops the least recently used of `map` until it holds `max` at most. */
function trim(map: Map<unknown, unknown>, max: number): void {
  for (const oldest of map.keys()) {
    if (map.size <= max) break
    map.delete(oldest)
  }
}

/** One read of a held cache (`createHeldCache`): its answer, and how to take it off the cache. */
export interface HeldRead<T> {
  readonly read: Promise<T>
  /**
   * Takes the read this call waits on off the cache while it is still out (a call that joined a
   * kept answer takes that answer off): the next call reads anew and the read's answer is kept
   * nowhere, while the calls that share it still wait on it. For a read its caller gave up on while
   * it is out (a board's deadline cut it).
   */
  release(): void
}

/** Answers `id` of `owner` from the cache, or from `read`, with the handle that releases it. */
export interface HeldCache<T> {
  (owner: object, id: string, read: () => Promise<T>): HeldRead<T>
  /**
   * This caller's kept answer of `id` of `owner` while it answers, without reading and without
   * waiting: none while its read is out, failed or was refused, or once its TTL ran out.
   */
  readonly peek: (owner: object, id: string) => T | undefined
}

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

/** The entries `caches` keeps of `owner`, made empty on its first read. */
function entriesOf<T>(caches: WeakMap<object, OwnerEntries<T>>, owner: object): OwnerEntries<T> {
  const known = caches.get(owner)
  if (known) return known
  const entries: OwnerEntries<T> = { out: new Map(), kept: new Map() }
  caches.set(owner, entries)
  return entries
}

/**
 * Takes `caller`'s kept answer of `id` out of `callers` while it is still `kept`, and the caller
 * with its last one.
 */
const forgetOf =
  <T>(callers: OwnerEntries<T>["kept"], caller: string, id: string, kept: Kept<T>) =>
  (): void => {
    const mine = callers.get(caller)
    if (mine?.get(id) !== kept) return
    mine.delete(id)
    if (mine.size === 0) callers.delete(caller)
  }

/**
 * Keeps `kept` as `caller`'s most recently used answer of `id`, the caller as the most recently
 * active of `callers`, each within its bound: `entries` answers per caller, `max` callers.
 */
function keepAnswer<T>(
  callers: OwnerEntries<T>["kept"],
  { caller, id, kept }: { caller: string; id: string; kept: Kept<T> },
  { entries, max }: { entries: number; max: number },
): void {
  const mine = touch(callers, caller, callers.get(caller) ?? new Map<string, Kept<T>>())
  touch(mine, id, kept)
  trim(mine, caller === "" ? entries * max : entries)
  trim(callers, max)
}

/**
 * Reads kept per owner (an engine client's interceptors, a board, whatever the reads belong to)
 * and per CALLER: under passthrough auth the engine decides per token what a caller may read.
 * Each caller's entries have a bound of their own (`maxEntries`), and an owner keeps its
 * `maxCallers` most recently active callers, so one caller's reads never evict another's.
 * Concurrent calls share one read; a failed read is not kept, and neither is a value `keep`
 * refuses, nor a read its call released while it was out (`HeldRead.release`), and a caller whose
 * reads were none of them kept takes no caller's place. A shared read runs on the signal of the
 * call that started it: when THAT call is cancelled, the read is dropped and a joiner reads again
 * through its own view, so only its own cancellation fails it. With `dropOnWrite`, a write to the
 * owner's engine drops the owner's entries of every caller (`dropAfterWrite`): a read in flight
 * then answers its callers and is kept no longer. With `ageFromAnswer`, a read in flight answers
 * every call of its caller regardless of the TTL, which runs from its answer (or `readAt`).
 */
export function createHeldCache<T>({
  maxEntries,
  maxCallers,
  ttlMs = Infinity,
  now = Date.now,
  keep = () => true,
  readAt = () => Infinity,
  dropOnWrite = false,
  ageFromAnswer = false,
}: OwnerCacheOptions<T>): HeldCache<T> {
  const caches = new WeakMap<object, OwnerEntries<T>>()
  if (dropOnWrite) droppedOnWrite.add(caches)
  const bounds = { entries: maxEntries, max: maxCallers }
  const answers = (entry: Entry<T> | undefined): entry is Entry<T> =>
    entry !== undefined && now() - entry.at < ttlMs
  const held = (owner: object, id: string, read: () => Promise<T>): HeldRead<T> => {
    const caller = callerCacheKey()
    const entries = entriesOf(caches, owner)
    const kept = entries.kept.get(caller)?.get(id)
    if (kept !== undefined) {
      const forget = forgetOf(entries.kept, caller, id, kept)
      if (answers(kept)) {
        keepAnswer(entries.kept, { caller, id, kept }, bounds)
        return joined(kept, forget, () => held(owner, id, read))
      }
      forget()
    }
    const slot = JSON.stringify([caller, id])
    const out = entries.out.get(slot)
    if (answers(out)) {
      return joined(out, releaseOf(entries.out, slot, out), () => held(owner, id, read))
    }
    // Async, so even a synchronous failure reaches the callers as a rejection.
    const entry: Entry<T> = { read: (async () => read())(), at: ageFromAnswer ? Infinity : now() }
    entries.out.set(slot, entry)
    const release = releaseOf(entries.out, slot, entry)
    entry.read.then((value) => {
      const stays = entries.out.get(slot) === entry && caches.get(owner) === entries && keep(value)
      release()
      const at = Math.min(ageFromAnswer ? now() : entry.at, readAt(value))
      const answer = { read: entry.read, at, value }
      if (stays) keepAnswer(entries.kept, { caller, id, kept: answer }, bounds)
    }, release)
    return { read: entry.read, release }
  }
  const peek = (owner: object, id: string): T | undefined => {
    const kept = caches.get(owner)?.kept.get(callerCacheKey())?.get(id)
    return answers(kept) ? kept.value : undefined
  }
  return Object.assign(held, { peek })
}

/** Reads kept per owner and per caller (`createHeldCache`, without the handle). */
export function createOwnerCache<T>(options: OwnerCacheOptions<T>): OwnerCache<T> {
  const held = createHeldCache(options)
  return Object.assign(
    (owner: object, id: string, read: () => Promise<T>) => held(owner, id, read).read,
    {
      peek: held.peek,
    },
  )
}

/** Reads kept per engine client and per caller (`createOwnerCache`, the client its owner). */
export function createCallerCache<T>(options: OwnerCacheOptions<T>): CallerCache<T> {
  const cached = createOwnerCache<T>(options)
  return Object.assign(
    (client: Client, id: string, read: () => Promise<T>) =>
      cached(engineClientKey(client), id, read),
    { peek: (client: Client, id: string) => cached.peek(engineClientKey(client), id) },
  )
}

/** A turn on the engine behind `client` for `read` (`createGate`). */
type Gate = <T>(client: Client, read: () => Promise<T>) => Promise<T>

/**
 * A gate of its own: runs `read` once every earlier read through THIS gate on the same engine has
 * settled, one at a time per configured engine, whoever asks, while a read through another gate
 * never waits for it. For reads that load the engine's database; a queued read whose caller has
 * gone fails fast on its cancelled signal. A read never passes its gate from inside its own turn:
 * it would wait for itself.
 */
export function createGate(): Gate {
  const turns = new WeakMap<object, Promise<void>>()
  return (client, read) => {
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
}

/**
 * The gate of the single reads that sort or sum the engine's history (`createGate`): the process
 * flow's Throughput statistics and a process's numbers' median and P90 ranks.
 */
export const oneAtATime: Gate = createGate()
