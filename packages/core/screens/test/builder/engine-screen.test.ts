import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { EngineScreen, ScreenJson } from "../../src/builder/index.js"
import { ScreenWorld } from "./support/world.js"

const MIXED = [
  ScreenWorld.summary("zeta", { running: 5, withIncident: 0 }, "Zeta"),
  ScreenWorld.summary("alpha", { running: 1, withIncident: 0 }, "Alpha"),
  ScreenWorld.summary("beta", { running: 0, withIncident: 2 }, "Beta"),
  ScreenWorld.summary("audit", { running: 1, withIncident: 0 }),
  ScreenWorld.summary("gamma", { running: 9, withIncident: 2 }, "Gamma"),
]

describe("the engine screen", () => {
  test("puts processes with incidents first, then the busiest, then by name", () => {
    const model = EngineScreen.of({
      engine: "prod-a",
      asOf: ScreenWorld.AS_OF,
      definitions: MIXED,
      info: undefined,
    })

    expect(model.processes.map(({ latest }) => latest.bpmnProcessId)).toEqual([
      "gamma",
      "beta",
      "zeta",
      "alpha",
      "audit",
    ])
  })

  test("sums the processes, the running instances and those with incident over every process", () => {
    const model = EngineScreen.of({
      engine: "prod-a",
      asOf: ScreenWorld.AS_OF,
      definitions: MIXED,
      info: { product: "Engine", version: "1" },
    })

    expect(model.totals).toEqual({ processes: 5, running: 16, withIncident: 4 })
    expect(model.engine).toBe("prod-a")
    expect(model.asOf).toBe(ScreenWorld.AS_OF)
    expect(model.info).toEqual({ product: "Engine", version: "1" })
  })

  test("leaves the order of the definitions it was handed as they were", () => {
    const definitions = [...MIXED]

    EngineScreen.of({ engine: "prod-a", asOf: ScreenWorld.AS_OF, definitions, info: undefined })

    expect(definitions).toEqual(MIXED)
  })

  test("shows an engine without processes with nothing to sum", () => {
    const model = EngineScreen.of({
      engine: "empty",
      asOf: ScreenWorld.AS_OF,
      definitions: [],
      info: undefined,
    })

    expect(model).toEqual({
      engine: "empty",
      asOf: ScreenWorld.AS_OF,
      processes: [],
      totals: { processes: 0, running: 0, withIncident: 0 },
    })
  })

  test("reads the engine with one list and one description, at the time the clock gives first", async () => {
    const { reads, calls } = ScreenWorld.counted(ScreenWorld.world())
    const times: string[] = []

    const model = await EngineScreen.read("conformance", reads, () => {
      times.push(`now after ${String(calls.length)} reads`)
      return ScreenWorld.AS_OF
    })

    expect([...calls].sort()).toEqual(["describeEngine", "listDefinitions"])
    expect(times).toEqual(["now after 0 reads"])
    expect(model.asOf).toBe(ScreenWorld.AS_OF)
    expect(model.info).toEqual({ product: "Fake engine", version: "1.0.0" })
  })

  test("keeps the processes when the engine does not describe itself, without its product", async () => {
    const failing = ScreenWorld.world({
      describeEngine: () => Promise.reject(new RuntimeError("unreachable", "no answer")),
    })

    const model = await EngineScreen.read("conformance", failing, () => ScreenWorld.AS_OF)

    expect(model).not.toHaveProperty("info")
    expect(model.totals).toEqual({ processes: 3, running: 5, withIncident: 3 })
    expect(ScreenJson.engine(model).info).toBeNull()
  })

  test("fails as the list of processes fails: the rows are the screen", async () => {
    const refused = new RuntimeError("forbidden", "no rights")
    const failing = ScreenWorld.world({ listDefinitions: () => Promise.reject(refused) })

    await expect(EngineScreen.read("conformance", failing, () => ScreenWorld.AS_OF)).rejects.toBe(
      refused,
    )
  })
})
