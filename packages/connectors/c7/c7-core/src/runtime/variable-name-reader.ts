/**
 * The variable names of a version (`listVariableNames` of the engine contract): the names the
 * history keeps for the version's newest instances, without their values, once each.
 */

import type { DefinitionId } from "@miragon/pulse-engine-core"
import type { EnginePort } from "../port.js"
import { RAW_VARIABLES_QUERY } from "../variables.js"
import { readHistoricInstances } from "./historic-instances.js"
import { JsonView } from "../json-view.js"

/** The newest instances of a version whose variables are named. */
const SAMPLED_INSTANCES = 50
/** The variables read of them at most. */
const MAX_NAMED_VARIABLES = 2000

/** Reads the variable names of a version over the engine's port. */
export class VariableNameReader {
  constructor(private readonly port: EnginePort) {}

  /** The names of the variables of the version's newest instances, sorted by code unit. */
  async names(definitionId: DefinitionId): Promise<string[]> {
    const instances = await readHistoricInstances(
      this.port,
      { processDefinitionId: definitionId },
      { firstResult: 0, maxResults: SAMPLED_INSTANCES },
    )
    if (instances.length === 0) {
      return []
    }
    const answer = await this.port.json("queryHistoricVariableInstances", {
      pathArgs: [],
      query: { ...RAW_VARIABLES_QUERY, maxResults: String(MAX_NAMED_VARIABLES) },
      body: { processInstanceIdIn: instances.map((instance) => instance.id) },
    })
    const names = JsonView.listOf(answer, "historic variable instances").map((record) =>
      record.requiredString("name"),
    )
    return [...new Set(names)].sort()
  }
}
