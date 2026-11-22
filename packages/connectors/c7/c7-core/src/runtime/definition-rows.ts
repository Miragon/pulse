/**
 * The process definitions as the engine lists them: every deployed version with the count of its
 * running instances and of its open root incidents (`/process-definition/statistics` with
 * `rootIncidents=true`, whose counts per incident type it sums; a copy a call activity holds of an
 * incident in a called instance is no root incident), and the BPMN XML a version was deployed
 * with. Each answer is read through `JsonView`, so an unusable one fails as
 * `RuntimeError("unexpectedResponse")`.
 */

import type { EnginePort } from "../port.js"
import { queryInput } from "../requests.js"
import { compact } from "../util.js"
import { isEngineId } from "./engine-ids.js"
import { findUnlessGone } from "./find-unless-gone.js"
import { JsonView } from "./json-view.js"

/** A deployed version of a process: its id, key, version and what it names. */
export interface DefinitionRow {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly name?: string
  readonly deploymentId?: string
  readonly versionTag?: string
}

/** A version with the count of its running instances and of its open root incidents. */
export interface DefinitionStatisticsRow {
  readonly definition: DefinitionRow
  readonly instances: number
  readonly rootIncidents: number
}

function definitionRowOf(record: JsonView): DefinitionRow {
  return {
    id: record.requiredString("id"),
    key: record.requiredString("key"),
    version: record.requiredNumber("version"),
    ...compact({
      name: record.optionalString("name"),
      deploymentId: record.optionalString("deploymentId"),
      versionTag: record.optionalString("versionTag"),
    }),
  }
}

/** The open root incidents of a statistics row: the sum of its counts per incident type. */
function rootIncidentsOf(row: JsonView): number {
  return row
    .optionalList("incidents")
    .reduce((sum, type) => sum + type.requiredNumber("incidentCount"), 0)
}

/**
 * Every deployed version with its running instances and open root incidents, in one request: the
 * one shape of the statistics read, which the definitions and versions read for their counts and
 * the incident search's version refs and the called processes for the versions alone, the root
 * incidents one grouped subquery over the open incidents beside the instances it already counts.
 */
export async function readDefinitionStatistics(
  port: EnginePort,
): Promise<DefinitionStatisticsRow[]> {
  const answer = await port.json(
    "getProcessDefinitionStatistics",
    queryInput({ rootIncidents: "true" }),
  )
  return JsonView.listOf(answer, "definition statistics").map((row) => ({
    definition: definitionRowOf(row.object("definition", "statistics definition")),
    instances: row.requiredNumber("instances"),
    rootIncidents: rootIncidentsOf(row),
  }))
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
