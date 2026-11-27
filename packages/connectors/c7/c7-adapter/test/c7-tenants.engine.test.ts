import { BpmnProcessId, TenantId } from "@miragon/pulse-engine-core"
import {
  ConformanceKit,
  WORLD_PROCESS,
  WORLD_TENANT,
  type TenantHarness,
} from "@miragon/pulse-engine-core/testing"
import type { CallLinkData } from "@miragon/pulse-screens"
import { EngineScreen, ProcessScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"
import {
  ENGINE_IMAGE,
  RUNS_ON_CAMUNDA_7,
  startEngine,
  type RunningEngine,
} from "./support/engine-container.js"
import { seedTenantWorld, seedWorld } from "./support/world.js"

const LABEL = BpmnProcessId(WORLD_PROCESS.label)
const DISPATCH = BpmnProcessId(WORLD_PROCESS.dispatch)
const NORTH = TenantId(WORLD_TENANT.north)
const SOUTH = TenantId(WORLD_TENANT.south)
const UNREACHABLE_URL = "http://127.0.0.1:9/engine-rest"

function connectionTo(endpoint: string) {
  return { endpoint, credentials: { kind: "none" } } as const
}

describe.skipIf(!RUNS_ON_CAMUNDA_7)(`a C7 engine with tenants, ${ENGINE_IMAGE}`, () => {
  const adapter = new C7Adapter()
  let engine: RunningEngine | undefined
  let harness: TenantHarness | undefined

  beforeAll(async () => {
    engine = await startEngine()
    const world = await seedWorld(engine.url)
    harness = {
      runtime: adapter.runtime(connectionTo(engine.url)),
      world,
      tenantWorld: await seedTenantWorld(engine.url),
    }
  })

  afterAll(async () => {
    await engine?.stop()
  })

  const prepared = (): TenantHarness => {
    if (harness === undefined) throw new Error("the engine did not start")
    return harness
  }

  new ConformanceKit(test).registerTenantLaws(() => Promise.resolve(prepared()))

  new ConformanceKit(test).registerRuntimeLaws(
    () => {
      const { runtime, world } = prepared()
      return Promise.resolve({
        runtime,
        unreachableRuntime: adapter.runtime(connectionTo(UNREACHABLE_URL)),
        world,
      })
    },
    ConformanceKit.runtimeLaws().filter(({ name }) =>
      /^(?:definitions|versions|calls):/.test(name),
    ),
  )

  test("screens: the engine screen lists a key once per tenant, the process screen each tenant's versions apart", async () => {
    const { runtime } = prepared()
    const asOf = () => new Date()
    const engineScreen = ScreenJson.engine(await EngineScreen.read("tenants", runtime, asOf))
    const labels = engineScreen.processes.filter((row) => row.bpmnProcessId === LABEL)
    const south = await ProcessScreen.read(
      "tenants",
      { bpmnProcessId: LABEL, tenantId: SOUTH, version: 1 },
      runtime,
      asOf,
    )

    expect(labels.map(({ tenantId, latestVersion }) => [tenantId, latestVersion])).toEqual([
      [undefined, 1],
      [NORTH, 1],
      [SOUTH, 2],
    ])
    const screen = south === undefined ? undefined : ScreenJson.process(south)
    expect(screen?.tenantId).toBe(SOUTH)
    expect(screen?.selected).toMatchObject({ tenantId: SOUTH, version: 1 })
    expect(screen?.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
  })

  test("screens: a call activity links the called process of its caller's tenant", async () => {
    const { runtime, tenantWorld, world } = prepared()
    const targetsOf = async (tenantId: TenantId | null) => {
      const model = await ProcessScreen.read(
        "tenants",
        { bpmnProcessId: DISPATCH, tenantId },
        runtime,
        () => new Date(),
      )
      const calls: readonly CallLinkData[] =
        model === undefined ? [] : ScreenJson.process(model).calls
      return calls.map((call) => (call.kind === "definition" ? call.definition.id : call.kind))
    }

    expect(await targetsOf(NORTH)).toEqual([tenantWorld.definitionIds["north/label@1"]])
    expect(await targetsOf(null)).toEqual([world.definitionIds["label@1"]])
  })
})
