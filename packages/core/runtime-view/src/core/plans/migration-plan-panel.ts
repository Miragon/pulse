import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import type { PanelContext } from "../panels/panel-context.js"
import type { Panel } from "../panels/panel.js"
import { ViewSession } from "../panels/view-session.js"
import type { MigrationPlanView, WebviewIntent } from "../protocol/index.js"
import type { PlanContext, PlanSource } from "./plan-context.js"
import { PlanIntents } from "./plan-intents.js"
import { PlanReads, type PlanLoaded } from "./plan-reads.js"

export class MigrationPlanPanel implements Panel {
  private readonly session: ViewSession<MigrationPlanView, PlanLoaded>

  constructor(private readonly context: PlanContext) {
    this.session = new ViewSession(context, context.source.fileName)
  }

  static over(context: PanelContext, source: PlanSource): MigrationPlanPanel {
    const { effects } = context
    return new MigrationPlanPanel({
      source,
      runtime: context.runtime,
      diagrams: context.diagrams,
      engine: context.engine,
      publish: context.publish,
      now: context.now,
      navigation: {
        openDefinition: (bpmnProcessId, definitionId, options) => {
          effects.openDefinition(bpmnProcessId, definitionId, options)
        },
        openFile: () => {
          effects.openSource(source.location)
        },
        goBack: () => {
          effects.goBack()
        },
        copy: (text, label) => {
          effects.copyToClipboard(text, label)
        },
        editConnection: () => {
          effects.editConnection()
        },
        setCredentials: () => {
          effects.setCredentials()
        },
      },
    })
  }

  async handle(intent: WebviewIntent): Promise<void> {
    switch (intent.type) {
      case "ready":
        await this.session.resume(() => PlanReads.load(this.context))
        return
      case "refresh":
        await this.session.reload(() => PlanReads.load(this.context))
        return
      case "focusMapping":
        this.focus(intent.sourceElementId)
        return
      case "openDefinition":
        this.openDefinition(intent.bpmnProcessId, intent.definitionId)
        return
      case "openPlanFile":
        this.context.navigation.openFile()
        return
      default:
        PlanIntents.forward(this.context.navigation, intent)
    }
  }

  attend(): void {
    return undefined
  }

  nudge(): void {
    return undefined
  }

  dispose(): void {
    this.session.close()
  }

  private focus(sourceElementId: string): void {
    const shown = this.session.current()?.view.rows
    if (shown?.some((row) => row.sourceElementId === sourceElementId) === true) {
      this.session.rebuild((loaded) =>
        PlanReads.snapshot({ ...loaded, focused: sourceElementId }, this.context.engine),
      )
    }
  }

  private openDefinition(bpmnProcessId: string, definitionId: string): void {
    const view = this.session.current()?.view
    const shown = [view?.source.definitionId, view?.target.definitionId]
    if (view?.bpmnProcessId === bpmnProcessId && shown.includes(definitionId)) {
      this.context.navigation.openDefinition(
        BpmnProcessId(bpmnProcessId),
        DefinitionId(definitionId),
        { toSide: false },
      )
    }
  }
}
