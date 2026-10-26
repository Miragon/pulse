import type { DefinitionId, ProcessRuntime } from "../../contract/index.js"
import { RuntimeError } from "../../contract/index.js"

export class DiagramCache {
  private readonly diagrams = new Map<DefinitionId, Promise<string>>()

  constructor(private readonly runtime: ProcessRuntime) {}

  get(definitionId: DefinitionId): Promise<string> {
    const cached = this.diagrams.get(definitionId)
    if (cached !== undefined) {
      return cached
    }
    const loading = this.load(definitionId)
    this.diagrams.set(definitionId, loading)
    loading.catch(() => this.diagrams.delete(definitionId))
    return loading
  }

  private async load(definitionId: DefinitionId): Promise<string> {
    const xml = await this.runtime.getDiagramXml(definitionId)
    if (xml === undefined) {
      throw new RuntimeError(
        "unexpectedResponse",
        `The engine has no diagram for the definition ${definitionId}.`,
      )
    }
    return xml
  }
}
