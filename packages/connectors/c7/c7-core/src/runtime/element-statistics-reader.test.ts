import { DefinitionId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { ElementStatisticsReader } from "./element-statistics-reader.js"

const ORDER = DefinitionId("order:1:x")

const incident = (id: string, activityId: string, rootCauseIncidentId?: string) => ({
  id,
  incidentType: "failedJob",
  activityId,
  incidentTimestamp: "2026-10-21T18:44:04.587+0000",
  ...(rootCauseIncidentId === undefined ? {} : { rootCauseIncidentId }),
})

function readerOver(activities: unknown, incidents: unknown) {
  const port = fakePort({
    getActivityStatistics: () => activities,
    getIncidents: () => incidents,
  })
  return { port, reader: new ElementStatisticsReader(port) }
}

describe("ElementStatisticsReader", () => {
  it("counts per element the tokens waiting there and the incidents raised there or below", async () => {
    const { reader } = readerOver(
      [
        { id: "Activity_Review", instances: 3, failedJobs: 0, incidents: [] },
        { id: "Activity_Charge", instances: 1, failedJobs: 1, incidents: [] },
        { id: "Activity_Call", instances: 2 },
      ],
      [
        incident("i1", "Activity_Charge"),
        incident("i2", "Activity_Review", "i2"),
        incident("i3", "Activity_Call", "i9"),
        incident("i4", "Activity_Call", "i8"),
        incident("i5", "Activity_Boundary"),
        incident("i6", "Activity_Called", "i7"),
      ],
    )
    expect(await reader.of(ORDER)).toEqual([
      { elementId: "Activity_Review", active: 2, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Charge", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Call", active: 2, incidents: 0, incidentsInCalledInstances: 2 },
      { elementId: "Activity_Boundary", active: 0, incidents: 1, incidentsInCalledInstances: 0 },
      { elementId: "Activity_Called", active: 0, incidents: 0, incidentsInCalledInstances: 1 },
    ])
  })

  it("has no counts for a version without tokens or incidents", async () => {
    const { reader } = readerOver([], [])
    expect(await reader.of(ORDER)).toEqual([])
  })

  it("reads the version's statistics and every page of its incidents, newest first", async () => {
    const { port, reader } = readerOver([], [])
    await reader.of(ORDER)
    expect(port.calls).toEqual([
      { operationId: "getActivityStatistics", input: { pathArgs: [ORDER], query: {} } },
      {
        operationId: "getIncidents",
        input: {
          pathArgs: [],
          query: {
            processDefinitionId: ORDER,
            sortBy: "incidentTimestamp",
            sortOrder: "desc",
            firstResult: "0",
            maxResults: "500",
          },
        },
      },
    ])
    expect(Object.keys(port.calls[1]?.input.query ?? {})).toEqual([
      "processDefinitionId",
      "sortBy",
      "sortOrder",
      "firstResult",
      "maxResults",
    ])
  })

  it("fails an id no engine assigns as misconfigured, before any request", async () => {
    const { port, reader } = readerOver([], [])
    const read = reader.of(DefinitionId("../order"))
    await expect(read).rejects.toBeInstanceOf(RuntimeError)
    await expect(read).rejects.toMatchObject({
      failure: "misconfigured",
      message: '"../order" as an identifier is not accepted',
    })
    expect(port.calls).toEqual([])
  })

  it("rejects an engine failure as it is", async () => {
    const failure = fakeFailure(404, "NotFoundException")
    const port = fakePort({
      getActivityStatistics: () => {
        throw failure
      },
      getIncidents: () => [],
    })
    await expect(new ElementStatisticsReader(port).of(ORDER)).rejects.toBe(failure)
  })

  it.each([
    ["statistics that are no list", {}, [], "activity statistics is not a list"],
    ["an element without its id", [{ instances: 1 }], [], "id is missing"],
    ["an element without its count", [{ id: "A" }], [], "instances is missing"],
    ["incidents that are no list", [], {}, "/incident is not a list"],
    ["an incident that is no object", [], [null], "incidents[0] is not an object"],
    ["an incident without its type", [], [{ id: "i1" }], "incidentType is missing"],
  ])("fails %s as unexpected", async (_kind, activities, incidents, message) => {
    const { reader } = readerOver(activities, incidents)
    await expect(reader.of(ORDER)).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message,
    })
  })
})
