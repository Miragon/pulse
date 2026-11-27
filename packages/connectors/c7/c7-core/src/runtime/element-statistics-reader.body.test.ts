/**
 * The counts of a multi-instance activity on the diagram: Camunda 7 reports its body apart
 * (`<id>#multiInstanceBody`, a token waiting at the body itself, its failed job and incident), and
 * the reader adds them to the activity's, so every surface shows them on the element of the
 * diagram, as Camunda 8 reports them. An incident without an element counts at none.
 */

import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import { ElementStatisticsReader } from "./element-statistics-reader.js"

const ORDER = DefinitionId("order:1:x")

const XML = [
  '<bpmn:process id="order">',
  '<bpmn:userTask id="Activity_Approve" />',
  '<bpmn:callActivity id="Activity_PrintEach" calledElement="label" />',
  "</bpmn:process>",
].join("\n")

const failed = (incidentCount: number) => ({ incidentType: "failedJob", incidentCount })

const incident = (id: string, activityId: string | null, rootCauseIncidentId = id) => ({
  id,
  incidentType: "failedJob",
  activityId,
  incidentTimestamp: "2026-11-26T10:00:00.000+0000",
  rootCauseIncidentId,
})

function readerOver(activities: unknown, incidents: unknown = []) {
  const port = fakePort({
    getActivityStatistics: () => activities,
    getProcessDefinitionBpmn20Xml: () => ({ id: ORDER, bpmn20Xml: XML }),
    getIncidents: () => incidents,
  })
  return { port, reader: new ElementStatisticsReader(port) }
}

describe("ElementStatisticsReader, a multi-instance body", () => {
  it("adds the body's failed job and incident to the activity whose items wait", async () => {
    const { reader } = readerOver([
      { id: "Activity_Approve", instances: 3, failedJobs: 0, incidents: [] },
      {
        id: "Activity_Approve#multiInstanceBody",
        instances: 1,
        failedJobs: 1,
        incidents: [failed(1)],
      },
    ])
    expect(await reader.withFailedJobs(ORDER)).toEqual([
      {
        elementId: "Activity_Approve",
        active: 3,
        incidents: 1,
        incidentsInCalledInstances: 0,
        failedJobs: 1,
      },
    ])
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Approve", active: 3, incidents: 1, incidentsInCalledInstances: 0 },
    ])
  })

  it("counts a token at the body without an incident as active at its activity", async () => {
    const { reader } = readerOver([
      { id: "Activity_Approve#multiInstanceBody", instances: 2, failedJobs: 0, incidents: [] },
    ])
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Approve", active: 2, incidents: 0, incidentsInCalledInstances: 0 },
    ])
  })

  it("lets a body's incident hold the body's token only, never an item's", async () => {
    const { reader } = readerOver([
      { id: "Activity_Approve", instances: 2, failedJobs: 0, incidents: [] },
      {
        id: "Activity_Approve#multiInstanceBody",
        instances: 0,
        failedJobs: 0,
        incidents: [failed(1)],
      },
    ])
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Approve", active: 2, incidents: 1, incidentsInCalledInstances: 0 },
    ])
  })

  it("tells the copies at a multi-instance call activity's items from the body's root incident", async () => {
    const { port, reader } = readerOver(
      [
        { id: "Activity_PrintEach", instances: 2, incidents: [failed(2)] },
        { id: "Activity_PrintEach#multiInstanceBody", instances: 1, incidents: [failed(1)] },
      ],
      [
        incident("c1", "Activity_PrintEach", "deep-1"),
        incident("c2", "Activity_PrintEach", "deep-2"),
      ],
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_PrintEach", active: 2, incidents: 1, incidentsInCalledInstances: 2 },
    ])
    const reads = port.calls.filter((call) => call.operationId === "getIncidents")
    expect(reads.map((call) => call.input.query.activityId)).toEqual(["Activity_PrintEach"])
  })

  it("counts an incident of a version's whole read that names no element at none", async () => {
    // A call activity without an id: its call activities cannot be told, so it reads every incident.
    const reader = new ElementStatisticsReader(
      fakePort({
        getActivityStatistics: () => [
          { id: "Activity_Approve", instances: 1, incidents: [failed(1)] },
        ],
        getProcessDefinitionBpmn20Xml: () => ({ id: ORDER, bpmn20Xml: "<callActivity />" }),
        getIncidents: () => [incident("r1", "Activity_Approve"), incident("r2", null)],
      }),
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Approve", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
    ])
  })
})
