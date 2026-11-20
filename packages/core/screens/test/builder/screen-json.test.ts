import type { DefinitionSummary, EngineInfo } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  EngineScreen,
  ScreenJson,
  type EngineScreenModel,
  type EngineScreenTotals,
} from "../../src/builder/index.js"
import { ScreenWorld } from "./support/world.js"

describe("the JSON form of an engine screen", () => {
  test("holds the engine, the time of the reads as text, its product and version and each row", () => {
    const model = EngineScreen.of({
      engine: "prod-a",
      asOf: ScreenWorld.AS_OF,
      definitions: [
        ScreenWorld.summary("pulse-order", { running: 3, withIncident: 1 }, "Order fulfillment"),
        ScreenWorld.summary("shipment", { running: 1204, withIncident: 0 }),
      ],
      info: { product: "CIB seven", version: "2.0.1" },
    })

    expect(ScreenJson.engine(model)).toStrictEqual({
      engine: "prod-a",
      asOf: "2026-11-19T09:00:00.000Z",
      info: { product: "CIB seven", version: "2.0.1" },
      processes: [
        {
          bpmnProcessId: "pulse-order",
          name: "Order fulfillment",
          latestVersion: 4,
          running: 3,
          withIncident: 1,
        },
        { bpmnProcessId: "shipment", latestVersion: 4, running: 1204, withIncident: 0 },
      ],
      totals: { processes: 2, running: 1207, withIncident: 1 },
    })
  })

  test("keeps of a read model only the fields the form names", () => {
    const summary = ScreenWorld.summary("audit", { running: 1, withIncident: 0 })
    const model: EngineScreenModel = {
      engine: "prod-a",
      asOf: ScreenWorld.AS_OF,
      info: { product: "Engine", version: "1", build: "a1b2" } as EngineInfo,
      processes: [
        {
          ...summary,
          latest: { ...summary.latest, deployedAt: "2026-11-01" },
        } as DefinitionSummary,
      ],
      totals: { processes: 1, running: 1, withIncident: 0, extra: 3 } as EngineScreenTotals,
    }

    const data = ScreenJson.engine(model)

    expect(data.info).toStrictEqual({ product: "Engine", version: "1" })
    expect(data.processes).toStrictEqual([
      { bpmnProcessId: "audit", latestVersion: 4, running: 1, withIncident: 0 },
    ])
    expect(data.totals).toStrictEqual({ processes: 1, running: 1, withIncident: 0 })
  })

  test("travels as JSON: written and read back it is the same screen", async () => {
    const model = await EngineScreen.read(
      "conformance",
      ScreenWorld.world(),
      () => ScreenWorld.AS_OF,
    )
    const data = ScreenJson.engine(model)

    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
  })
})
