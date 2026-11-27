import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
  type Incident,
  type InstanceDetail,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import type { IncidentRow } from "../../src/core/protocol/index.js"
import { InstanceHeadline } from "../../src/core/views/instance-headline.js"
import { InstanceViewBuilder } from "../../src/core/views/instance-view-builder.js"

const ROOT = InstanceId("8f3c2a1e-0000-4000-8000-000000000001")
const SINCE = IsoTimestamp("2026-10-21T08:00:00Z")
const ORDER = {
  id: DefinitionId("order:1"),
  bpmnProcessId: BpmnProcessId("order"),
  tenantId: null,
  version: 1,
}

function incident(id: string): Incident {
  return {
    id: IncidentId(id),
    instanceId: ROOT,
    definition: ORDER,
    elementId: ElementId("Activity_Wait"),
    type: "failedJob",
    message: "boom",
    createdAt: SINCE,
  }
}

function cutView(incidents: readonly Incident[], state: "running" | "suspended" = "running") {
  const detail: InstanceDetail = {
    instance: { id: ROOT, definition: ORDER, state, hasIncident: true },
    path: [],
    waitStates: [],
    incidents,
    calledInstances: [],
    variables: [],
    truncated: true,
  }
  return new InstanceViewBuilder({
    writable: false,
    engine: { name: "local", environment: "local", host: "localhost" },
    asOf: new Date(SINCE),
    detail,
    diagramXml: "<definitions/>",
    calledProcesses: [],
    fullDetails: new Map(),
  }).build()
}

describe("the head of an instance whose lists the engine cut", () => {
  test("counts its one incident as at least one, in the strip and the head the blocks word", () => {
    const view = cutView([incident("i-1")])

    expect(view.head).toEqual({ code: "incidentsAtLeast", count: 1, suspended: false })
    expect(view.headline).toEqual({
      tone: "danger",
      title: "≥ 1 incident",
      detail: "boom",
      actions: [],
    })
  })

  test("counts several incidents as at least so many, suspended too", () => {
    const view = cutView([incident("i-1"), incident("i-2")], "suspended")

    expect(view.head).toEqual({ code: "incidentsAtLeast", count: 2, suspended: true })
    expect(view.headline?.title).toBe("≥ 2 incidents · suspended")
  })

  test("keeps an exact count without the bound", () => {
    const head = InstanceHeadline.headOf({ code: "incidents", count: 3, suspended: false })
    const rows = [{ message: "boom" } as IncidentRow]

    expect(head).toEqual({ code: "incidents", count: 3, suspended: false })
    expect(
      InstanceHeadline.of({ code: "incidents", count: 3, suspended: false }, rows)?.title,
    ).toBe("3 incidents")
  })
})
