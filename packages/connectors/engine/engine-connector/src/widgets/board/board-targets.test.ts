import { describe, expect, it } from "vitest"
import { BOARD, ENDED_INSTANCE, RUNNING_INSTANCE } from "./board.test-support.js"
import { boardDecorations } from "./board-diagram.js"
import { engineTargetOf } from "./board-targets.js"

describe("a tile's target on the cockpit's routes", () => {
  it.each([
    [
      "an instance that runs: its detail, named by its business key",
      { kind: "instance", engine: "prod-a", instanceId: RUNNING_INSTANCE },
      { section: "instance-detail", processInstanceId: RUNNING_INSTANCE, label: "INV-0042" },
    ],
    [
      "an instance the board lists as ended: its history",
      { kind: "instance", engine: "prod-a", instanceId: ENDED_INSTANCE },
      { section: "history", processInstanceId: ENDED_INSTANCE },
    ],
    [
      "an ended instance of another engine is not this one",
      { kind: "instance", engine: "down", instanceId: ENDED_INSTANCE },
      { section: "instance-detail", processInstanceId: ENDED_INSTANCE },
    ],
    [
      "a row of an incident list: the incident, named by its element",
      { kind: "instance", engine: "prod-a", instanceId: RUNNING_INSTANCE, incidentId: "inc-1" },
      { section: "incident-detail", incidentId: "inc-1", label: "approve" },
    ],
    [
      "an incident the board does not list: by its id",
      { kind: "instance", engine: "down", instanceId: RUNNING_INSTANCE, incidentId: "inc-1" },
      { section: "incident-detail", incidentId: "inc-1" },
    ],
    [
      "the instances of a process: the process, named as the board's tiles name it",
      {
        kind: "instances",
        engine: "prod-a",
        bpmnProcessId: "invoice",
        filter: { scope: "running", elementId: "approve" },
      },
      { section: "process-detail", processDefinitionKey: "invoice", label: "Invoice receipt" },
    ],
    [
      "a process no tile names: by its key",
      { kind: "instances", engine: "prod-a", bpmnProcessId: "order", filter: { scope: "running" } },
      { section: "process-detail", processDefinitionKey: "order" },
    ],
    [
      "those with incident: the process on its incidents",
      {
        kind: "instances",
        engine: "prod-a",
        bpmnProcessId: "invoice",
        filter: { scope: "withIncident" },
      },
      {
        section: "process-detail",
        processDefinitionKey: "invoice",
        focus: "incidents",
        label: "Invoice receipt",
      },
    ],
    [
      "a summary row of a tenant: the process in that tenant (F17b)",
      {
        kind: "instances",
        engine: "prod-a",
        bpmnProcessId: "invoice",
        tenantId: "north",
        filter: { scope: "withIncident" },
      },
      {
        section: "process-detail",
        processDefinitionKey: "invoice",
        tenantId: "north",
        focus: "incidents",
      },
    ],
    [
      "an engine's count: its overview",
      { kind: "instances", engine: "prod-a", filter: { scope: "running" } },
      { section: "overview" },
    ],
    [
      "an engine's count with incident: its incidents",
      { kind: "instances", engine: "prod-a", filter: { scope: "withIncident" } },
      { section: "incidents" },
    ],
  ] as const)("%s", (_case, target, view) => {
    expect(engineTargetOf(target, BOARD)).toEqual({ engine: target.engine, view })
  })
})

describe("a tile's target where the cockpit's incident view does not read the engine", () => {
  it("opens an incident at the instance that holds it, and every other target as before", () => {
    const incident = {
      kind: "instance",
      engine: "prod-a",
      instanceId: RUNNING_INSTANCE,
      incidentId: "inc-1",
    } as const
    expect(engineTargetOf(incident, BOARD, false)).toEqual({
      engine: "prod-a",
      view: { section: "instance-detail", processInstanceId: RUNNING_INSTANCE, label: "INV-0042" },
    })
    const ended = { kind: "instance", engine: "prod-a", instanceId: ENDED_INSTANCE } as const
    expect(engineTargetOf(ended, BOARD, false)).toEqual(engineTargetOf(ended, BOARD))
  })
})

describe("a process's name for its crumb, from any tile that names it on that engine", () => {
  const toInvoice = (engine: string) =>
    ({ kind: "instances", engine, bpmnProcessId: "invoice", filter: { scope: "running" } }) as const

  it.each(["incidentSummary", "instanceList", "incidentList", "processDiagram"] as const)(
    "a board with only its %s tile",
    (kind) => {
      const only = { ...BOARD, rows: [BOARD.rows.flat().filter((tile) => tile.kind === kind)] }
      expect(engineTargetOf(toInvoice("prod-a"), only).view).toMatchObject({
        label: "Invoice receipt",
      })
    },
  )

  it("never one another engine's tile names", () => {
    expect(engineTargetOf(toInvoice("down"), BOARD).view).not.toHaveProperty("label")
  })
})

describe("the counts a board's diagram draws", () => {
  it("what runs in blue, the open root incidents in red, those of called instances apart and quiet", () => {
    expect(
      boardDecorations([
        { elementId: "approve", active: 7, incidents: 2, incidentsInCalledInstances: 1 },
        { elementId: "call", active: 0, incidents: 0, incidentsInCalledInstances: 4 },
      ]),
    ).toEqual([
      {
        elementId: "approve",
        counts: [
          { kind: "incidents", count: 2 },
          { kind: "incidentsInCalledInstances", count: 1 },
          { kind: "running", count: 7 },
        ],
        incident: true,
      },
      // A call activity with incidents in its called instances alone carries no incident outline.
      {
        elementId: "call",
        counts: [
          { kind: "incidents", count: 0 },
          { kind: "incidentsInCalledInstances", count: 4 },
          { kind: "running", count: 0 },
        ],
        incident: false,
      },
    ])
  })
})
