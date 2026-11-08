import { type Client, EngineRequestError } from "@miragon/pulse-engine-client"
import { getProcessDefinitionBpmn20Xml } from "@miragon/pulse-engine-client/sdk"
import { callerCacheKey } from "@miragon/pulse-widget-shell/server"

/** A definition's XML never changes (a redeploy mints a new id); the bound only caps memory. */
const XML_CACHE_ENTRIES = 64

const xmlCache = new WeakMap<object, Map<string, Promise<string | null>>>()

/**
 * The engine client behind `client`: every call reaches its engine through a per-call view
 * (`withCallerSignal`, bound to the MCP request's signal) that shares the client's interceptors,
 * so the cache keys on them, not on the view, and the tools and the feeds share one cache per
 * configured engine. A stand-in client without interceptors keys on itself.
 */
function cacheKeyOf(client: Client): object {
  const { interceptors } = client as Partial<Pick<Client, "interceptors">>
  return interceptors ?? client
}

/** A read the caller that started it cancelled (its MCP request's signal), not the engine. */
function isCancelled(error: unknown): boolean {
  return error instanceof EngineRequestError && error.kind === "cancelled"
}

/**
 * The ONE XML read of this module. Failed reads propagate and are not kept.
 * Cached per engine client and per CALLER: under passthrough auth the engine decides per token
 * what a caller may read.
 */
export function fetchDefinitionXml(client: Client, definitionId: string): Promise<string | null> {
  const key = cacheKeyOf(client)
  let cache = xmlCache.get(key)
  if (!cache) {
    cache = new Map()
    xmlCache.set(key, cache)
  }
  const id = JSON.stringify([callerCacheKey(), definitionId])
  const hit = cache.get(id)
  if (hit) {
    cache.delete(id)
    cache.set(id, hit)
    // A shared read runs on the signal of the call that started it. When THAT call is cancelled,
    // the read is dropped (below) and a joiner reads again through its own view: its own
    // cancellation then fails it, nobody else's.
    return hit.catch((error: unknown) => {
      if (!isCancelled(error)) throw error
      return fetchDefinitionXml(client, definitionId)
    })
  }
  // Async, so even a synchronous failure reaches the callers' enrichment guards as a rejection.
  const read = (async () => {
    const reply = await getProcessDefinitionBpmn20Xml({ client, path: { id: definitionId } })
    return (reply as { bpmn20Xml?: string | null } | null)?.bpmn20Xml ?? null
  })()
  cache.set(id, read)
  const entries = cache
  read.catch(() => {
    if (entries.get(id) === read) entries.delete(id)
  })
  for (const oldest of entries.keys()) {
    if (entries.size <= XML_CACHE_ENTRIES) break
    entries.delete(oldest)
  }
  return read
}
