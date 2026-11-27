import { BpmnProcessId, TenantId } from "@miragon/pulse-engine-core"
import { FakeEngine, FakeWorld, WORLD_TENANT } from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import {
  EngineScreen,
  ProcessScreen,
  ScreenJson,
  type ProcessScreenRequest,
} from "../../src/builder/index.js"
import { FleetSums } from "../../src/format/fleet-sums.js"
import type { CallLinkData } from "../../src/format/instance-screen-data.js"

const AS_OF = new Date("2026-11-27T09:00:00.000Z")
const LABEL = BpmnProcessId("pulse-label")
const DISPATCH = BpmnProcessId("pulse-dispatch")
const NORTH = TenantId(WORLD_TENANT.north)
const SOUTH = TenantId(WORLD_TENANT.south)

function engineWithTenants() {
  const { state, world, tenantWorld } = FakeWorld.seedWithTenants()
  return { runtime: new FakeEngine(state), world, tenantWorld }
}

async function processScreen(request: ProcessScreenRequest) {
  const { runtime } = engineWithTenants()
  const model = await ProcessScreen.read("tenants", request, runtime, () => AS_OF)
  return model === undefined ? undefined : ScreenJson.process(model)
}

describe("the screens of an engine with tenants", () => {
  test("list a key once per tenant, each row naming its tenant, a row without one naming none", async () => {
    const { runtime } = engineWithTenants()
    const screen = ScreenJson.engine(await EngineScreen.read("tenants", runtime, () => AS_OF))

    const labels = screen.processes.filter((row) => row.bpmnProcessId === LABEL)

    expect(labels.map((row) => [row.tenantId, row.latestVersion])).toEqual([
      [undefined, 1],
      [NORTH, 1],
      [SOUTH, 2],
    ])
    expect(labels[0]).not.toHaveProperty("tenantId")
    expect(screen.totals.processes).toBe(6)
  })

  test("pick a process's version by key, tenant and number, never another tenant's", async () => {
    const south = await processScreen({ bpmnProcessId: LABEL, tenantId: SOUTH, version: 1 })
    const southLatest = await processScreen({ bpmnProcessId: LABEL, tenantId: SOUTH })
    const north = await processScreen({ bpmnProcessId: LABEL, tenantId: NORTH, version: 2 })
    const none = await processScreen({ bpmnProcessId: LABEL, tenantId: null })

    expect(south?.tenantId).toBe(SOUTH)
    expect(south?.selected).toMatchObject({ tenantId: SOUTH, version: 1 })
    expect(south?.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
    expect(southLatest?.selected).toMatchObject({ tenantId: SOUTH, version: 2 })
    expect(north?.selected).toMatchObject({ tenantId: NORTH, version: 1 })
    expect(north?.versions).toHaveLength(1)
    expect(none).not.toHaveProperty("tenantId")
    expect(none?.selected).not.toHaveProperty("tenantId")
    expect(none?.versions).toHaveLength(1)
  })

  test("give no screen for a key in a tenant that deploys none of it", async () => {
    expect(await processScreen({ bpmnProcessId: DISPATCH, tenantId: SOUTH })).toBeUndefined()
  })

  test("link a call to the called process of the caller's tenant", async () => {
    const north = await processScreen({ bpmnProcessId: DISPATCH, tenantId: NORTH })
    const none = await processScreen({ bpmnProcessId: DISPATCH, tenantId: null })

    const targetOf = (calls: readonly CallLinkData[] | undefined) =>
      calls?.map((call) =>
        call.kind === "definition" ? [call.definition.tenantId, call.definition.version] : [],
      )

    expect(targetOf(north?.calls)).toEqual([[NORTH, 1]])
    expect(targetOf(none?.calls)).toEqual([[undefined, 1]])
  })

  test("sum a key across engines per tenant, never a tenant's into another's", () => {
    const row = (tenantId?: string) => ({
      bpmnProcessId: "label",
      ...(tenantId === undefined ? {} : { tenantId }),
      latestVersion: 1,
      running: 2,
      withIncident: 1,
      incidents: 1,
    })
    const screen = (engine: string, processes: ReturnType<typeof row>[]) => ({
      engine,
      asOf: AS_OF.toISOString(),
      info: null,
      processes,
      totals: { processes: processes.length, running: 0, withIncident: 0 },
    })

    const sums = FleetSums.of([screen("a", [row(), row("north")]), screen("b", [row("north")])])

    expect(sums.processes.map((process) => [process.tenantId, process.running])).toEqual([
      ["north", 4],
      [undefined, 2],
    ])
  })
})
