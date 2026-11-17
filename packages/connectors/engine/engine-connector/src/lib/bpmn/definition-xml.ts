import type { Client } from "@miragon/pulse-c7-client"
import { getProcessDefinitionBpmn20Xml } from "@miragon/pulse-c7-client/sdk"
import { createOwnerCache, engineClientKey } from "../engine/per-engine.js"

/** A definition's XML never changes (a redeploy mints a new id); the bound only caps memory. */
const XML_CACHE_ENTRIES = 64

const xmlCache = createOwnerCache<string | null>({ maxEntries: XML_CACHE_ENTRIES })

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
