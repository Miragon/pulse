import type { DefinitionId } from "../../model/ids.js"
import type { ProcessRuntime } from "../../ports/process-runtime.js"
import type { SeededWorld } from "./harness.js"
import type { TenantDeploymentAlias } from "./world/tenant-world.js"

export interface SeededTenantWorld {
  readonly definitionIds: Readonly<Record<TenantDeploymentAlias, DefinitionId>>
}

export interface TenantHarness {
  readonly runtime: ProcessRuntime
  readonly world: SeededWorld
  readonly tenantWorld: SeededTenantWorld
}

export type PrepareTenantHarness = () => Promise<TenantHarness>

export interface TenantConformanceCase {
  readonly name: string
  run(harness: TenantHarness): Promise<void>
}

export const TENANT_CASE = {
  tenantsApart:
    "tenants: a key deployed in two tenants is a process in each with its own latest version, apart from the one without a tenant",
  tenantVersions:
    "tenants: a process's versions are its tenant's alone, newest first, and a version without a tenant names none",
  tenantCalls:
    "tenants: a call activity starts the called process of its caller's tenant, never another tenant's newer version",
} as const

export type TenantCaseName = (typeof TENANT_CASE)[keyof typeof TENANT_CASE]
