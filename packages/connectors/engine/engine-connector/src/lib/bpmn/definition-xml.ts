import type { Client } from "@miragon/pulse-c7-client"
import { getProcessDefinitionBpmn20Xml } from "@miragon/pulse-c7-client/sdk"
import { createOwnerCache, engineClientKey } from "../engine/per-engine.js"

/**
 * A definition's XML never changes (a redeploy mints a new id); the bounds only cap memory: XMLs per
 * engine and caller, past it the caller's least recently used one goes. A caller opens a few
 * processes, each a diagram and those of its versions with an incident (`ElementStatisticsReader`).
 */
const XML_CACHE_ENTRIES = 8

/**
 * Callers whose XMLs an engine keeps, each counted once it holds one; past it the least recently
 * active caller's go. Per engine at most XML_CACHE_CALLERS × XML_CACHE_ENTRIES (128) XMLs, twice
 * the 64 for every caller together before, so 16 callers that read in turn never evict each other.
 */
const XML_CACHE_CALLERS = 16

const xmlCache = createOwnerCache<string | null>({
  maxEntries: XML_CACHE_ENTRIES,
  maxCallers: XML_CACHE_CALLERS,
})

/** Reads a definition's XML on its engine, or `null` when the engine has none for it. */
type DefinitionXmlReader = (definitionId: string) => Promise<string | null>

/**
 * The ONE XML cache of this module: a definition's XML kept for good per engine (`owner`: a
 * Camunda 7 client's, `engineClientKey`, or another dialect's configured engine) and per CALLER,
 * under passthrough auth the engine decides per token what a caller may read. `read` asks the
 * engine on a miss; a failed read propagates and is not kept.
 */
export function cachedDefinitionXml(
  owner: object,
  definitionId: string,
  read: DefinitionXmlReader,
): Promise<string | null> {
  return xmlCache(owner, definitionId, () => read(definitionId))
}

/** The ONE XML read of the Camunda 7 REST API, through the one XML cache under the engine's client. */
export function fetchDefinitionXml(client: Client, definitionId: string): Promise<string | null> {
  return cachedDefinitionXml(engineClientKey(client), definitionId, async (id) => {
    const reply = await getProcessDefinitionBpmn20Xml({ client, path: { id } })
    return (reply as { bpmn20Xml?: string | null } | null)?.bpmn20Xml ?? null
  })
}
