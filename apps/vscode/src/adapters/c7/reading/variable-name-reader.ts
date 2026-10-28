import type { DefinitionId } from "../../../contract/index.js"
import type { EngineClient } from "../engine-rest/index.js"

const SAMPLED_INSTANCES = 50

export class VariableNameReader {
  constructor(private readonly client: EngineClient) {}

  async names(definitionId: DefinitionId): Promise<string[]> {
    const instances = await this.client.historicInstances(
      { processDefinitionId: definitionId },
      { firstResult: 0, maxResults: SAMPLED_INSTANCES },
    )
    if (instances.length === 0) {
      return []
    }
    const names = await this.client.historicVariableNames(instances.map((instance) => instance.id))
    return [...new Set(names)].sort()
  }
}
