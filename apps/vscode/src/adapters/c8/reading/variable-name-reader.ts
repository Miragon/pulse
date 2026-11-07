import type { DefinitionId } from "../../../contract/index.js"
import { Keys } from "../mapping/keys.js"
import type { CamundaClient } from "../rest/index.js"

const NEWEST_INSTANCES = 50
const MOST_VARIABLES = 2000

export class VariableNameReader {
  constructor(private readonly client: CamundaClient) {}

  async read(definitionId: DefinitionId): Promise<string[]> {
    if (!Keys.isKey(definitionId)) {
      return []
    }
    const instances = await this.client.instances(
      { processDefinitionKey: definitionId },
      { limit: NEWEST_INSTANCES },
    )
    if (instances.items.length === 0) {
      return []
    }
    const variables = await this.client.variables(
      instances.items.map((instance) => instance.key),
      MOST_VARIABLES,
    )
    return [...new Set(variables.map((variable) => variable.name))].sort()
  }
}
