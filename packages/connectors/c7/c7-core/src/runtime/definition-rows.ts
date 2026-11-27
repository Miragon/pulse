/**
 * The BPMN XML a version was deployed with and the versions a read names by their ids or by the keys
 * of their processes, read through `JsonView`, so an unusable answer fails as
 * `RuntimeError("unexpectedResponse")`. The versions with their counts are the definition
 * statistics of the main entry (`../definition-statistics.ts`), which the status triage reads too;
 * a read that only names versions (an incident's, a called process's) reads them here, never the
 * statistics of the whole engine.
 */

import { type DefinitionRow, definitionRowsOf } from "../definition-statistics.js"
import { type EnginePort, PARALLEL } from "../port.js"
import { idChunks } from "../requests.js"
import { mapLimit } from "../util.js"
import { isEngineId } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { JsonView } from "../json-view.js"
import { readAll } from "./read-all.js"

/** The order the versions of a definitions read are paged in, so no page repeats or skips one. */
const BY_ID = { sortBy: "id", sortOrder: "asc" } as const

/** What a definitions read names its versions by: their ids, or the keys of their processes. */
export type DefinitionsBy = "processDefinitionIdIn" | "keysIn"

/**
 * The versions `values` names `by` their ids or by the keys of their processes (every version of a
 * key, of every tenant), each id or key once, 50 to a request and every page of each in the order
 * of their ids; none without a request where `values` names none.
 */
export async function readDefinitionRows(
  port: EnginePort,
  by: DefinitionsBy,
  values: readonly string[],
): Promise<DefinitionRow[]> {
  const chunks = idChunks([...new Set(values)])
  const pages = await mapLimit(chunks, PARALLEL, async (chunk) =>
    definitionRowsOf(await readAll(port, "getProcessDefinitions", { [by]: chunk, ...BY_ID })),
  )
  return pages.flat()
}

/**
 * A read of the BPMN XML a version was deployed with: undefined for a version the engine does not
 * know.
 */
export type DiagramRead = (definitionId: string) => Promise<string | undefined>

/**
 * The BPMN XML the version `definitionId` was deployed with; undefined for a version the engine
 * does not know and, without a request, for an id no engine assigns.
 */
export async function readDiagramXml(
  port: EnginePort,
  definitionId: string,
): Promise<string | undefined> {
  if (!isEngineId(definitionId)) return undefined
  const input = { pathArgs: [definitionId], query: {} }
  return findUnlessGone(port, "getProcessDefinitionBpmn20Xml", input, (answer) =>
    JsonView.of(answer, "definition XML").requiredString("bpmn20Xml"),
  )
}

/**
 * The runtime's read of a version's diagram: through `source`, the surface's own read where it
 * keeps the diagrams it read (the MCP server's one XML cache), else over `port`; an id no engine
 * assigns reads as none without a request either way.
 */
export function diagramReadOf(port: EnginePort, source?: DiagramRead): DiagramRead {
  if (source === undefined) return (definitionId) => readDiagramXml(port, definitionId)
  return (definitionId) =>
    isEngineId(definitionId) ? source(definitionId) : Promise.resolve(undefined)
}
