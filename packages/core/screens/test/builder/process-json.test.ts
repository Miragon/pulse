import { DefinitionId, InstanceId, IsoTimestamp, PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceList, ProcessScreen, ScreenJson } from "../../src/builder/index.js"
import { Processes } from "./support/processes.js"

describe("the JSON form of a process screen", () => {
  test("holds only the fields it names, survives a JSON round trip and keeps no model of its own", () => {
    const model = ProcessScreen.of(
      Processes.facts({
        statistics: [Processes.statistic("Task", { active: 2, incidents: 1 })],
        calledProcesses: undefined,
      }),
    )

    const data = ScreenJson.process(model)

    expect(data).toStrictEqual({
      engine: "prod-a",
      asOf: "2026-11-19T09:00:00.000Z",
      bpmnProcessId: "order",
      selected: { id: "order:3", bpmnProcessId: "order", version: 3, name: "Order" },
      versions: [
        {
          definition: { id: "order:3", bpmnProcessId: "order", version: 3, name: "Order" },
          running: 1,
          withIncident: 0,
        },
        {
          definition: { id: "order:2", bpmnProcessId: "order", version: 2, name: "Order" },
          running: 4,
          withIncident: 1,
        },
      ],
      badges: [{ elementId: "Task", running: 2, incidents: 1, incidentsInCalledInstances: 0 }],
      calls: [],
      notices: [
        {
          code: "olderVersionsRun",
          running: 4,
          withIncident: 1,
          show: { id: "order:2", bpmnProcessId: "order", version: 2, name: "Order" },
        },
      ],
      unread: ["calledProcesses"],
    })
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
    expect(data.unread).not.toBe(model.unread)
  })

  test("has no selection without versions", () => {
    expect(
      ScreenJson.process(ProcessScreen.of(Processes.facts({ versions: [] }))).selected,
    ).toBeNull()
  })
})

describe("the JSON form of an instance list", () => {
  test("holds each row's id, state, incident, business key and start, the cursor and the counts", () => {
    const definitionId = DefinitionId("order:2")
    const model = InstanceList.of({
      engine: "prod-a",
      asOf: Processes.AS_OF,
      definitionId,
      page: {
        items: [
          {
            id: InstanceId("i-1"),
            definition: Processes.definition(2),
            state: "suspended",
            hasIncident: true,
            businessKey: "ORD-1",
            startedAt: IsoTimestamp("2026-11-19T08:00:00.000Z"),
            endedAt: IsoTimestamp("2026-11-19T08:30:00.000Z"),
            parentInstanceId: InstanceId("caller"),
          },
          {
            id: InstanceId("i-2"),
            definition: Processes.definition(2),
            state: "running",
            hasIncident: false,
          },
        ],
        next: PageCursor("50"),
      },
      counts: { running: 1000, withIncident: 1, ended: 0, all: 1000, atLeast: ["running", "all"] },
      refusedVariableConditions: ["ordering"],
    })

    const data = ScreenJson.instanceList(model)

    expect(data).toStrictEqual({
      engine: "prod-a",
      asOf: "2026-11-19T09:00:00.000Z",
      definitionId: "order:2",
      rows: [
        {
          id: "i-1",
          state: "suspended",
          hasIncident: true,
          businessKey: "ORD-1",
          startedAt: "2026-11-19T08:00:00.000Z",
        },
        { id: "i-2", state: "running", hasIncident: false },
      ],
      next: "50",
      counts: { running: 1000, withIncident: 1, ended: 0, all: 1000, atLeast: ["running", "all"] },
      refusedVariableConditions: ["ordering"],
    })
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data)
    expect(data.refusedVariableConditions).not.toBe(model.refusedVariableConditions)
  })

  test("has no cursor on the last page and no counts on a later page", () => {
    const data = ScreenJson.instanceList(
      InstanceList.of({
        engine: "prod-a",
        asOf: Processes.AS_OF,
        definitionId: DefinitionId("order:2"),
        page: { items: [] },
        counts: undefined,
        refusedVariableConditions: [],
      }),
    )

    expect(data).toMatchObject({ rows: [], next: null, counts: null })
  })
})
