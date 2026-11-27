import {
  BpmnProcessId,
  DefinitionId,
  InstanceId,
  PageCursor,
  RuntimeError,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { turningTies } from "../testing/fake-port.js"
import {
  idsOf,
  incidentsOf,
  LABEL_1,
  ORDER_1,
  pagesOf,
  ROOT,
  rootIncident,
  searchOver,
  secondsBefore,
} from "../testing/incident-search.test-support.js"

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

  it("asks for the filter's incidents newest first, the page and two rows more", async () => {
    const { port, search } = searchOver(() => [
      ROOT,
      rootIncident("inc-2", secondsBefore(1)),
      rootIncident("inc-3", secondsBefore(2)),
    ])

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
      maxResults: "4",
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
        maxResults: "7",
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

  it("fills the page past the incidents copied up from called instances, reading the versions once", async () => {
    const { port, search } = searchOver(
      incidentsOf([
        {
          ...ROOT,
          id: "inc-2",
          rootCauseIncidentId: "inc-9",
          incidentTimestamp: secondsBefore(-1),
        },
        ROOT,
        rootIncident("inc-3", secondsBefore(1)),
      ]),
    )

    const page = await search.search({}, { limit: 1 })

    expect(idsOf(page)).toStrictEqual(["inc-1"])
    expect(page.next).toBe("2")
    expect(port.calls.map((call) => call.operationId)).toStrictEqual([
      "getIncidents",
      "getProcessDefinitionStatistics",
      "getIncidents",
    ])
    // The full window's last incident may tie with the next: read again at the next window's start.
    expect(port.calls[2]?.input.query).toMatchObject({ firstResult: "2", maxResults: "6" })
  })

  it("keeps no incident without its instance or of a version the engine does not list", async () => {
    const { search } = searchOver(
      incidentsOf([
        { ...ROOT, id: "inc-2", rootCauseIncidentId: "inc-2", processInstanceId: undefined },
        { ...ROOT, id: "inc-3", rootCauseIncidentId: "inc-3", processDefinitionId: "gone:1:x" },
        { ...ROOT, id: "inc-4", rootCauseIncidentId: "inc-4", processDefinitionId: undefined },
        ROOT,
      ]),
    )

    expect(await search.search({}, { limit: 1 })).toStrictEqual({
      items: [expect.objectContaining({ id: "inc-1" })],
    })
  })

  it("orders incidents raised at once by id on every read, across pages too", async () => {
    const { search } = searchOver(incidentsOf([rootIncident("inc-b"), rootIncident("inc-a")]))

    const first = await search.search({}, { limit: 1 })
    const second = await search.search({}, { limit: 1, after: first.next ?? PageCursor("none") })
    const whole = await search.search({}, { limit: 2 })

    expect([idsOf(first), first.next, idsOf(second), second.next]).toStrictEqual([
      ["inc-a"],
      "0.1",
      ["inc-b"],
      undefined,
    ])
    expect(idsOf(whole)).toStrictEqual(["inc-a", "inc-b"])
  })

  it("pages without gaps or repeats where the engine orders incidents raised at once anew on each request", async () => {
    const tied = ["inc-x", "inc-y", "inc-z"].map((id) => rootIncident(id, secondsBefore(1)))
    // Each request turns the tied incidents one further, as a database may.
    const { search } = searchOver(
      turningTies(
        [ROOT, ...tied, rootIncident("inc-0", secondsBefore(2))],
        (row) => row.incidentTimestamp,
      ),
    )

    expect(await pagesOf(search, 2)).toStrictEqual([
      ["inc-1", "inc-x"],
      ["inc-y", "inc-z"],
      ["inc-0"],
    ])
  })

  it("stops at the tenth window, its cursor the first incident not read whole, keeping what it read", async () => {
    // Windows of 3, 6, 12 … 384, 500 and 500 rows, each from the last row of the one before, which
    // may tie with the next: the tenth reads offsets 1256 to 1755, ROOT and inc-2 the last two.
    const copies = Array.from({ length: 1754 }, (_, index) => ({
      ...ROOT,
      id: `inc-copy-${String(index)}`,
      rootCauseIncidentId: "inc-9",
      incidentTimestamp: secondsBefore(index - 1754),
    }))
    const { port, search } = searchOver(
      incidentsOf([...copies, ROOT, rootIncident("inc-2", secondsBefore(1))]),
    )

    const page = await search.search({}, { limit: 1 })

    expect(page).toStrictEqual({ items: [expect.objectContaining({ id: "inc-1" })], next: "1755" })
    expect(port.calls.filter((call) => call.operationId === "getIncidents")).toHaveLength(10)
  })

  it("returns the page newest first, whatever order the engine answered in", async () => {
    const { search } = searchOver(
      incidentsOf([
        rootIncident("inc-1", "2026-10-21T18:44:04.554+0000"),
        rootIncident("inc-2", "2026-10-21T18:44:04.613+0200"),
        rootIncident("inc-3", "2026-10-21T18:44:05.000+0000"),
      ]),
    )

    expect(idsOf(await search.search({}, { limit: 50 }))).toStrictEqual(["inc-3", "inc-1", "inc-2"])
  })

  it("fails an answer that is no list of incidents", async () => {
    const { search } = searchOver(() => ({ incidents: [] }))

    expect(await rejection(search.search({}, { limit: 5 }))).toMatchObject({
      failure: "unexpectedResponse",
      message: "incidents is not a list",
    })
  })
})
