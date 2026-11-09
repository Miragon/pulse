import { ElementId } from "../../contract/index.js"
import type { WebviewIntent } from "../protocol/index.js"
import { CallTargets } from "../views/call-targets.js"
import type { CallJumps } from "./call-jumps.js"
import type { DefinitionLoaded } from "./definition-reads.js"
import type { ModelLinks } from "./model-links.js"
import type { PanelContext } from "./panel-context.js"

type LinkIntent = Extract<
  WebviewIntent,
  { readonly type: "openCall" | "openWebUi" | "openModel" | "openCode" }
>

const LINK_INTENTS: ReadonlySet<WebviewIntent["type"]> = new Set([
  "openCall",
  "openWebUi",
  "openModel",
  "openCode",
])

export interface LinkParts {
  readonly jumps: CallJumps
  readonly links: ModelLinks
  readonly current: () => DefinitionLoaded | undefined
}

export class DefinitionLinks {
  constructor(
    private readonly context: PanelContext,
    private readonly parts: LinkParts,
  ) {}

  static handles(intent: WebviewIntent): intent is LinkIntent {
    return LINK_INTENTS.has(intent.type)
  }

  async handle(intent: LinkIntent): Promise<void> {
    switch (intent.type) {
      case "openCall":
        return this.openCall(intent.elementId, intent.toSide)
      case "openWebUi":
        this.openWebUi()
        return
      case "openModel":
        return this.openModel(intent.elementId)
      case "openCode":
        this.openCode(intent.elementId)
        return
    }
  }

  private async openCall(elementId: string, toSide: boolean): Promise<void> {
    const loaded = this.parts.current()
    if (loaded !== undefined) {
      const target = new CallTargets(loaded.calledProcesses).of(elementId)
      await this.parts.jumps.open({ target, elementId, diagramXml: loaded.diagramXml }, { toSide })
    }
  }

  private async openModel(elementId: string | undefined): Promise<void> {
    const model = this.parts.current()?.model
    if (model !== undefined) {
      await this.parts.links.openModel(
        model,
        elementId === undefined ? undefined : ElementId(elementId),
      )
    }
  }

  private openCode(elementId: string | undefined): void {
    const link = this.parts.current()?.link
    if (link === undefined) {
      return
    }
    if (link.elementId === elementId) {
      this.parts.links.openCode(link)
    }
  }

  private openWebUi(): void {
    const loaded = this.parts.current()
    const shown = loaded?.versions.find((version) => version.definition.id === loaded.selected)
    if (shown !== undefined && this.context.engine.webUi !== undefined) {
      this.context.effects.openWebUi({ kind: "definition", definition: shown.definition })
    }
  }
}
