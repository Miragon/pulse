import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  RuntimeError,
  type Incident,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import type { BoardTile } from "../../src/core/protocol/index.js"
import { boardFixture, stubbed, summary, type EngineSetup } from "./support/board-fixture.js"

const XML =
  '<bpmn:process id="order"><bpmn:userTask id="Task_Pay"/><bpmn:serviceTask id="Task_Ship"/></bpmn:process>'

function incident(id: string, instanceId: string, elementId: string): Incident {
  return {
    id: IncidentId(id),
    instanceId: InstanceId(instanceId),
    definition: {
      id: DefinitionId("order:1"),
      bpmnProcessId: BpmnProcessId("order"),
      tenantId: null,
      version: 1,
      name: "Order fulfillment",
    },
    elementId: ElementId(elementId),
    type: "failedJob",
    message: "Payment provider timed out",
    createdAt: "2026-10-26T08:30:00.000Z" as Incident["createdAt"],
  }
}

const SHOP = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () => Promise.resolve([summary("order", 12, 3, "Order fulfillment")]),
  getDiagramXml: (definitionId) =>
    Promise.resolve(definitionId === DefinitionId("order:1") ? XML : undefined),
  getElementStatistics: () =>
    Promise.resolve([
      { elementId: ElementId("Task_Pay"), active: 9, incidents: 0, incidentsInCalledInstances: 0 },
      { elementId: ElementId("Task_Ship"), active: 3, incidents: 2, incidentsInCalledInstances: 0 },
    ]),
  searchIncidents: (filter) =>
    Promise.resolve(
      filter.bpmnProcessId === undefined
        ? { items: [incident("x-1", "i-1", "Task_Ship"), incident("x-2", "i-2", "Task_Ship")] }
        : { items: [incident("x-1", "i-1", "Task_Ship")], next: "page-2" as never },
    ),
})

const BILLING = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.23" }),
  listDefinitions: () => Promise.resolve([summary("invoice", 2, 0)]),
  searchIncidents: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
})

const BROKEN_STATISTICS = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () => Promise.resolve([summary("order", 1, 0)]),
  getDiagramXml: () => Promise.resolve(XML),
  getElementStatistics: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
})

const DIAGRAM = { widget: "processDiagram", props: { engines: ["shop"], process: "order" } }

const ORDER = { id: "order:1", bpmnProcessId: "order", version: 1, name: "Order fulfillment" }

const ENGINES: readonly EngineSetup[] = [
  { name: "shop", runtime: SHOP },
  { name: "billing", runtime: BILLING },
]

function board(widgets: unknown[], engines = ["shop", "billing"]) {
  return { title: "Orders", engines, rows: widgets.map((widget) => ({ row: [widget] })) }
}

async function opened(widgets: unknown[], engines: readonly EngineSetup[] = ENGINES) {
  const fixture = boardFixture(
    board(
      widgets,
      engines.map((engine) => engine.name),
    ),
    engines,
  )
  const panel = new BoardPanel(fixture.context)
  await panel.handle({ type: "ready" })
  return { fixture, panel }
}

function tileOf<Kind extends BoardTile["kind"]>(
  fixture: ReturnType<typeof boardFixture>,
  kind: Kind,
  row = 0,
): Extract<BoardTile, { kind: Kind }> {
  const found = fixture.view().rows[row]?.[0]
  if (found?.kind !== kind) {
    throw new Error(`expected a ${kind} in row ${row}`)
  }
  return found as Extract<BoardTile, { kind: Kind }>
}

describe("a process diagram on a board", () => {
  test("draws the latest version with running instances and incidents per element", async () => {
    const { fixture } = await opened([DIAGRAM])

    expect(tileOf(fixture, "processDiagram")).toEqual({
      kind: "processDiagram",
      widget: { widget: "processDiagram", engines: ["shop"], process: "order" },
      engine: "shop",
      latest: ORDER,
      badges: [
        { elementId: "Task_Pay", active: 9, incidents: 0, incidentsInCalledInstances: 0 },
        { elementId: "Task_Ship", active: 3, incidents: 2, incidentsInCalledInstances: 0 },
      ],
      diagramXml: XML,
    })
  })

  test("says when the process is not deployed, and draws nothing it could not count", async () => {
    const missing = { widget: "processDiagram", props: { engines: ["billing"], process: "order" } }
    const { fixture } = await opened(
      [missing, DIAGRAM],
      [
        { name: "shop", runtime: BROKEN_STATISTICS },
        { name: "billing", runtime: BILLING },
      ],
    )

    expect(tileOf(fixture, "processDiagram", 0)).toEqual({
      kind: "processDiagram",
      widget: { widget: "processDiagram", engines: ["billing"], process: "order" },
      engine: "billing",
      notDeployed: true,
    })
    expect(tileOf(fixture, "processDiagram", 1)).toEqual({
      kind: "processDiagram",
      widget: { widget: "processDiagram", engines: ["shop"], process: "order" },
      engine: "shop",
      latest: { id: "order:1", bpmnProcessId: "order", version: 1 },
    })
  })

  test("draws nothing from an engine that is not configured", async () => {
    const { fixture } = await opened([DIAGRAM], [{ name: "shop" }])

    expect(tileOf(fixture, "processDiagram")).not.toHaveProperty("diagramXml")
  })

  test("opens the process at an element it counts, never with a filter the diagram cannot show", async () => {
    const { fixture, panel } = await opened([DIAGRAM])
    const open = (filter: object, bpmnProcessId = "order", engine = "shop") =>
      panel.handle({
        type: "openBoardProcess",
        engine,
        bpmnProcessId,
        filter: filter as never,
        toSide: false,
      })

    await open({ scope: "withIncident", elementId: "Task_Ship" })
    await open({ scope: "running" })
    await open({ scope: "running", elementId: "Task_Unknown" })
    await open({ scope: "ended", elementId: "Task_Ship" })
    await open({ scope: "running", businessKey: "ORD-1" })
    await open({ scope: "running", variables: [] })
    await open({ scope: "running" }, "invoice")
    await open({ scope: "running" }, "order", "billing")

    expect(fixture.navigation.openDefinition.mock.calls).toEqual([
      [
        "shop",
        { bpmnProcessId: BpmnProcessId("order") },
        { scope: "withIncident", elementId: "Task_Ship" },
        { toSide: false },
      ],
      ["shop", { bpmnProcessId: BpmnProcessId("order") }, { scope: "running" }, { toSide: false }],
    ])
  })
})

describe("an incident list on a board", () => {
  test("lists the first incidents of each engine and says where more are open or nothing was read", async () => {
    const { fixture } = await opened([
      { widget: "incidentList", props: { process: "order" } },
      { widget: "incidentList", props: { title: "Everything", engines: ["shop"] } },
    ])

    const row = {
      id: "x-1",
      instanceId: "i-1",
      definition: ORDER,
      elementId: "Task_Ship",
      type: "failedJob",
      message: "Payment provider timed out",
      createdAt: "2026-10-26T08:30:00.000Z",
    }
    expect(tileOf(fixture, "incidentList", 0)).toEqual({
      kind: "incidentList",
      widget: { widget: "incidentList", engines: ["shop", "billing"], process: "order" },
      groups: [{ engine: "shop", incidents: [row], more: true }, { engine: "billing" }],
    })
    expect(tileOf(fixture, "incidentList", 1)).toEqual({
      kind: "incidentList",
      widget: { widget: "incidentList", engines: ["shop"], title: "Everything" },
      groups: [
        {
          engine: "shop",
          incidents: [row, { ...row, id: "x-2", instanceId: "i-2" }],
        },
      ],
    })
  })

  test("reads nothing from an engine that is not configured", async () => {
    const { fixture } = await opened([{ widget: "incidentList" }], [{ name: "prod" }])

    expect(tileOf(fixture, "incidentList")).toEqual({
      kind: "incidentList",
      widget: { widget: "incidentList", engines: ["prod"] },
      groups: [{ engine: "prod" }],
    })
  })

  test("opens the instance of a listed incident on its engine, and copies what the webview asks for", async () => {
    const { fixture, panel } = await opened([{ widget: "incidentList" }])

    await panel.handle({
      type: "openBoardInstance",
      engine: "shop",
      instanceId: "i-2",
      toSide: true,
    })
    await panel.handle({
      type: "openBoardInstance",
      engine: "billing",
      instanceId: "i-2",
      toSide: false,
    })
    await panel.handle({
      type: "copy",
      text: "Payment provider timed out",
      label: "Incident message",
    })

    expect(fixture.navigation.openInstance.mock.calls).toEqual([
      ["shop", InstanceId("i-2"), { toSide: true }],
    ])
    expect(fixture.navigation.copy.mock.calls).toEqual([
      ["Payment provider timed out", "Incident message"],
    ])
  })

  test("reads the incidents of a process once per engine", async () => {
    const { fixture } = await opened([
      { widget: "incidentList", props: { process: "order" } },
      { widget: "incidentList", props: { process: "order" } },
    ])

    expect(fixture.calls.get("shop")?.filter((call) => call === "searchIncidents")).toHaveLength(1)
  })
})
