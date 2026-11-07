import type { DefinitionRef } from "../../../contract/index.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import type { CamundaClient } from "../rest/index.js"

export class DefinitionRefsCache {
  private readonly known = new Map<string, Promise<DefinitionRef | undefined>>()

  constructor(private readonly client: CamundaClient) {}

  of(definitionKey: string): Promise<DefinitionRef | undefined> {
    const known = this.known.get(definitionKey)
    if (known !== undefined) {
      return known
    }
    const read = this.read(definitionKey)
    this.known.set(definitionKey, read)
    return read
  }

  private async read(definitionKey: string): Promise<DefinitionRef | undefined> {
    try {
      const definition = await this.client.definition(definitionKey)
      if (definition === undefined) {
        this.known.delete(definitionKey)
        return undefined
      }
      return DefinitionRefs.of(definition)
    } catch (error) {
      this.known.delete(definitionKey)
      throw error
    }
  }
}
