/**
 * The process definitions as the engine lists them: every deployed version with the count of its
 * running instances (`/process-definition/statistics`), and the BPMN XML a version was deployed
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

/** A version with the count of its running instances. */
export interface DefinitionStatisticsRow {
  readonly definition: DefinitionRow
  readonly instances: number
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

/** Every deployed version with its running instances, in one request. */
export async function readDefinitionStatistics(
  port: EnginePort,
): Promise<DefinitionStatisticsRow[]> {
  const answer = await port.json("getProcessDefinitionStatistics", queryInput({}))
  return JsonView.listOf(answer, "definition statistics").map((row) => ({
    definition: definitionRowOf(row.object("definition", "statistics definition")),
    instances: row.requiredNumber("instances"),
  }))
}

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
