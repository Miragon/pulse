import { DefinitionId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { ElementStatisticsReader } from "./element-statistics-reader.js"

const ORDER = DefinitionId("order:1:x")

const XML = [
  '<bpmn:process id="order">',
  '<bpmn:serviceTask id="Activity_Charge" />',
  '<bpmn:callActivity id="Activity_Call" calledElement="label" />',
  "</bpmn:process>",
].join("\n")

const incident = (id: string, activityId: string, rootCauseIncidentId?: string) => ({
  id,
  incidentType: "failedJob",
  activityId,
  incidentTimestamp: "2026-10-21T18:44:04.587+0000",
  ...(rootCauseIncidentId === undefined ? {} : { rootCauseIncidentId }),
})

const failed = (incidentCount: number, incidentType = "failedJob") => ({
  incidentType,
  incidentCount,
})

function readerOver(activities: unknown, incidents: unknown = [], xml: unknown = XML) {
  const port = fakePort({
    getActivityStatistics: () => activities,
    getProcessDefinitionBpmn20Xml: () => ({ id: ORDER, bpmn20Xml: xml }),
    getIncidents: () => incidents,
  })
  return { port, reader: new ElementStatisticsReader(port) }
}

const BY_ID = { sortBy: "incidentId", sortOrder: "asc" }
const FIRST_PAGE = { firstResult: "0", maxResults: "500" }

describe("ElementStatisticsReader", () => {
  it("counts per element the tokens there, its root incidents and the copies at a call activity", async () => {
    const { reader } = readerOver(
      [
        { id: "Activity_Review", instances: 3, failedJobs: 0, incidents: [failed(1)] },
        { id: "Activity_Charge", instances: 1, failedJobs: 1, incidents: [failed(1)] },
        { id: "Activity_Call", instances: 2, incidents: [failed(2)] },
        { id: "Activity_Boundary", instances: 0, incidents: [failed(1), failed(2, "custom")] },
      ],
      [incident("i3", "Activity_Call", "i9"), incident("i4", "Activity_Call", "i8")],
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Review", active: 2, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Charge", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Call", active: 2, incidents: 0, incidentsInCalledInstances: 2 },
      { elementId: "Activity_Boundary", active: 0, incidents: 3, incidentsInCalledInstances: 0 },
    ])
  })

  it("has no counts for a version without tokens or incidents", async () => {
    const { reader } = readerOver([])
    expect(await reader.of(ORDER)).toEqual([])
  })

  it("reads the statistics with incidents, the diagram, then the call activity's incidents", async () => {
    const { port, reader } = readerOver([
      { id: "Activity_Charge", instances: 1, incidents: [failed(4)] },
      { id: "Activity_Call", instances: 1, incidents: [failed(1)] },
    ])
    await reader.of(ORDER)
    expect(port.calls).toEqual([
      {
        operationId: "getActivityStatistics",
        input: { pathArgs: [ORDER], query: { incidents: "true" } },
      },
      { operationId: "getProcessDefinitionBpmn20Xml", input: { pathArgs: [ORDER], query: {} } },
      {
        operationId: "getIncidents",
        input: {
          pathArgs: [],
          query: {
            processDefinitionId: ORDER,
            activityId: "Activity_Call",
            ...BY_ID,
            ...FIRST_PAGE,
          },
        },
      },
    ])
    expect(Object.keys(port.calls[2]?.input.query ?? {})).toEqual([
      "processDefinitionId",
      "activityId",
      "sortBy",
      "sortOrder",
      "firstResult",
      "maxResults",
    ])
  })

  it("reads every incident of the version, by id, where its call activities cannot be told", async () => {
    const { port, reader } = readerOver(
      [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      [incident("i1", "Activity_Call", "i9")],
      "<bpmn:callActivity calledElement='label' />",
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Call", active: 1, incidents: 0, incidentsInCalledInstances: 1 },
    ])
    expect(port.calls.map((call) => [call.operationId, call.input.query])).toEqual([
      ["getActivityStatistics", { incidents: "true" }],
      ["getProcessDefinitionBpmn20Xml", {}],
      ["getIncidents", { processDefinitionId: ORDER, ...BY_ID, ...FIRST_PAGE }],
    ])
  })

  it("reads a version's diagram once, its call activities kept for the next read", async () => {
    const { port, reader } = readerOver([
      { id: "Activity_Call", instances: 1, incidents: [failed(1)] },
    ])
    await reader.of(ORDER)
    await reader.withFailedJobs(ORDER)
    expect(port.calls.map((call) => call.operationId)).toEqual([
      "getActivityStatistics",
      "getProcessDefinitionBpmn20Xml",
      "getIncidents",
      "getActivityStatistics",
      "getIncidents",
    ])
  })

  it("reads the diagram again where its call activities could not be told", async () => {
    const { port, reader } = readerOver(
      [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      [],
      "<callActivity />",
    )
    await reader.of(ORDER)
    await reader.of(ORDER)
    expect(port.calls.map((call) => call.operationId)).toEqual([
      "getActivityStatistics",
      "getProcessDefinitionBpmn20Xml",
      "getIncidents",
      "getActivityStatistics",
      "getProcessDefinitionBpmn20Xml",
      "getIncidents",
    ])
  })

  it("keeps the call activities of 64 versions, the first read going first", async () => {
    const { port, reader } = readerOver([
      { id: "Activity_Charge", instances: 1, incidents: [failed(1)] },
    ])
    const versions = Array.from({ length: 65 }, (_, at) =>
      DefinitionId(`order:${String(at + 1)}:x`),
    )
    for (const version of versions) await reader.of(version)
    const diagramReads = () =>
      port.calls
        .filter((call) => call.operationId === "getProcessDefinitionBpmn20Xml")
        .map((call) => call.input.pathArgs[0])
    expect(diagramReads()).toHaveLength(65)
    await reader.of(versions[1]!)
    expect(diagramReads()).toHaveLength(65)
    await reader.of(versions[0]!)
    expect(diagramReads()).toHaveLength(66)
    expect(diagramReads().at(-1)).toBe("order:1:x")
  })

  it("keeps no version whose call activities could not be told, so 64 others stay kept", async () => {
    const unreadable = DefinitionId("order:0:x")
    const port = fakePort({
      getActivityStatistics: () => [
        { id: "Activity_Charge", instances: 1, incidents: [failed(1)] },
      ],
      getProcessDefinitionBpmn20Xml: ({ pathArgs }) => ({
        id: pathArgs[0],
        bpmn20Xml: pathArgs[0] === unreadable ? "<callActivity />" : XML,
      }),
      getIncidents: () => [],
    })
    const reader = new ElementStatisticsReader(port)
    const versions = Array.from({ length: 64 }, (_, at) =>
      DefinitionId(`order:${String(at + 1)}:x`),
    )
    await reader.of(versions[0]!)
    await reader.of(unreadable)
    for (const version of versions.slice(1)) await reader.of(version)
    const diagramReads = () =>
      port.calls.filter((call) => call.operationId === "getProcessDefinitionBpmn20Xml").length
    expect(diagramReads()).toBe(65)
    await reader.of(versions[0]!)
    expect(diagramReads()).toBe(65)
  })

  it("reads the diagram through the runtime's read where one is given, never over the port", async () => {
    const port = fakePort({
      getActivityStatistics: () => [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      getIncidents: () => [incident("i1", "Activity_Call", "i9")],
    })
    const asked: string[] = []
    const reader = new ElementStatisticsReader(port, (id) => {
      asked.push(id)
      return Promise.resolve(XML)
    })
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Call", active: 1, incidents: 0, incidentsInCalledInstances: 1 },
    ])
    expect(asked).toEqual([ORDER])
    expect(port.calls.map((call) => [call.operationId, call.input.query.activityId])).toEqual([
      ["getActivityStatistics", undefined],
      ["getIncidents", "Activity_Call"],
    ])
  })

  it("reads every incident of the version where the runtime's read of its diagram fails", async () => {
    const port = fakePort({
      getActivityStatistics: () => [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      getIncidents: () => [incident("i1", "Activity_Call", "i9")],
    })
    const reader = new ElementStatisticsReader(port, () =>
      Promise.reject(new Error("the surface's read failed")),
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Call", active: 1, incidents: 0, incidentsInCalledInstances: 1 },
    ])
    expect(port.calls.map((call) => [call.operationId, call.input.query.activityId])).toEqual([
      ["getActivityStatistics", undefined],
      ["getIncidents", undefined],
    ])
  })

  it("counts each element's jobs without retries from the one statistics read with failedJobs", async () => {
    const { port, reader } = readerOver(
      [
        { id: "Activity_Charge", instances: 2, failedJobs: 1, incidents: [failed(1)] },
        { id: "Activity_Review", instances: 3 },
        { id: "Activity_Call", instances: 1, failedJobs: null, incidents: [failed(1)] },
      ],
      [incident("i2", "Activity_Call", "i9")],
    )
    expect(await reader.withFailedJobs(ORDER)).toEqual([
      {
        elementId: "Activity_Charge",
        active: 1,
        incidents: 1,
        incidentsInCalledInstances: 0,
        failedJobs: 1,
      },
      {
        elementId: "Activity_Review",
        active: 3,
        incidents: 0,
        incidentsInCalledInstances: 0,
        failedJobs: 0,
      },
      {
        elementId: "Activity_Call",
        active: 1,
        incidents: 0,
        incidentsInCalledInstances: 1,
        failedJobs: 0,
      },
    ])
    expect(port.calls.map((call) => [call.operationId, call.input.query])).toEqual([
      ["getActivityStatistics", { failedJobs: "true", incidents: "true" }],
      ["getProcessDefinitionBpmn20Xml", {}],
      [
        "getIncidents",
        { processDefinitionId: ORDER, activityId: "Activity_Call", ...BY_ID, ...FIRST_PAGE },
      ],
    ])
  })

  it("keeps the contract's counts free of the jobs without retries", async () => {
    const { reader } = readerOver([
      { id: "Activity_Charge", instances: 2, failedJobs: 1, incidents: [] },
    ])
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Charge", active: 2, incidents: 0, incidentsInCalledInstances: 0 },
    ])
  })

  it("fails jobs without retries that are no number as unexpected", async () => {
    const { reader } = readerOver([{ id: "A", instances: 1, failedJobs: "1" }])
    await expect(reader.withFailedJobs(ORDER)).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "failedJobs is not a number",
    })
  })

  it("fails an id no engine assigns as misconfigured, before any request", async () => {
    const { port, reader } = readerOver([])
    const read = reader.of(DefinitionId("../order"))
    await expect(read).rejects.toBeInstanceOf(RuntimeError)
    await expect(read).rejects.toMatchObject({
      failure: "misconfigured",
      message: '"../order" as an identifier is not accepted',
    })
    expect(port.calls).toEqual([])
  })

  it.each([
    ["the statistics", "getActivityStatistics"],
    ["the incidents", "getIncidents"],
  ])("rejects an engine failure of %s as it is", async (_read, failing) => {
    const failure = fakeFailure(500, "ProcessEngineException")
    const answers: Record<string, unknown> = {
      getActivityStatistics: [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      getProcessDefinitionBpmn20Xml: { id: ORDER, bpmn20Xml: XML },
      getIncidents: [],
    }
    const port = fakePort(
      Object.fromEntries(
        Object.entries(answers).map(([operationId, answer]) => [
          operationId,
          () => {
            if (operationId === failing) throw failure
            return answer
          },
        ]),
      ),
    )
    await expect(new ElementStatisticsReader(port).of(ORDER)).rejects.toBe(failure)
  })

  it.each([
    [
      "fails",
      () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    ],
    ["answers without its XML", () => ({ id: ORDER })],
  ])("reads every incident of the version where its diagram's read %s", async (_case, diagram) => {
    const port = fakePort({
      getActivityStatistics: () => [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      getProcessDefinitionBpmn20Xml: diagram,
      getIncidents: () => [incident("i1", "Activity_Call", "i9")],
    })
    expect(await new ElementStatisticsReader(port).of(ORDER)).toEqual([
      { elementId: "Activity_Call", active: 1, incidents: 0, incidentsInCalledInstances: 1 },
    ])
    expect(port.calls.map((call) => [call.operationId, call.input.query])).toEqual([
      ["getActivityStatistics", { incidents: "true" }],
      ["getProcessDefinitionBpmn20Xml", {}],
      ["getIncidents", { processDefinitionId: ORDER, ...BY_ID, ...FIRST_PAGE }],
    ])
  })

  it.each([
    ["statistics that are no list", {}, [], "activity statistics is not a list"],
    ["an element without its id", [{ instances: 1 }], [], "id is missing"],
    ["an element without its count", [{ id: "A" }], [], "instances is missing"],
    [
      "incidents per type that are no list",
      [{ id: "A", instances: 1, incidents: {} }],
      [],
      "incidents is not a list",
    ],
    [
      "an incident count that is no number",
      [{ id: "A", instances: 1, incidents: [{ incidentType: "failedJob", incidentCount: "1" }] }],
      [],
      "incidentCount is not a number",
    ],
    [
      "incidents that are no list",
      [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      {},
      "/incident is not a list",
    ],
    [
      "an incident that is no object",
      [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      [null],
      "incidents[0] is not an object",
    ],
    [
      "an incident without its type",
      [{ id: "Activity_Call", instances: 1, incidents: [failed(1)] }],
      [{ id: "i1" }],
      "incidentType is missing",
    ],
  ])("fails %s as unexpected", async (_kind, activities, incidents, message) => {
    const { reader } = readerOver(activities, incidents)
    await expect(reader.of(ORDER)).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message,
    })
  })
})
