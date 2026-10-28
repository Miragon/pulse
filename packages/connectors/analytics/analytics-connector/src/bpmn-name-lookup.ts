import { callerCacheKey, parseBpmnNames } from "@miragon/pulse-widget-shell/server"
import type { NameIndex, ProcessNames } from "./bpmn-names.js"

/**
 * BPMN-XML lookup injected by the host app. `null` means the engine has no such
 * definition; a failed read REJECTS, so "not there" never gets cached as "not now".
 */
export type FetchBpmnXml = (
  processDefinitionKey: string,
  engineId?: string,
) => Promise<string | null>

export interface NameRequest {
  /** Per key, the elements whose names the view shows; a key left out gets every named element. */
  elementIds?: Readonly<Record<string, readonly string[]>>
  /** Preferred over {@link NameRequest.engines}. */
  enginesByKey?: Readonly<Record<string, readonly string[]>>
  /** Fallback for a key without its own list: the first engine whose model has it names it. */
  engines?: readonly string[] | null
}

export type NameLookup = (keys: Iterable<string>, request?: NameRequest) => Promise<NameIndex>

/** A lookup that knows no names: what a server without the camunda7 module has. */
export const NO_NAMES: NameLookup = () => Promise.resolve({})

export interface NameLookupOptions {
  /** Names are enrichment: a slow engine must not hold up the figures. */
  timeoutMs?: number
  /** Diagrams change with a deployment, not per call. */
  ttlMs?: number
  /** The most keys one view looks up, in the order it names them; the rest show their ids. */
  maxKeys?: number
  /** The most answers kept; the oldest go first. */
  maxEntries?: number
  /**
   * Cache partition. With passthrough auth the engine answers with the caller's
   * permissions, so one caller's answer must never serve another.
   */
  caller?: () => string
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 2_000
const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_KEYS = 40
const DEFAULT_MAX_ENTRIES = 2_000

/** One engine's answer: the names, `null` for "no such model", `undefined` for a failed read. */
type Answer = ProcessNames | null | undefined

/**
 * Caches each engine's answer (incl. "no such model") per caller for `ttlMs`, never
 * a failed read. Never fails: a key without an answer shows its id.
 */
export function createNameLookup(
  fetchBpmnXml: FetchBpmnXml | undefined,
  options: NameLookupOptions = {},
): NameLookup {
  if (!fetchBpmnXml) return NO_NAMES
  const fetchXml = fetchBpmnXml
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const now = options.now ?? Date.now
  const callerOf = options.caller ?? callerCacheKey
  /** (caller, engine, key) → that engine's answer for that caller, oldest first. */
  const cache = new Map<string, { at: number; names: ProcessNames | null }>()

  function remember(id: string, names: ProcessNames | null): void {
    // Re-inserted at the end, so the map stays oldest first.
    cache.delete(id)
    cache.set(id, { at: now(), names })
    for (const oldest of cache.keys()) {
      if (cache.size <= maxEntries) break
      cache.delete(oldest)
    }
  }

  function readOn(caller: string, engine: string | undefined, key: string): Promise<Answer> {
    const id = JSON.stringify([caller, engine ?? null, key])
    const hit = cache.get(id)
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.names)
    return Promise.resolve()
      .then(() => fetchXml(key, engine))
      .then(
        (xml) => {
          const names = xml ? parseBpmnNames(xml, key) : null
          remember(id, names)
          return names
        },
        // A failed read is no answer: not kept, the next view asks again.
        () => undefined,
      )
  }

  return async (keys, request = {}) => {
    const caller = callerOf()
    const unique = [...new Set(keys)].filter((key) => key.length > 0).slice(0, maxKeys)
    const deadline = startDeadline(timeoutMs)

    async function namesOf(key: string): Promise<ProcessNames | null> {
      for (const engine of enginesFor(key, request)) {
        const names = await Promise.race([readOn(caller, engine, key), deadline.passed])
        if (names) return names
        if (deadline.expired()) break
      }
      return null
    }

    try {
      const reads = await Promise.all(unique.map(async (key) => [key, await namesOf(key)] as const))
      const index: NameIndex = {}
      for (const [key, names] of reads) {
        if (!names) continue
        const wanted = own(request.elementIds, key)
        index[key] = {
          name: names.name,
          elements: wanted ? pick(names.elements, wanted) : names.elements,
        }
      }
      return index
    } finally {
      deadline.clear()
    }
  }
}

/** Own property only: a key such as `constructor` is no inherited lookup. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record && Object.hasOwn(record, key) ? record[key] : undefined
}

function enginesFor(key: string, request: NameRequest): ReadonlyArray<string | undefined> {
  const mine = own(request.enginesByKey, key)
  if (mine && mine.length > 0) return mine
  if (request.engines && request.engines.length > 0) return request.engines
  return [undefined]
}

function pick(elements: Record<string, string>, ids: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids) if (Object.hasOwn(elements, id)) out[id] = elements[id]
  return out
}

/** `clear` stops the timer, so a fast view leaves nothing pending. */
function startDeadline(ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let expired = false
  const passed = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      expired = true
      resolve(undefined)
    }, ms)
  })
  return { passed, expired: () => expired, clear: () => clearTimeout(timer) }
}
