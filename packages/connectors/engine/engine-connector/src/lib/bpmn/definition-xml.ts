import type { Client } from "@miragon/pulse-c7-client"
import { getProcessDefinitionBpmn20Xml } from "@miragon/pulse-c7-client/sdk"
import { createCallerCache } from "../engine/per-engine.js"

/** A definition's XML never changes (a redeploy mints a new id); the bound only caps memory. */
const XML_CACHE_ENTRIES = 64

const xmlCache = createCallerCache<string | null>({ maxEntries: XML_CACHE_ENTRIES })

/**
 * The ONE XML read of this module. Failed reads propagate and are not kept.
 * Cached per engine client and per CALLER: under passthrough auth the engine decides per token
 * what a caller may read.
 */
export function fetchDefinitionXml(client: Client, definitionId: string): Promise<string | null> {
  return xmlCache(client, definitionId, async () => {
    const reply = await getProcessDefinitionBpmn20Xml({ client, path: { id: definitionId } })
    return (reply as { bpmn20Xml?: string | null } | null)?.bpmn20Xml ?? null
  })
}
