import type { DefinitionRef, EngineWebUi, InstanceSummary } from "../../../contract/index.js"

const WEB_APP_ROOT = /^(.*\/operate)\/?$/

export class OperateWebUi implements EngineWebUi {
  readonly name = "Operate"

  private constructor(private readonly base: string) {}

  static at(webUiUrl: string): OperateWebUi | undefined {
    if (!URL.canParse(webUiUrl)) {
      return undefined
    }
    const url = new URL(webUiUrl)
    const root = WEB_APP_ROOT.exec(url.pathname)?.[1]
    return root === undefined ? undefined : new OperateWebUi(`${url.origin}${root}`)
  }

  overviewUrl(): string {
    return this.base
  }

  instanceUrl(instance: InstanceSummary): string {
    return `${this.base}/processes/${encodeURIComponent(instance.id)}`
  }

  definitionUrl(definition: DefinitionRef): string {
    const query = new URLSearchParams({
      processDefinitionId: definition.bpmnProcessId,
      processDefinitionVersion: String(definition.version),
      active: "true",
      incidents: "true",
    })
    return `${this.base}/processes?${query.toString()}`
  }
}
