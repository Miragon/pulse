import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  RuntimeError,
  type Incident,
} from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import { BoardParser, type BoardParse } from "../../src/core/boards/board-parser.js"
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

const ENGINES: readonly EngineSetup[] = [
  { name: "shop", runtime: SHOP },
  { name: "billing", runtime: BILLING },
]

function board(widgets: unknown[], engines = ["shop", "billing"]) {
  return { title: "Orders", engines, rows: widgets.map((widget) => ({ row: [widget] })) }
}

function parse(widget: unknown, engines = ["shop", "billing"]): BoardParse {
  return BoardParser.parse(JSON.stringify(board([widget], engines)))
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

describe("the process widgets of a board file", () => {
  test("read a diagram of one engine and incidents of a process or of every process", () => {
    const parsed = BoardParser.parse(
      JSON.stringify({
        title: "Orders",
        engines: ["shop"],
        rows: [
          {
            row: [
              { widget: "processDiagram", props: { title: "Orders", process: "order" } },
              { widget: "incidentList", props: { process: "order" } },
              { widget: "incidentList" },
            ],
          },
        ],
      }),
    )

    expect(parsed).toEqual({
      board: {
        title: "Orders",
        engines: ["shop"],
        rows: [
          [
            { widget: "processDiagram", engines: ["shop"], title: "Orders", process: "order" },
            { widget: "incidentList", engines: ["shop"], process: "order" },
            { widget: "incidentList", engines: ["shop"] },
          ],
        ],
      },
    })
  })

  test("refuse a diagram without a process or over several engines", () => {
    expect(parse({ widget: "processDiagram" })).toEqual({
      problems: [
        { path: "rows[0].row[0].props.process", reason: "is missing" },
        {
          path: "rows[0].row[0].props.engines",
          reason: "must name one engine, because a diagram shows the deployment of one engine",
        },
      ],
    })
    expect(parse({ widget: "processDiagram", props: { process: " " } }, ["shop"])).toEqual({
      problems: [
        { path: "rows[0].row[0].props.process", reason: "must be a text that is not empty" },
      ],
    })
    expect(parse({ widget: "incidentList", props: { filter: {} } })).toEqual({
      problems: [
        {
          path: "rows[0].row[0].props.filter",
          reason: "is not a known key; use title, engines, process",
        },
      ],
    })
  })
})

describe("a process diagram on a board", () => {
  test("draws the latest version with running instances and incidents per element", async () => {
    const { fixture } = await opened([DIAGRAM])

    expect(tileOf(fixture, "processDiagram")).toEqual({
      kind: "processDiagram",
      title: "Order fulfillment",
      engine: "shop",
      bpmnProcessId: "order",
      diagram: {
        processName: "Order fulfillment",
        version: 1,
        diagramXml: XML,
        badges: [
          { elementId: "Task_Pay", running: 9, incidents: 0, incidentsInCalledInstances: 0 },
          { elementId: "Task_Ship", running: 3, incidents: 2, incidentsInCalledInstances: 0 },
        ],
      },
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
      title: "order",
      engine: "billing",
      bpmnProcessId: "order",
      notDeployed: true,
    })
    expect(tileOf(fixture, "processDiagram", 1)).toEqual({
      kind: "processDiagram",
      title: "order",
      engine: "shop",
      bpmnProcessId: "order",
    })
  })

  test("draws nothing from an engine that is not configured", async () => {
    const { fixture } = await opened([DIAGRAM], [{ name: "shop" }])

    expect(tileOf(fixture, "processDiagram")).not.toHaveProperty("diagram")
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
    await open({ scope: "running" }, "invoice")
    await open({ scope: "running" }, "order", "billing")

    expect(fixture.navigation.openDefinition.mock.calls).toEqual([
      [
        "shop",
        BpmnProcessId("order"),
        { scope: "withIncident", elementId: "Task_Ship" },
        { toSide: false },
      ],
      ["shop", BpmnProcessId("order"), { scope: "running" }, { toSide: false }],
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
      engine: "shop",
      id: "x-1",
      instanceId: "i-1",
      shortInstanceId: "i-1",
      processName: "Order fulfillment",
      bpmnProcessId: "order",
      elementId: "Task_Ship",
      message: "Payment provider timed out",
      createdAt: "2026-10-26T08:30:00.000Z",
    }
    expect(tileOf(fixture, "incidentList", 0)).toEqual({
      kind: "incidentList",
      title: "Open incidents of order",
      groups: [
        { engine: "shop", rows: [row], more: true },
        { engine: "billing", rows: [], unavailable: true },
      ],
    })
    expect(tileOf(fixture, "incidentList", 1)).toEqual({
      kind: "incidentList",
      title: "Everything",
      groups: [
        {
          engine: "shop",
          rows: [row, { ...row, id: "x-2", instanceId: "i-2", shortInstanceId: "i-2" }],
        },
      ],
    })
  })

  test("titles a list over every process and reads nothing from an engine that is not configured", async () => {
    const { fixture } = await opened([{ widget: "incidentList" }], [{ name: "prod" }])

    expect(tileOf(fixture, "incidentList")).toEqual({
      kind: "incidentList",
      title: "Open incidents",
      groups: [{ engine: "prod", rows: [], unavailable: true }],
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
