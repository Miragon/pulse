import { DefinitionId } from "../../contract/index.js"
import type { DefinitionView } from "../protocol/index.js"
import type { PanelContext } from "./panel-context.js"

export class VariableNameHints {
  private readonly known = new Map<DefinitionId, readonly string[]>()

  constructor(
    private readonly context: PanelContext,
    private readonly republish: () => void,
  ) {}

  async suggest(definitionId: DefinitionId | undefined): Promise<void> {
    if (definitionId === undefined || this.known.has(definitionId)) {
      return
    }
    const names = await this.context.runtime.listVariableNames(definitionId).catch(() => [])
    this.known.set(definitionId, names)
    this.republish()
  }

  decorate(view: DefinitionView): DefinitionView {
    const names = this.known.get(DefinitionId(view.selectedDefinitionId))
    return names === undefined || names.length === 0 ? view : { ...view, variableNames: names }
  }
}
