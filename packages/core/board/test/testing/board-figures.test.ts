import { describe, expect, it } from "vitest"
import type {
  BoardData,
  DefinitionData,
  IncidentData,
  InstanceData,
  TileData,
} from "../../src/index.js"
import { BoardFigures } from "../../src/testing/index.js"

const ORDER: DefinitionData = { id: "order:2", bpmnProcessId: "pulse-order", version: 2 }
const FILTER = { process: "pulse-order", state: "running" } as const

function instance(id: string, businessKey: string, startedAt: string): InstanceData {
  return { id, definition: ORDER, state: "running", hasIncident: false, businessKey, startedAt }
}

function incident(id: string, elementId: string, createdAt: string): IncidentData {
  const fields = { type: "failedJob", message: "the card gateway is unreachable", createdAt }
  return { id, instanceId: `instance-${id}`, definition: ORDER, elementId, ...fields }
}

const TILES: readonly TileData[] = [
  {
    kind: "counter",
    widget: { widget: "counter", engines: ["shop"], filter: FILTER, warnAbove: 1 },
    readings: [{ engine: "shop", count: { count: 3 }, above: true }, { engine: "prod" }],
    known: 1,
    total: { count: 3 },
  },
  {
    kind: "instanceList",
    widget: { widget: "instanceList", engines: ["shop"], filter: FILTER, columns: [] },
    groups: [
      {
        engine: "shop",
        instances: [
          instance("first", "ORD-1001", "2026-11-17T08:00:00.000Z"),
          instance("second", "ORD-2001", "2026-11-17T09:00:00.000Z"),
        ],
        total: { count: 2 },
      },
      { engine: "prod" },
    ],
  },
  {
    kind: "incidentSummary",
    widget: { widget: "incidentSummary", engines: ["shop"], groupBy: "process" },
    engines: 2,
    known: 1,
    total: 2,
    rows: [{ engine: "shop", process: ORDER, withIncident: 2 }, { engine: "prod" }],
  },
  {
    kind: "processDiagram",
    widget: { widget: "processDiagram", engines: ["shop"], process: "pulse-order" },
    engine: "shop",
    latest: ORDER,
    badges: [{ elementId: "Task_A", active: 2, incidents: 1, incidentsInCalledInstances: 0 }],
  },
  {
    kind: "processDiagram",
    widget: { widget: "processDiagram", engines: ["prod"], process: "pulse-order" },
    engine: "prod",
    notDeployed: true,
  },
  {
    kind: "incidentList",
    widget: { widget: "incidentList", engines: ["shop"] },
    groups: [
      {
        engine: "shop",
        incidents: [
          incident("a", "Task_A", "2026-11-17T08:00:00.000Z"),
          incident("b", "Task_B", "2026-11-17T09:00:00.000Z"),
        ],
        more: true,
      },
      { engine: "prod" },
    ],
  },
  {
    kind: "refused",
    widget: "chart",
    problems: [
      { code: "notOneOf", path: "rows[1].row[0].widget", values: { choices: ["counter"] } },
    ],
  },
]

const BOARD: BoardData = {
  title: "Orders",
  engines: [
    {
      name: "shop",
      state: "ready",
      product: "Fake",
      version: "1",
      totals: { running: 4, withIncident: 2 },
    },
    { name: "edge", state: "ready", product: "Fake", version: "1" },
    { name: "prod", state: "failed", failure: { code: "unreachable" } },
    { name: "test", state: "notConfigured" },
  ],
  rows: [TILES.slice(0, 3), TILES.slice(3)],
  notes: [],
}

describe("BoardFigures.of", () => {
  it("reads each engine's totals or state and each tile's numbers, by engine", () => {
    expect(BoardFigures.of(BOARD)).toStrictEqual({
      engines: [{ running: 4, withIncident: 2 }, undefined, "failed", "notConfigured"],
      tiles: [
        {
          readings: [
            ["shop", { count: 3 }, true],
            ["prod", undefined, undefined],
          ],
          total: { count: 3 },
        },
        [
          {
            engine: "shop",
            total: { count: 2 },
            rows: ['["ORD-1001","running",false,2]', '["ORD-2001","running",false,2]'],
          },
          { engine: "prod", total: undefined, rows: undefined },
        ],
        { total: 2, rows: ['["prod",null,null]', '["shop","pulse-order",2]'] },
        {
          engine: "shop",
          version: 2,
          badges: [
            '{"elementId":"Task_A","active":2,"incidents":1,"incidentsInCalledInstances":0}',
          ],
        },
        { engine: "prod", version: undefined, badges: undefined },
        [
          { engine: "shop", more: true, rows: ['"Task_A"', '"Task_B"'] },
          { engine: "prod", more: undefined, rows: undefined },
        ],
        [{ code: "notOneOf", path: "rows[1].row[0].widget", values: { choices: ["counter"] } }],
      ],
    })
  })

  it("leaves out what each engine makes on its own: ids, dates and the order of rows", () => {
    const [counter, list, summary, diagram, otherDiagram, incidents, refused] = TILES
    const relisted: TileData = {
      kind: "instanceList",
      widget: { widget: "instanceList", engines: ["shop"], filter: FILTER, columns: [] },
      groups: [
        {
          engine: "shop",
          instances: [
            instance("other-second", "ORD-2001", "2026-11-18T09:00:00.000Z"),
            instance("other-first", "ORD-1001", "2026-11-18T08:00:00.000Z"),
          ],
          total: { count: 2 },
        },
        { engine: "prod" },
      ],
    }
    const reordered = {
      ...BOARD,
      rows: [[counter, relisted, summary, diagram, otherDiagram, incidents, refused]],
    } as BoardData

    expect(BoardFigures.of(reordered)).toStrictEqual(BoardFigures.of(BOARD))
    expect(list).not.toStrictEqual(relisted)
  })

  it("tells two boards apart by a count", () => {
    const [counter, ...rest] = TILES
    const recounted = { ...counter, total: { count: 4 } } as TileData

    expect(BoardFigures.of({ ...BOARD, rows: [[recounted, ...rest]] })).not.toStrictEqual(
      BoardFigures.of(BOARD),
    )
  })
})
