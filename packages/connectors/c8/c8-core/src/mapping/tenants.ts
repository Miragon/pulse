import { TenantId } from "@miragon/pulse-engine-core"

const DEFAULT_TENANT = "<default>"

export class Tenants {
  static of(tenantId: string | undefined): TenantId | null {
    return tenantId === undefined || tenantId === "" || tenantId === DEFAULT_TENANT
      ? null
      : TenantId(tenantId)
  }

  static clusterIdOf(tenantId: TenantId | null): string {
    return tenantId ?? DEFAULT_TENANT
  }

  static same(clusterTenantId: string | undefined, tenantId: TenantId | null): boolean {
    return Tenants.of(clusterTenantId) === tenantId
  }
}
