import type { ProcessRuntime } from "../ports/process-runtime.js"
import type { BpmnProcessId, DefinitionId, TenantId } from "./ids.js"
import type { DefinitionSummary, VersionSummary } from "./read-models.js"

export interface TenantVersions {
  readonly tenantId: TenantId | null
  readonly versions: readonly VersionSummary[]
}

export type TenantReads = Pick<ProcessRuntime, "listVersions" | "listDefinitions">

export class ProcessTenants {
  static summaryOf(
    summaries: readonly DefinitionSummary[],
    bpmnProcessId: BpmnProcessId,
  ): DefinitionSummary | undefined {
    const deployed = summaries.filter(({ latest }) => latest.bpmnProcessId === bpmnProcessId)
    const tenantId = ProcessTenants.tenantOf(deployed.map(({ latest }) => latest.tenantId))
    return deployed.find(({ latest }) => latest.tenantId === tenantId)
  }

  static tenantOf(tenants: Iterable<TenantId | null>): TenantId | null | undefined {
    const listed = [...tenants]
    if (listed.includes(null)) {
      return null
    }
    const [first] = ProcessTenants.ordered(listed.filter((tenant) => tenant !== null))
    return first
  }

  static async versionsOf(
    reads: TenantReads,
    bpmnProcessId: BpmnProcessId,
    definitionId?: DefinitionId,
  ): Promise<TenantVersions> {
    const without = { tenantId: null, versions: await reads.listVersions(bpmnProcessId, null) }
    if (ProcessTenants.holds(without, definitionId)) {
      return without
    }
    let first: TenantVersions | undefined
    for (const tenantId of ProcessTenants.tenantsOf(await reads.listDefinitions(), bpmnProcessId)) {
      const found = { tenantId, versions: await reads.listVersions(bpmnProcessId, tenantId) }
      if (ProcessTenants.holds(found, definitionId)) {
        return found
      }
      first ??= found.versions.length > 0 ? found : undefined
    }
    return without.versions.length > 0 ? without : (first ?? without)
  }

  static tenantsOf(
    summaries: readonly DefinitionSummary[],
    bpmnProcessId: BpmnProcessId,
  ): TenantId[] {
    const tenants = summaries.flatMap(({ latest }) =>
      latest.bpmnProcessId === bpmnProcessId && latest.tenantId !== null ? [latest.tenantId] : [],
    )
    return ProcessTenants.ordered(tenants)
  }

  private static ordered(tenants: readonly TenantId[]): TenantId[] {
    return [...new Set(tenants)].toSorted((left, right) => ProcessTenants.byCodeUnits(left, right))
  }

  private static holds(found: TenantVersions, definitionId: DefinitionId | undefined): boolean {
    return definitionId === undefined
      ? found.versions.length > 0
      : found.versions.some(({ definition }) => definition.id === definitionId)
  }

  private static byCodeUnits(left: string, right: string): number {
    return left < right ? -1 : 1
  }
}
