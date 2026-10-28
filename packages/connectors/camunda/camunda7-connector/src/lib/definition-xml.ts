import type { Client } from "@miragon/pulse-camunda7-client"
import { getProcessDefinitionBpmn20Xml } from "@miragon/pulse-camunda7-client/sdk"
import { callerCacheKey } from "@miragon/pulse-widget-shell/server"

/** A definition's XML never changes (a redeploy mints a new id); the bound only caps memory. */
const XML_CACHE_ENTRIES = 64

const xmlCache = new WeakMap<Client, Map<string, Promise<string | null>>>()

/**
 * The ONE XML read of this module. Failed reads propagate and are not kept.
 * Cached per CALLER: under passthrough auth the engine decides per token what a caller may read.
 */
export function fetchDefinitionXml(client: Client, definitionId: string): Promise<string | null> {
  let cache = xmlCache.get(client)
  if (!cache) {
    cache = new Map()
    xmlCache.set(client, cache)
  }
  const id = JSON.stringify([callerCacheKey(), definitionId])
  const hit = cache.get(id)
  if (hit) {
    cache.delete(id)
    cache.set(id, hit)
    return hit
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
