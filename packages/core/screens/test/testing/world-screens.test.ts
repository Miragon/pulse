import { BpmnProcessId, DefinitionId, InstanceId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  EngineScreen,
  Finder,
  InstanceList,
  InstanceScreen,
  ProcessScreen,
  ScreenJson,
} from "../../src/builder/index.js"
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

describe("the process screens and the instance list of the kit's fixed world", () => {
  test.each([
    ["process", undefined],
    ["olderVersion", "pulse-order:1"],
    ["callingProcess", undefined],
  ] as const)(
    "hold the %s screen the builder gives over the kit's fake engine",
    async (name, wanted) => {
      const expected = WORLD_SCREENS[name]

      const model = await ProcessScreen.read(
        expected.engine,
        {
          bpmnProcessId: BpmnProcessId(expected.bpmnProcessId),
          ...(wanted === undefined ? {} : { definitionId: DefinitionId(wanted) }),
        },
        ScreenWorld.world(),
        () => new Date(expected.asOf),
      )

      expect(model === undefined ? undefined : ScreenJson.process(model)).toStrictEqual(expected)
    },
  )

  test("hold the list of every instance of pulse-order's version 1 the builder gives", async () => {
    const expected = WORLD_SCREENS.instanceList

    const model = await InstanceList.read(
      expected.engine,
      { definitionId: DefinitionId(expected.definitionId), filter: { scope: "all" } },
      ScreenWorld.world(),
      () => new Date(expected.asOf),
    )

    expect(ScreenJson.instanceList(model)).toStrictEqual(expected)
  })
})

describe("what the finder finds over the kit's fixed world", () => {
  test.each([
    ["find", "ORD-1003"],
    ["findById", "fake-label-of-DSP-3001"],
  ] as const)("holds the %s screen the builder gives for %s", async (name, text) => {
    const expected = WORLD_SCREENS[name]

    const model = await Finder.read(
      expected.engine,
      text,
      ScreenWorld.world(),
      () => new Date(expected.asOf),
    )

    expect(ScreenJson.find(model)).toStrictEqual(expected)
  })

  test("gives figures without ids: each hit's business key, process, version, state, incident and whether it ended", () => {
    expect(ScreenFigures.find(WORLD_SCREENS.find)).toStrictEqual({
      hits: [["ORD-1003", "pulse-order", 1, "completed", false, true]],
      cut: false,
      historyGap: null,
    })
    expect(ScreenFigures.find(WORLD_SCREENS.findById)).toStrictEqual({
      hits: [[null, "pulse-label", 1, "running", true, false]],
      cut: false,
      historyGap: null,
    })
  })
})

describe("the figures of a process screen and an instance list", () => {
  test("keep the versions in their order, the selected version and the rest in an order of their own", () => {
    expect(ScreenFigures.process(WORLD_SCREENS.process)).toStrictEqual({
      bpmnProcessId: "pulse-order",
      selected: 2,
      versions: [
        [2, 1, 0],
        [1, 2, 1],
      ],
      badges: [["Activity_ReviewOrder", 1, 0, 0]],
      calls: [],
      notices: [["olderVersionsRun", 2, 1, 1]],
      unread: [],
    })
    expect(ScreenFigures.process(WORLD_SCREENS.olderVersion).badges).toStrictEqual([
      ["Activity_ChargePayment", 0, 1, 0],
      ["Activity_ReviewOrder", 1, 0, 0],
    ])
    expect(ScreenFigures.process(WORLD_SCREENS.callingProcess)).toMatchObject({
      selected: 1,
      badges: [["Activity_PrintShippingLabel", 1, 0, 1]],
      calls: [["Activity_PrintShippingLabel", "definition", "pulse-label", 1]],
    })
  })

  test("name a call to a process the engine lacks and a call activity's instances without a version", () => {
    const screen = {
      ...WORLD_SCREENS.callingProcess,
      selected: null,
      calls: [
        { elementId: "B", kind: "instances" as const, instances: [] },
        { elementId: "A", kind: "missing" as const, bpmnProcessId: "label" },
      ],
    }

    expect(ScreenFigures.process(screen)).toMatchObject({
      selected: null,
      calls: [
        ["A", "missing", "label", null],
        ["B", "instances", null, null],
      ],
    })
  })

  test("leave out ids, names, times and the order a dialect lists instances and badges in", () => {
    const list = WORLD_SCREENS.instanceList
    const elsewhere = {
      ...list,
      engine: "c8-conformance",
      asOf: "2026-11-20T10:00:00.000Z",
      definitionId: "2251799813685250",
      rows: [...list.rows].reverse().map((row, index) => ({
        ...row,
        id: String(2251799813685300 + index),
        startedAt: "2026-11-20T09:00:00.000Z",
      })),
      refusedVariableConditions: ["ordering" as const, "date" as const],
    }

    expect(ScreenFigures.instanceList(elsewhere)).toStrictEqual(ScreenFigures.instanceList(list))
    expect(ScreenFigures.instanceList(list)).toStrictEqual({
      rows: [
        ["ORD-1001", "running", false],
        ["ORD-1002", "running", true],
        ["ORD-1003", "completed", false],
      ],
      more: false,
      counts: { running: 2, withIncident: 1, ended: 1, all: 3, atLeast: [] },
    })
  })

  test("keep a later page without counts, a lower bound and a row without a business key", () => {
    const list = WORLD_SCREENS.instanceList
    const [first] = list.rows

    expect(
      ScreenFigures.instanceList({
        ...list,
        rows: first === undefined ? [] : [{ id: first.id, state: "running", hasIncident: false }],
        next: "50",
        counts: null,
      }),
    ).toStrictEqual({ rows: [[null, "running", false]], more: true, counts: null })
    expect(
      ScreenFigures.instanceList({
        ...list,
        counts: {
          running: 1000,
          withIncident: 0,
          ended: 0,
          all: 1000,
          atLeast: ["running", "all"],
        },
      }).counts?.atLeast,
    ).toEqual(["running", "all"])
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
