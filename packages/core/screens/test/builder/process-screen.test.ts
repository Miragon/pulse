import {
  BpmnProcessId,
  DefinitionId,
  RuntimeError,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  ProcessScreen,
  ScreenJson,
  type ProcessScreenReads,
  type ProcessScreenRequest,
} from "../../src/builder/index.js"
import { WORLD_SCREENS } from "../../src/testing/index.js"
import { Processes } from "./support/processes.js"
import { ScreenWorld } from "./support/world.js"

const ORDER = BpmnProcessId("pulse-order")
const DISPATCH = BpmnProcessId("pulse-dispatch")
const FAILED = (): Promise<never> => Promise.reject(new RuntimeError("unreachable", "no answer"))
const SUB_PROCESS = `<process id="order">
  <subProcess id="Pack"><task id="Wrap" /></subProcess>
  <callActivity id="Call_Label" calledElement="label" />
</process>`

const idOf = (arg: unknown): unknown =>
  typeof arg === "object" && arg !== null && "id" in arg ? arg.id : arg

function counted(runtime: ProcessRuntime): {
  readonly reads: ProcessScreenReads
  readonly calls: string[]
} {
  const calls: string[] = []
  const log =
    <Args extends unknown[], Value>(name: string, read: (...args: Args) => Promise<Value>) =>
    (...args: Args): Promise<Value> => {
      calls.push(`${name} ${args.map((arg) => String(idOf(arg))).join(" ")}`)
      return read(...args)
    }
  return {
    calls,
    reads: {
      listVersions: log("listVersions", (id, tenantId) => runtime.listVersions(id, tenantId)),
      getDiagramXml: log("getDiagramXml", (id) => runtime.getDiagramXml(id)),
      getElementStatistics: log("getElementStatistics", (id) => runtime.getElementStatistics(id)),
      getCalledProcesses: log("getCalledProcesses", (version) =>
        runtime.getCalledProcesses(version),
      ),
    },
  }
}

async function screenOf(
  bpmnProcessId: BpmnProcessId,
  wanted?: string,
  patch: Partial<ProcessRuntime> = {},
) {
  const model = await ProcessScreen.read(
    "conformance",
    {
      bpmnProcessId,
      tenantId: null,
      ...(wanted === undefined ? {} : { definitionId: DefinitionId(wanted) }),
    },
    ScreenWorld.world(patch),
    () => ScreenWorld.AS_OF,
  )
  return model === undefined ? undefined : ScreenJson.process(model)
}

describe("the process screen's reads", () => {
  test("ask the time once, read the versions first, then the latest's diagram and statistics", async () => {
    const { reads, calls } = counted(ScreenWorld.world())
    const times: number[] = []

    await ProcessScreen.read("conformance", { bpmnProcessId: ORDER, tenantId: null }, reads, () => {
      times.push(calls.length)
      return ScreenWorld.AS_OF
    })

    expect(times).toEqual([0])
    expect(calls[0]).toBe("listVersions pulse-order null")
    expect(calls.slice(1).sort()).toEqual([
      "getDiagramXml pulse-order:2",
      "getElementStatistics pulse-order:2",
    ])
  })

  test("read the processes a version calls only where its diagram has a call activity", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    await ProcessScreen.read(
      "conformance",
      { bpmnProcessId: DISPATCH, tenantId: null },
      reads,
      () => ScreenWorld.AS_OF,
    )

    expect(calls).toContain("getCalledProcesses pulse-dispatch:1")
  })

  test("read the version asked for, and the latest where the engine holds no such version", async () => {
    expect((await screenOf(ORDER, "pulse-order:1"))?.selected?.version).toBe(1)
    expect((await screenOf(ORDER, "pulse-order:9"))?.selected?.version).toBe(2)
  })

  test("read the version an address names by its number, its definition id first, else the latest", async () => {
    const selectedOf = async (
      request: Omit<ProcessScreenRequest, "bpmnProcessId" | "tenantId">,
    ) => {
      const { reads, calls } = counted(ScreenWorld.world())
      const model = await ProcessScreen.read(
        "conformance",
        { bpmnProcessId: ORDER, tenantId: null, ...request },
        reads,
        () => ScreenWorld.AS_OF,
      )
      return { id: model?.selected?.definition.id, calls }
    }

    const byNumber = await selectedOf({ version: 1 })
    expect(byNumber.id).toBe("pulse-order:1")
    expect(byNumber.calls.filter((call) => call.startsWith("listVersions"))).toEqual([
      "listVersions pulse-order null",
    ])
    expect(byNumber.calls).toContain("getDiagramXml pulse-order:1")
    expect((await selectedOf({ version: 9 })).id).toBe("pulse-order:2")
    expect((await selectedOf({ definitionId: DefinitionId("pulse-order:2"), version: 1 })).id).toBe(
      "pulse-order:2",
    )
    expect((await selectedOf({ definitionId: DefinitionId("pulse-order:9"), version: 1 })).id).toBe(
      "pulse-order:1",
    )
  })

  test("give no screen for a process the engine holds no version of, and read nothing more", async () => {
    const { reads, calls } = counted(ScreenWorld.world())

    const model = await ProcessScreen.read(
      "conformance",
      { bpmnProcessId: BpmnProcessId("unknown"), tenantId: null },
      reads,
      () => ScreenWorld.AS_OF,
    )

    expect(model).toBeUndefined()
    expect(calls).toEqual(["listVersions unknown null"])
  })

  test("fail as the versions fail: they are the screen", async () => {
    const refused = new RuntimeError("forbidden", "no rights")

    await expect(
      screenOf(ORDER, undefined, { listVersions: () => Promise.reject(refused) }),
    ).rejects.toBe(refused)
  })

  test("keep the versions without the diagram, the statistics or the called processes, and name each", async () => {
    const screen = await screenOf(DISPATCH, undefined, {
      getDiagramXml: FAILED,
      getElementStatistics: FAILED,
      getCalledProcesses: FAILED,
    })

    expect(screen?.unread).toEqual(["diagram", "statistics", "calledProcesses"])
    expect(screen?.badges).toEqual([])
    expect(screen?.calls).toEqual([])
    expect(screen?.versions).toEqual(WORLD_SCREENS.callingProcess.versions)
  })

  test("read the processes a version calls where the call activity's id is quoted singly or the diagram is too long to read", async () => {
    const call = `<process id="order"><callActivity id='Call_Label' calledElement="label" /></process>`
    const long = `<definitions><documentation>${"x".repeat(4 * 1024 * 1024)}</documentation></definitions>`

    for (const diagram of [call, long]) {
      const { reads, calls } = counted(
        ScreenWorld.world({ getDiagramXml: () => Promise.resolve(diagram) }),
      )
      const model = await ProcessScreen.read(
        "conformance",
        { bpmnProcessId: ORDER, tenantId: null },
        reads,
        () => ScreenWorld.AS_OF,
      )

      expect(calls).toContain("getCalledProcesses pulse-order:2")
      expect(model?.unread).toEqual([])
    }
  })

  test("read the called processes where the diagram is not known, and take a diagram the engine lacks as unread", async () => {
    const { calls, reads } = counted(
      ScreenWorld.world({ getDiagramXml: () => Promise.resolve(undefined) }),
    )

    const model = await ProcessScreen.read(
      "conformance",
      { bpmnProcessId: ORDER, tenantId: null },
      reads,
      () => ScreenWorld.AS_OF,
    )

    expect(calls).toContain("getCalledProcesses pulse-order:2")
    expect(model?.unread).toEqual(["diagram"])
    expect(model?.badges).toEqual([
      { elementId: "Activity_ReviewOrder", active: 1, incidents: 0, incidentsInCalledInstances: 0 },
    ])
  })
})

describe("a process screen built from what a surface read", () => {
  test("rolls the incidents inside a collapsed sub-process up onto its shape, as a board does", () => {
    const model = ProcessScreen.of(
      Processes.facts({
        diagramXml: SUB_PROCESS,
        statistics: [
          Processes.statistic("Wrap", { active: 2, incidents: 1, incidentsInCalledInstances: 3 }),
          Processes.statistic("Call_Label", { active: 1 }),
          Processes.statistic("Idle", {}),
        ],
      }),
    )

    expect(model.badges).toEqual([
      Processes.statistic("Wrap", { active: 2, incidents: 1, incidentsInCalledInstances: 3 }),
      Processes.statistic("Call_Label", { active: 1 }),
      Processes.statistic("Pack", { incidents: 1, incidentsInCalledInstances: 3 }),
    ])
  })

  test("keeps the versions as the engine lists them, the newest selected where none is asked for", () => {
    const facts = Processes.facts()

    const model = ProcessScreen.of(facts)

    expect(model).toMatchObject({
      engine: "prod-a",
      asOf: Processes.AS_OF,
      bpmnProcessId: "order",
      versions: facts.versions,
      selected: facts.versions[0],
      calls: [],
      unread: [],
    })
  })

  test("names every part it was not handed as unread and has no selection without versions", () => {
    const model = ProcessScreen.of(
      Processes.facts({
        versions: [],
        selected: DefinitionId("order:1"),
        diagramXml: undefined,
        statistics: undefined,
        calledProcesses: undefined,
      }),
    )

    expect(model.selected).toBeUndefined()
    expect(model.notices).toEqual([])
    expect(model.badges).toEqual([])
    expect(model.unread).toEqual(["diagram", "statistics", "calledProcesses"])
  })

  test("links each call activity to the version it starts, or to the process the engine lacks", () => {
    const model = ProcessScreen.of(
      Processes.facts({
        calledProcesses: [
          { elementId: "A" as never, bpmnProcessId: BpmnProcessId("x"), tenantId: null },
          {
            elementId: "B" as never,
            bpmnProcessId: Processes.ORDER,
            tenantId: null,
            definition: Processes.definition(3),
          },
        ],
      }),
    )

    expect(ScreenJson.process(model).calls).toEqual([
      { elementId: "A", kind: "missing", bpmnProcessId: "x" },
      {
        elementId: "B",
        kind: "definition",
        definition: { id: "order:3", bpmnProcessId: "order", version: 3 },
      },
    ])
  })
})
