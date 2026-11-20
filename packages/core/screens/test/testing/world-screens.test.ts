import { InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { EngineScreen, InstanceScreen, ScreenJson } from "../../src/builder/index.js"
import type { InstanceScreenData } from "../../src/index.js"
import { ScreenFigures, WORLD_SCREENS } from "../../src/testing/index.js"
import { ScreenWorld } from "../builder/support/world.js"

describe("the screens of the conformance kit's fixed world", () => {
  test("are what the builder gives over the kit's fake engine, read at their time", async () => {
    const { engine, asOf } = WORLD_SCREENS.engine

    const model = await EngineScreen.read(engine, ScreenWorld.world(), () => new Date(asOf))

    expect(ScreenJson.engine(model)).toStrictEqual(WORLD_SCREENS.engine)
    expect(WORLD_SCREENS.about).toMatch(/^\S.+\.$/)
  })

  test.each(["instance", "calledInstance"] as const)(
    "hold the %s screen the builder gives over the kit's fake engine",
    async (name) => {
      const expected = WORLD_SCREENS[name]

      const model = await InstanceScreen.read(
        expected.engine,
        InstanceId(expected.instance.id),
        ScreenWorld.world(),
        () => new Date(expected.asOf),
      )

      expect(model === undefined ? undefined : ScreenJson.instance(model)).toStrictEqual(expected)
    },
  )
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

describe("the figures of an instance screen", () => {
  test("keep what every dialect counts alike, in an order of their own", () => {
    expect(ScreenFigures.instance(WORLD_SCREENS.instance)).toStrictEqual({
      state: "running",
      hasIncident: true,
      caller: null,
      headline: "incidentInCalledInstance",
      markers: [
        ["Activity_PrintShippingLabel", "incidentInCalledInstance"],
        ["Event_DispatchRequested", "completed"],
      ],
      calls: [["Activity_PrintShippingLabel", "instances", [["pulse-label", "running", true]]]],
      incidents: [["Activity_RenderLabel", "pulse-label"]],
      waits: [["Activity_RenderLabel", "pulse-label"]],
      path: [["Event_DispatchRequested", "completed"]],
    })
    expect(ScreenFigures.instance(WORLD_SCREENS.calledInstance)).toMatchObject({
      caller: "pulse-dispatch",
      headline: "incident",
      incidents: [["Activity_RenderLabel", null]],
      waits: [["Activity_RenderLabel", null]],
    })
  })

  test("leave out ids, names, times, the engine's words, the order a dialect reads in and the runs still open", () => {
    const screen = WORLD_SCREENS.instance
    const elsewhere: InstanceScreenData = {
      ...screen,
      engine: "c8-conformance",
      asOf: "2026-11-20T10:00:00.000Z",
      instance: {
        ...screen.instance,
        id: "2251799813685249",
        startedAt: "2026-11-20T09:00:00.000Z",
      },
      markers: [...screen.markers].reverse(),
      path: [...screen.path].reverse().filter(({ state }) => state !== "active"),
      calls: screen.calls.map((link) =>
        link.kind === "instances"
          ? {
              ...link,
              instances: link.instances.map((called) => ({ ...called, id: "2251799813685250" })),
            }
          : link,
      ),
      incidents: screen.incidents.map((card) => ({
        ...card,
        type: "JOB_NO_RETRIES",
        message: "No more retries left.",
      })),
      waits: screen.waits.map((wait) => ({
        ...wait,
        kind: "workerTask",
        taskType: "render-label",
      })),
    }

    expect(ScreenFigures.instance(elsewhere)).toStrictEqual(ScreenFigures.instance(screen))
  })

  test("name a call activity's target where it called nothing yet, and no caller it did not find", () => {
    const screen: InstanceScreenData = {
      ...WORLD_SCREENS.calledInstance,
      caller: { instanceId: "fake-DSP-3001", found: null },
      headline: null,
      calls: [
        { elementId: "B", kind: "missing", bpmnProcessId: "archive" },
        {
          elementId: "A",
          kind: "definition",
          definition: { id: "x:1", bpmnProcessId: "x", version: 1 },
        },
      ],
    }

    expect(ScreenFigures.instance(screen)).toMatchObject({
      caller: null,
      headline: null,
      calls: [
        ["A", "definition", []],
        ["B", "missing", []],
      ],
    })
  })
})
