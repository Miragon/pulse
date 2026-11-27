import { BpmnProcessId, TenantId, type ProcessRuntime } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld, WORLD_TENANT } from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import { ProcessVersions } from "../../src/core/panels/process-versions.js"

const LABEL = BpmnProcessId("pulse-label")
const NORTH = TenantId(WORLD_TENANT.north)
const SOUTH = TenantId(WORLD_TENANT.south)

function counted(runtime: ProcessRuntime) {
  const calls: string[] = []
  return {
    calls,
    reads: {
      listDefinitions: () => {
        calls.push("listDefinitions")
        return runtime.listDefinitions()
      },
      listVersions: (id: BpmnProcessId, tenantId: TenantId | null) => {
        calls.push(`listVersions ${tenantId ?? "none"}`)
        return runtime.listVersions(id, tenantId)
      },
    },
  }
}

function withTenants() {
  const { state, world, tenantWorld } = FakeWorld.seedWithTenants()
  return { ...counted(new FakeEngine(state)), world, tenantWorld }
}

const ids = (versions: readonly { readonly definition: { readonly id: string } }[]) =>
  versions.map(({ definition }) => definition.id)

describe("a process's versions in the editors", () => {
  test("are its tenant's alone where the panel names one, in one read", async () => {
    const { reads, calls, tenantWorld } = withTenants()

    const read = await ProcessVersions.of(reads, LABEL, SOUTH)

    expect(read.tenantId).toBe(SOUTH)
    expect(ids(read.versions)).toEqual([
      tenantWorld.definitionIds["south/label@2"],
      tenantWorld.definitionIds["south/label@1"],
    ])
    expect(calls).toEqual(["listVersions pulse-south"])
  })

  test("are the process's without a tenant where the panel names none, as without tenants", async () => {
    const { reads, calls, world } = withTenants()

    const read = await ProcessVersions.of(reads, LABEL, undefined)

    expect(read.tenantId).toBeNull()
    expect(ids(read.versions)).toEqual([world.definitionIds["label@1"]])
    expect(calls).toEqual(["listVersions none"])
  })

  test("are the tenant's that deploys the version the panel opens", async () => {
    const { reads, calls, tenantWorld } = withTenants()
    const wanted = tenantWorld.definitionIds["north/label@1"]

    const read = await ProcessVersions.of(reads, LABEL, undefined, wanted)

    expect(read.tenantId).toBe(NORTH)
    expect(ids(read.versions)).toEqual([wanted])
    expect(calls).toEqual(["listVersions none", "listDefinitions", "listVersions pulse-north"])
  })

  test("are every tenant's for a migration plan, which names no tenant", async () => {
    const { reads } = withTenants()

    const versions = await ProcessVersions.inEveryTenant(reads, LABEL)

    expect(versions.map(({ definition }) => [definition.tenantId, definition.version])).toEqual([
      [null, 1],
      [NORTH, 1],
      [SOUTH, 2],
      [SOUTH, 1],
    ])
  })
})
