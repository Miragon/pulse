/**
 * A case of the engine contract that c7-runtime.engine.test.ts runs on its seeded engine (F17), on
 * what it deploys itself and removes again, so the world, its other cases and the recorded board
 * stay as they are: the kit's tenant world beside the read world (pulse-label in tenant pulse-north
 * once and in pulse-south twice, pulse-dispatch in pulse-north). The kit's tenant laws hold over the
 * MCP server's SDK wire, and the web app's process screen feed, whose form `engine_get_screen`
 * hands on, reads a key's versions in its tenant alone, a version by its number among them, and
 * links a call to the called process of its caller's tenant. A key deployed in tenants alone (the
 * label's diagram under a key of its own, in pulse-south, then in pulse-north) opens by its key
 * alone, in the first of its tenants by id (engine-core's `ProcessTenants`), which the screen names.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  C7_BOARD_ENGINE,
  removeC7Deployments,
  seedC7TenantWorld,
  type C7SeedEngine,
} from "@miragon/pulse-c7-core/testing"
import { DefinitionId, type DefinitionId as Id } from "@miragon/pulse-engine-core"
import {
  ConformanceKit,
  WORLD_PROCESS,
  WORLD_TENANT,
  WORLD_TENANT_DEPLOYMENTS,
  type TenantDeploymentAlias,
} from "@miragon/pulse-engine-core/testing"
import { expect } from "vitest"
import { buildProcessScreenData } from "../../data/screens/process-screen-data.js"
import type { ContractSuite } from "./contract-cases.test-support.js"

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** A world diagram, read from c7-core's world/ in the repository. */
function worldDiagram(process: string): string {
  const file = new URL(`../../../../../c7/c7-core/world/${process}.bpmn`, import.meta.url)
  return readFileSync(fileURLToPath(file), "utf8")
}

/** The key deployed in tenants alone: the label's diagram under a key of its own. */
const TENANTS_ONLY = "pulse-tenants-only"

/** Deploys the key of `TENANTS_ONLY` in pulse-south, then in pulse-north; answers the deployments. */
async function deployTenantsOnly(engine: C7SeedEngine): Promise<readonly string[]> {
  const diagram = worldDiagram("label").replaceAll(WORLD_PROCESS.label, TENANTS_ONLY)
  const tenants = [WORLD_TENANT.south, WORLD_TENANT.north]
  const deployments = tenants.map((tenantId) => ({
    alias: `${tenantId}/${TENANTS_ONLY}`,
    process: TENANTS_ONLY,
    tenantId,
  }))
  const seeded = await seedC7TenantWorld(engine, {
    deployments,
    diagrams: { [TENANTS_ONLY]: diagram },
  })
  return seeded.deploymentIds
}

/** The process screen feed of a key deployed in tenants alone, by its key alone: its first tenant's. */
async function opensByItsKeyAlone(suite: ContractSuite, engine: C7SeedEngine): Promise<void> {
  const deploymentIds = await deployTenantsOnly(engine)
  try {
    const resolved = suite.resolve(C7_BOARD_ENGINE.engine)
    const screen = await buildProcessScreenData(resolved, { process: TENANTS_ONLY })
    expect(screen.tenantId).toBe(WORLD_TENANT.north)
    expect(screen.selected).toMatchObject({ tenantId: WORLD_TENANT.north, version: 1 })
    expect(screen.versions).toHaveLength(1)
  } finally {
    await removeC7Deployments(engine, deploymentIds)
  }
}

/** Deploys the tenant world, its ids branded, and the ids of its deployments to remove. */
async function deployTenantWorld(engine: C7SeedEngine) {
  const deployments = WORLD_TENANT_DEPLOYMENTS.map(({ alias, process, tenant }) => ({
    alias,
    process,
    tenantId: WORLD_TENANT[tenant],
  }))
  const diagrams = Object.fromEntries(
    deployments.map(({ process }) => [process, worldDiagram(process)]),
  )
  const seeded = await seedC7TenantWorld(engine, { deployments, diagrams })
  const definitionIds = Object.fromEntries(
    Object.entries<string>(seeded.definitionIds).map(([alias, id]) => [alias, DefinitionId(id)]),
  ) as Record<TenantDeploymentAlias, Id>
  return { definitionIds, deploymentIds: seeded.deploymentIds }
}

/** The tenant laws over the server's wire, then the process screen feed in each tenant. */
async function tenantsApartOnEverySurface(suite: ContractSuite): Promise<void> {
  const engine: C7SeedEngine = {
    url: suite.url,
    send: (target, request) => fetch(target, request),
    wait,
  }
  const tenants = await deployTenantWorld(engine)
  try {
    const harness = { runtime: suite.runtime, world: suite.world, tenantWorld: tenants }
    for (const law of ConformanceKit.tenantLaws()) await law.run(harness)
    const resolved = suite.resolve(C7_BOARD_ENGINE.engine)
    const south = await buildProcessScreenData(resolved, {
      process: WORLD_PROCESS.label,
      tenantId: WORLD_TENANT.south,
      version: 1,
    })
    expect(south.tenantId).toBe(WORLD_TENANT.south)
    expect(south.selected).toMatchObject({ tenantId: WORLD_TENANT.south, version: 1 })
    expect(south.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
    const north = await buildProcessScreenData(resolved, {
      process: WORLD_PROCESS.dispatch,
      tenantId: WORLD_TENANT.north,
    })
    expect(north.calls).toEqual([
      expect.objectContaining({
        kind: "definition",
        definition: expect.objectContaining({
          id: tenants.definitionIds["north/label@1"],
          tenantId: WORLD_TENANT.north,
        }) as unknown,
      }),
    ])
  } finally {
    await removeC7Deployments(engine, tenants.deploymentIds)
  }
  await opensByItsKeyAlone(suite, engine)
}

export const TENANT_CASES: ReadonlyArray<
  readonly [string, (suite: ContractSuite) => Promise<void>]
> = [
  [
    "tenants: a key in two tenants is a process in each over the server's wire and its process screen feed, a call resolved in its caller's tenant, a key in tenants alone opened by its key",
    tenantsApartOnEverySurface,
  ],
]
