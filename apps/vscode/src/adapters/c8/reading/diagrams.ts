import type { DefinitionId } from "../../../contract/index.js"
import { Keys } from "../mapping/keys.js"
import type { CamundaClient } from "../rest/index.js"

export class Diagrams {
  private readonly known = new Map<string, string>()

  constructor(private readonly client: CamundaClient) {}

  async xml(definitionId: DefinitionId | string): Promise<string | undefined> {
    if (!Keys.isKey(definitionId)) {
      return undefined
    }
    const known = this.known.get(definitionId)
    if (known !== undefined) {
      return known
    }
    const xml = await this.client.diagramXml(definitionId)
    if (xml !== undefined) {
      this.known.set(definitionId, xml)
    }
    return xml
  }
}
