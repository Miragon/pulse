/**
 * The seed of the conformance kit's tenant world (`WORLD_TENANT_DEPLOYMENTS` of
 * @miragon/pulse-engine-core/testing) into a C7 engine of the family: the same keys as the read
 * world, deployed in two tenants, each deployment with its tenant id (`tenant-id`), in the order the
 * plan lists them, so a key deployed twice in one tenant counts its versions there. No instance
 * runs in it, so the read world's counts stay as they are; `removeC7Deployments` deletes the
 * deployments again, with whatever ran on them (`cascade`).
 */

import type { C7SeedEngine } from "./c7-world.js"
import { deployed, undeploy } from "./seed-calls.js"

/** A deployment of the tenant world: its alias, the process whose diagram it deploys, its tenant. */
export interface C7TenantDeployment<Alias extends string = string> {
  readonly alias: Alias
  readonly process: string
  readonly tenantId: string
}

/** The tenant world: its deployments in order and the diagram text of each process by its name. */
export interface C7TenantWorldPlan<Alias extends string> {
  readonly deployments: readonly C7TenantDeployment<Alias>[]
  readonly diagrams: Readonly<Record<string, string>>
}

/** The seeded tenant world: each deployment's definition id by alias, and the deployments' ids. */
export interface C7SeededTenantWorld<Alias extends string> {
  readonly definitionIds: Readonly<Record<Alias, string>>
  readonly deploymentIds: readonly string[]
}

/** Deploys the tenant world's diagrams one by one, each into its tenant. */
export async function seedC7TenantWorld<Alias extends string>(
  engine: C7SeedEngine,
  plan: C7TenantWorldPlan<Alias>,
): Promise<C7SeededTenantWorld<Alias>> {
  const definitionIds: Partial<Record<Alias, string>> = {}
  const deploymentIds: string[] = []
  for (const deployment of plan.deployments) {
    const diagram = plan.diagrams[deployment.process]
    if (diagram === undefined) {
      throw new Error(`the tenant world has no diagram of ${deployment.process}`)
    }
    const { definitionId, deploymentId } = await deployed(engine, deployment, diagram)
    if (deploymentId === undefined) {
      throw new Error(`deploying ${deployment.alias} named no deployment`)
    }
    definitionIds[deployment.alias] = definitionId
    deploymentIds.push(deploymentId)
  }
  return { definitionIds: definitionIds as Record<Alias, string>, deploymentIds }
}

/** Deletes `deploymentIds` with everything that runs on them. */
export async function removeC7Deployments(
  engine: C7SeedEngine,
  deploymentIds: readonly string[],
): Promise<void> {
  for (const id of deploymentIds) {
    await undeploy(engine, id)
  }
}
