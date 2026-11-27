import type {
  BpmnProcessId,
  DefinitionId,
  DefinitionSummary,
  ProcessRuntime,
  TenantId,
} from "@miragon/pulse-engine-core"
import { Labels } from "../views/labels.js"

export interface DefinitionNode {
  readonly bpmnProcessId: BpmnProcessId
  readonly tenantId: TenantId | null
  readonly latestDefinitionId: DefinitionId
  readonly label: string
  readonly description: string
  readonly withIncident: number
}

export class DefinitionNodes {
  constructor(private readonly runtime: Pick<ProcessRuntime, "listDefinitions">) {}

  async list(): Promise<DefinitionNode[]> {
    const summaries = await this.runtime.listDefinitions()
    return summaries
      .map((summary) => this.nodeOf(summary))
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          (left.tenantId ?? "").localeCompare(right.tenantId ?? ""),
      )
  }

  private nodeOf(summary: DefinitionSummary): DefinitionNode {
    return {
      bpmnProcessId: summary.latest.bpmnProcessId,
      tenantId: summary.latest.tenantId,
      latestDefinitionId: summary.latest.id,
      label: summary.latest.name ?? summary.latest.bpmnProcessId,
      description: this.describeCounts(summary),
      withIncident: summary.withIncident,
    }
  }

  private describeCounts(summary: DefinitionSummary): string {
    const running =
      summary.running === 0 ? "idle" : `${Labels.count(summary.running)} running in all versions`
    const tenant = summary.latest.tenantId
    const counts = `${running} · latest v${summary.latest.version}`
    return tenant === null ? counts : `${counts} · tenant ${tenant}`
  }
}
