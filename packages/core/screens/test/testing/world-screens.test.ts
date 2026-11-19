import { describe, expect, test } from "vitest"
import { EngineScreen, ScreenJson } from "../../src/builder/index.js"
import { ScreenFigures, WORLD_SCREENS } from "../../src/testing/index.js"
import { ScreenWorld } from "../builder/support/world.js"

describe("the screens of the conformance kit's fixed world", () => {
  test("are what the builder gives over the kit's fake engine, read at their time", async () => {
    const { engine, asOf } = WORLD_SCREENS.engine

    const model = await EngineScreen.read(engine, ScreenWorld.world(), () => new Date(asOf))

    expect(ScreenJson.engine(model)).toStrictEqual(WORLD_SCREENS.engine)
    expect(WORLD_SCREENS.about).toMatch(/^\S.+\.$/)
  })
})

describe("the figures of an engine screen", () => {
  test("keep each row's id, latest version and counts in their order, and the totals", () => {
    expect(ScreenFigures.engine(WORLD_SCREENS.engine)).toStrictEqual({
      processes: [
        ["pulse-order", 2, 3, 1],
        ["pulse-dispatch", 1, 1, 1],
        ["pulse-label", 1, 1, 1],
      ],
      totals: { processes: 3, running: 5, withIncident: 3 },
    })
  })

  test("leave out what an engine makes on its own: its id, the time, its product and the names", () => {
    const elsewhere = {
      ...WORLD_SCREENS.engine,
      engine: "c8-conformance",
      asOf: "2026-11-20T10:00:00.000Z",
      info: { product: "Another engine", version: "8.10.9" },
      processes: WORLD_SCREENS.engine.processes.map(
        ({ bpmnProcessId, latestVersion, running, withIncident }) => ({
          bpmnProcessId,
          latestVersion,
          running,
          withIncident,
        }),
      ),
    }

    expect(ScreenFigures.engine(elsewhere)).toStrictEqual(
      ScreenFigures.engine(WORLD_SCREENS.engine),
    )
  })
})
