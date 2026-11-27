/**
 * The BPMN XML a version was deployed with, read through `JsonView`, so an unusable answer fails as
 * `RuntimeError("unexpectedResponse")`. The versions themselves and their counts are the definition
 * statistics of the main entry (`../definition-statistics.ts`), which the status triage reads too.
 */

import type { EnginePort } from "../port.js"
import { isEngineId } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { JsonView } from "../json-view.js"

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
