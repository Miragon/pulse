import type { PanelContext } from "../panels/panel-context.js"
import type { Panel } from "../panels/panel.js"
import type { PlanContext, PlanSource } from "./plan-context.js"

export class MigrationPlanPanel implements Panel {
  constructor(readonly context: PlanContext) {}

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

  handle(): Promise<void> {
    return Promise.resolve()
  }

  attend(): void {
    return undefined
  }

  nudge(): void {
    return undefined
  }

  dispose(): void {
    return undefined
  }
}
