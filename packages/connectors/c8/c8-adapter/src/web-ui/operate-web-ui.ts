import type { DefinitionRef, InstanceSummary } from "@miragon/pulse-engine-core"
import type { EngineWebUi } from "@miragon/pulse-runtime-view/ports"

const WEB_APP_ROOT = /^(.*\/operate)\/?$/
const SAAS_OPERATE_HOST = /^[a-z0-9-]+\.operate\.camunda\.io$/
const SAAS_CLUSTER_ROOT = /^(\/[^/]+)\/?$/

export class OperateWebUi implements EngineWebUi {
  readonly name = "Operate"

  private constructor(private readonly base: string) {}

  static at(webUiUrl: string): OperateWebUi | undefined {
    if (!URL.canParse(webUiUrl)) {
      return undefined
    }
    const url = new URL(webUiUrl)
    const root = WEB_APP_ROOT.exec(url.pathname)?.[1] ?? OperateWebUi.saasRootOf(url)
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

  private static saasRootOf(url: URL): string | undefined {
    return SAAS_OPERATE_HOST.test(url.hostname)
      ? SAAS_CLUSTER_ROOT.exec(url.pathname)?.[1]
      : undefined
  }
}
