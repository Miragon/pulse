import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  PageCursor,
  RuntimeError,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort, type Route } from "../testing/fake-port.js"
import { DefinitionReader } from "./definition-reader.js"
import { IncidentSearch } from "./incident-search.js"

const ORDER_1 = { id: "order:1:a", key: "order", version: 1, name: "Order" }
const LABEL_1 = { id: "label:1:b", key: "label", version: 1 }

const ROOT = {
  id: "inc-1",
  incidentType: "failedJob",
  activityId: "Activity_Charge",
  incidentTimestamp: "2026-10-21T18:44:04.554+0000",
  processInstanceId: "p1",
  processDefinitionId: ORDER_1.id,
  incidentMessage: "boom",
  rootCauseIncidentId: "inc-1",
  configuration: "job-1",
}

function searchOver(incidents: Route) {
  const port = fakePort({
    getIncidents: incidents,
    getProcessDefinitionStatistics: () => [
      { definition: ORDER_1, instances: 1 },
      { definition: LABEL_1, instances: 1 },
    ],
  })
  return { port, search: new IncidentSearch(port, new DefinitionReader(port)) }
}

async function rejection(read: Promise<unknown>): Promise<unknown> {
  return read.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe("IncidentSearch.search", () => {
  it("lists the root incidents, each with the version it was raised in and its job", async () => {
    const { port, search } = searchOver(() => [
      ROOT,
      { ...ROOT, id: "inc-2", rootCauseIncidentId: "inc-9" },
      {
        ...ROOT,
        id: "inc-3",
        rootCauseIncidentId: undefined,
        processDefinitionId: LABEL_1.id,
        processInstanceId: "p2",
        activityId: "Activity_Render",
        incidentType: "failedExternalTask",
        configuration: "task-1",
        incidentMessage: undefined,
        incidentTimestamp: "2026-10-21T18:44:04.613+0200",
      },
    ])

    expect(await search.search({}, { limit: 50 })).toStrictEqual({
      items: [
        {
          id: "inc-1",
          instanceId: "p1",
          definition: { id: ORDER_1.id, bpmnProcessId: "order", version: 1, name: "Order" },
          elementId: "Activity_Charge",
          type: "failedJob",
          message: "boom",
          createdAt: "2026-10-21T18:44:04.554Z",
          job: { id: "job-1" },
        },
        {
          id: "inc-3",
          instanceId: "p2",
          definition: { id: LABEL_1.id, bpmnProcessId: "label", version: 1 },
          elementId: "Activity_Render",
          type: "failedExternalTask",
          message: "",
          createdAt: "2026-10-21T16:44:04.613Z",
          job: { id: "task-1" },
        },
      ],
    })
    expect(port.calls.map((call) => call.operationId)).toStrictEqual([
      "getIncidents",
      "getProcessDefinitionStatistics",
    ])
  })

  it("lists no job where incident recovery names none", async () => {
    const { search } = searchOver(() => [
      { ...ROOT, incidentType: "invoiceMismatch" },
      { ...ROOT, id: "inc-2", rootCauseIncidentId: "inc-2", configuration: "" },
    ])

    const page = await search.search({}, { limit: 50 })

    expect(page.items.map((incident) => [incident.id, incident.job])).toStrictEqual([
      ["inc-1", undefined],
      ["inc-2", undefined],
    ])
    expect(page.items.every((incident) => !("job" in incident))).toBe(true)
  })

  it("leaves out an incident without its instance or of a version the engine does not list", async () => {
    const { search } = searchOver(() => [
      { ...ROOT, processInstanceId: undefined },
      { ...ROOT, id: "inc-2", rootCauseIncidentId: "inc-2", processDefinitionId: "gone:1:x" },
      { ...ROOT, id: "inc-3", rootCauseIncidentId: "inc-3", processDefinitionId: undefined },
    ])

    expect(await search.search({}, { limit: 50 })).toStrictEqual({ items: [] })
  })

  it("asks for the filter's incidents newest first, the page and one row more", async () => {
    const { port, search } = searchOver(() => [ROOT, ROOT, ROOT])

    const page = await search.search(
      {
        instanceId: InstanceId("p1"),
        bpmnProcessId: BpmnProcessId("order"),
        definitionId: DefinitionId(ORDER_1.id),
      },
      { limit: 2, after: PageCursor("4") },
    )

    expect(page.next).toBe("6")
    expect(page.items).toHaveLength(2)
    const query = port.calls[0]?.input.query
    expect(query).toStrictEqual({
      processDefinitionId: ORDER_1.id,
      processDefinitionKeyIn: "order",
      processInstanceId: "p1",
      sortBy: "incidentTimestamp",
      sortOrder: "desc",
      firstResult: "4",
      maxResults: "3",
    })
    expect(Object.keys(query ?? {})).toStrictEqual([
      "processDefinitionId",
      "processDefinitionKeyIn",
      "processInstanceId",
      "sortBy",
      "sortOrder",
      "firstResult",
      "maxResults",
    ])
  })

  it("asks for every incident without a filter", async () => {
    const { port, search } = searchOver(() => [])

    await search.search({}, { limit: 5 })

    expect(port.calls[0]?.input).toStrictEqual({
      pathArgs: [],
      query: {
        processDefinitionId: undefined,
        processDefinitionKeyIn: undefined,
        processInstanceId: undefined,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
        firstResult: "0",
        maxResults: "6",
      },
    })
  })

  it.each([
    ["a version", { definitionId: DefinitionId("order 1") }, "order 1"],
    ["a process", { bpmnProcessId: BpmnProcessId("order,label") }, "order,label"],
    ["an instance", { instanceId: InstanceId("p1&x=1") }, "p1&x=1"],
  ])(
    "fails %s no engine assigns as misconfigured, before the incidents are asked for",
    async (_name, filter, id) => {
      const { port, search } = searchOver(() => [])

      const error = await rejection(search.search(filter, { limit: 5 }))

      expect(error).toBeInstanceOf(RuntimeError)
      expect(error).toMatchObject({
        failure: "misconfigured",
        message: `"${id}" as an identifier is not accepted`,
      })
      expect(port.calls.map((call) => call.operationId)).toStrictEqual([
        "getProcessDefinitionStatistics",
      ])
    },
  )

  it("fails a cursor of another paging before it sends anything", async () => {
    const { port, search } = searchOver(() => [])

    await expect(search.search({}, { limit: 5, after: PageCursor("x") })).rejects.toThrow(
      RangeError,
    )
    expect(port.calls).toStrictEqual([])
  })

  it("fails an answer that is no list of incidents", async () => {
    const { search } = searchOver(() => ({ incidents: [] }))

    expect(await rejection(search.search({}, { limit: 5 }))).toMatchObject({
      failure: "unexpectedResponse",
      message: "incidents is not a list",
    })
  })
})
