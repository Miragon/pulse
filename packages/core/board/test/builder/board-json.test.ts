import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  BoardBuilder,
  BoardJson,
  type BoardJsonOptions,
  type BoardModel,
} from "../../src/builder/index.js"
import { BoardParser, type BoardData } from "../../src/index.js"
import { COUNTER, DIAGRAM, EDGES, INCIDENTS, INSTANCES, SUMMARY } from "./support/edge-board.js"
import { BuilderWorld } from "./support/engines.js"

const ORDER = { process: "pulse-order" }
const STARTED = "2026-10-21T08:00:00.000Z"
const ORDER_V1 = {
  id: "pulse-order:1",
  bpmnProcessId: "pulse-order",
  version: 1,
  name: "Order fulfillment",
}
const ORDER_V2 = { ...ORDER_V1, id: "pulse-order:2", version: 2 }
const LABEL = { id: "pulse-label:1", bpmnProcessId: "pulse-label", version: 1, name: "Print label" }
const DISPATCH = {
  id: "pulse-dispatch:1",
  bpmnProcessId: "pulse-dispatch",
  version: 1,
  name: "Dispatch order",
}

const failureOf: BoardJsonOptions["failureOf"] = (error) =>
  error instanceof RuntimeError
    ? { code: error.failure, message: error.message }
    : { code: "unknown" }

async function worldBoard(): Promise<{ readonly data: BoardData; readonly widgets: unknown[] }> {
  const parsed = BoardParser.parse(
    JSON.stringify({
      $schema: 1,
      title: "Orders",
      engines: ["shop", "locked", "prod"],
      theme: "dark",
      rows: [
        { row: [{ widget: "counter", props: { filter: ORDER, warnAbove: 2 } }] },
        { row: [{ widget: "instanceList", props: { filter: ORDER, engines: ["shop"] } }] },
        { row: [{ widget: "incidentSummary" }] },
        {
          row: [{ widget: "processDiagram", props: { engines: ["shop"], process: "pulse-order" } }],
        },
        { row: [{ widget: "incidentList", props: { engines: ["shop"] } }] },
        { row: [{ widget: "chart", props: { title: "Throughput" } }] },
      ],
    }),
  )
  if ("problems" in parsed) {
    throw new Error(JSON.stringify(parsed.problems))
  }
  const model = await BoardBuilder.build(parsed.board, [
    { name: "shop", reads: BuilderWorld.world() },
    {
      name: "locked",
      reads: BuilderWorld.world({
        describeEngine: () => Promise.reject(new RuntimeError("unauthorized", "HTTP 401")),
      }),
    },
    { name: "prod" },
  ])
  const data = BoardJson.of(model, { failureOf, notes: parsed.notes })
  return { data, widgets: parsed.board.rows.map((row) => row[0]) }
}

describe("the JSON form of a board built over the kit's world", () => {
  test("holds the board's title, each engine's state and the file's notes", async () => {
    const { data } = await worldBoard()

    expect(data.title).toBe("Orders")
    expect(data.engines).toStrictEqual([
      {
        name: "shop",
        state: "ready",
        product: "Fake engine",
        version: "1.0.0",
        totals: { running: 5, withIncident: 3 },
      },
      { name: "locked", state: "failed", failure: { code: "unauthorized", message: "HTTP 401" } },
      { name: "prod", state: "notConfigured" },
    ])
    expect(data.notes).toStrictEqual([
      { path: "theme", code: "ignoredKey" },
      { path: "$schema", code: "schemaNotText" },
    ])
  })

  test("holds every kind of tile with its widget and its numbers, ids and dates as text", async () => {
    const { data, widgets } = await worldBoard()

    expect(data.rows).toStrictEqual([
      [
        {
          kind: "counter",
          widget: widgets[0],
          readings: [
            { engine: "shop", count: { count: 3 }, above: true },
            { engine: "locked" },
            { engine: "prod" },
          ],
          known: 1,
          total: { count: 3 },
        },
      ],
      [
        {
          kind: "instanceList",
          widget: widgets[1],
          groups: [
            {
              engine: "shop",
              instances: (
                [
                  ["fake-ORD-1001", ORDER_V1, false, "ORD-1001"],
                  ["fake-ORD-1002", ORDER_V1, true, "ORD-1002"],
                  ["fake-ORD-2001", ORDER_V2, false, "ORD-2001"],
                ] as const
              ).map(([id, definition, hasIncident, businessKey]) => ({
                id,
                definition,
                state: "running",
                hasIncident,
                businessKey,
                startedAt: STARTED,
              })),
              total: { count: 3 },
            },
          ],
        },
      ],
      [
        {
          kind: "incidentSummary",
          widget: widgets[2],
          engines: 3,
          known: 1,
          total: 3,
          rows: [ORDER_V2, LABEL, DISPATCH].map((process) => ({
            engine: "shop",
            process,
            withIncident: 1,
          })),
        },
      ],
      [
        {
          kind: "processDiagram",
          widget: widgets[3],
          engine: "shop",
          latest: ORDER_V2,
          badges: [
            {
              elementId: "Activity_ReviewOrder",
              active: 1,
              incidents: 0,
              incidentsInCalledInstances: 0,
            },
          ],
        },
      ],
      [
        {
          kind: "incidentList",
          widget: widgets[4],
          groups: [
            {
              engine: "shop",
              incidents: (
                [
                  ["fake-ORD-1002", ORDER_V1, "Activity_ChargePayment"],
                  ["fake-label-of-DSP-3001", LABEL, "Activity_RenderLabel"],
                ] as const
              ).map(([instanceId, definition, elementId]) => ({
                id: `incident-of-${instanceId}`,
                instanceId,
                definition,
                elementId,
                type: "failedTask",
                message: "Cannot resolve identifier",
                createdAt: "2026-10-21T08:00:02.000Z",
              })),
            },
          ],
        },
      ],
      [
        {
          kind: "refused",
          widget: "chart",
          title: "Throughput",
          problems: [
            {
              path: "rows[5].row[0].widget",
              code: "notOneOf",
              values: expect.anything() as unknown,
            },
          ],
        },
      ],
    ])
  })

  test("reads back from its JSON text as the same data", async () => {
    const { data } = await worldBoard()

    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
  })
})

describe("the JSON form of a board's edges", () => {
  test("leaves out what was not read, carries a lower bound and keeps only the fields it names", () => {
    const data = BoardJson.of(EDGES, { failureOf, notes: [] })

    expect(data).toStrictEqual({
      title: "Edges",
      engines: [{ name: "slow", state: "ready", product: "Engine", version: "2.1.5" }],
      rows: [
        [
          {
            kind: "counter",
            widget: COUNTER,
            readings: [
              { engine: "slow", count: { count: 10, atLeast: true }, undecided: true },
              { engine: "down" },
            ],
            known: 1,
            total: { count: 10, atLeast: true },
          },
          { kind: "counter", widget: COUNTER, readings: [{ engine: "down" }], known: 0 },
        ],
        [
          {
            kind: "instanceList",
            widget: INSTANCES,
            groups: [
              {
                engine: "slow",
                instances: [
                  {
                    id: "sub-1",
                    definition: { id: "order:3", bpmnProcessId: "order", version: 3 },
                    state: "terminated",
                    hasIncident: false,
                    endedAt: "2026-10-21T09:00:00.000Z",
                  },
                ],
              },
              { engine: "down" },
            ],
          },
          {
            kind: "incidentSummary",
            widget: SUMMARY,
            engines: 2,
            known: 0,
            rows: [{ engine: "slow" }],
          },
        ],
        [
          { kind: "processDiagram", widget: DIAGRAM, engine: "slow", notDeployed: true },
          { kind: "processDiagram", widget: DIAGRAM, engine: "down" },
          {
            kind: "incidentList",
            widget: INCIDENTS,
            groups: [
              {
                engine: "slow",
                incidents: [
                  {
                    id: "incident-1",
                    instanceId: "sub-1",
                    definition: { id: "order:3", bpmnProcessId: "order", version: 3 },
                    elementId: "Task_Pay",
                    type: "failedJob",
                    message: "Payment failed",
                    createdAt: "2026-10-21T08:30:00.000Z",
                  },
                ],
                more: true,
              },
              { engine: "down" },
            ],
          },
          { kind: "refused", problems: [{ path: "rows[2].row[3]", code: "notAnObject" }] },
        ],
      ],
      notes: [],
    })
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
  })

  test("words a failed engine through the surface's failureOf, with the error as thrown", () => {
    const thrown = new Error("socket hang up")
    const model: BoardModel = {
      title: "Failed",
      engines: [{ name: "gone", state: "failed", error: thrown }],
      rows: [],
    }

    const data = BoardJson.of(model, {
      failureOf: (error) => ({ code: error === thrown ? "unreachable" : "other" }),
      notes: [],
    })

    expect(data.engines).toStrictEqual([
      { name: "gone", state: "failed", failure: { code: "unreachable" } },
    ])
  })
})
