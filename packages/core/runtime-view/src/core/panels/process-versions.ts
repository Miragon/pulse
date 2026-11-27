import {
  ProcessTenants,
  type BpmnProcessId,
  type DefinitionId,
  type TenantId,
  type TenantReads,
  type TenantVersions,
  type VersionSummary,
} from "@miragon/pulse-engine-core"

export class ProcessVersions {
  static async of(
    runtime: TenantReads,
    bpmnProcessId: BpmnProcessId,
    tenantId: TenantId | null | undefined,
    definitionId?: DefinitionId,
  ): Promise<TenantVersions> {
    if (tenantId !== undefined) {
      return { tenantId, versions: await runtime.listVersions(bpmnProcessId, tenantId) }
    }
    return ProcessTenants.versionsOf(runtime, bpmnProcessId, definitionId)
  }

  static async inEveryTenant(
    runtime: TenantReads,
    bpmnProcessId: BpmnProcessId,
  ): Promise<readonly VersionSummary[]> {
    const summaries = await runtime.listDefinitions()
    const tenants = [null, ...ProcessTenants.tenantsOf(summaries, bpmnProcessId)]
    const versions = await Promise.all(
      tenants.map((tenant) => runtime.listVersions(bpmnProcessId, tenant)),
    )
    return versions.flat()
  }
}
