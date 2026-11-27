import type { WorldProcess } from "./world.js"

export const WORLD_TENANT = {
  north: "pulse-north",
  south: "pulse-south",
} as const

export type WorldTenant = keyof typeof WORLD_TENANT

export type TenantDeploymentAlias =
  "north/label@1" | "south/label@1" | "south/label@2" | "north/dispatch@1"

export interface WorldTenantDeployment {
  readonly alias: TenantDeploymentAlias
  readonly tenant: WorldTenant
  readonly process: WorldProcess
  readonly version: number
}

export const WORLD_TENANT_DEPLOYMENTS: readonly WorldTenantDeployment[] = [
  { alias: "north/label@1", tenant: "north", process: "label", version: 1 },
  { alias: "south/label@1", tenant: "south", process: "label", version: 1 },
  { alias: "south/label@2", tenant: "south", process: "label", version: 2 },
  { alias: "north/dispatch@1", tenant: "north", process: "dispatch", version: 1 },
]
