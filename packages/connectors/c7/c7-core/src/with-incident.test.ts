import { describe, expect, it } from "vitest"
import { fakePort } from "./testing/fake-port.js"
import {
  countWithIncident,
  instancesWithIncident,
  unrecordedIncidents,
  WITH_INCIDENT,
  withIncidentAmong,
  withIncidentBody,
  withIncidentByVersion,
} from "./with-incident.js"

const PAGE = 500

function instance(id: string, definitionId = "order:1:a") {
  return { id, definitionId, suspended: false }
}

describe("WITH_INCIDENT", () => {
  it("is the runtime's process-instance filter, never a history filter", () => {
    expect(WITH_INCIDENT).toEqual({ withIncident: "true" })
  })
})

describe("withIncidentBody", () => {
  it("is the same filter in its typed form for a true flag", () => {
    expect(withIncidentBody(true)).toStrictEqual({ withIncident: true })
  })

  it.each([false, undefined])("sends nothing for %s, which the engine would ignore", (flag) => {
    expect(withIncidentBody(flag)).toStrictEqual({})
  })
})

describe("instancesWithIncident", () => {
  it("asks the runtime for the scope's instances with an open incident, ordered by id", async () => {
    const port = fakePort({
      getProcessInstances: () => [instance("p1"), instance("p2", "order:2:b")],
    })

    const found = await instancesWithIncident(port, {
      processDefinitionId: "order:1:a",
      processDefinitionKey: "order",
      businessKey: "B-1",
    })

    expect(found).toEqual([
      { id: "p1", definitionId: "order:1:a" },
      { id: "p2", definitionId: "order:2:b" },
    ])
    expect(port.calls.map((call) => call.input.query)).toStrictEqual([
      {
        withIncident: "true",
        processDefinitionId: "order:1:a",
        processDefinitionKey: "order",
        businessKey: "B-1",
        sortBy: "instanceId",
        sortOrder: "asc",
        firstResult: "0",
        maxResults: String(PAGE),
      },
    ])
  })

  it("reads the whole engine when the scope names nothing, every page of it", async () => {
    const all = Array.from({ length: PAGE + 2 }, (_, at) => instance(`p${at}`))
    const port = fakePort({
      getProcessInstances: ({ query }) =>
        all.slice(Number(query.firstResult), Number(query.firstResult) + Number(query.maxResults)),
    })

    const found = await instancesWithIncident(port, {})

    expect(found).toHaveLength(PAGE + 2)
    expect(port.calls.map((call) => call.input.query)).toStrictEqual([
      {
        ...WITH_INCIDENT,
        sortBy: "instanceId",
        sortOrder: "asc",
        firstResult: "0",
        maxResults: "500",
      },
      {
        ...WITH_INCIDENT,
        sortBy: "instanceId",
        sortOrder: "asc",
        firstResult: "500",
        maxResults: "500",
      },
    ])
  })

  it("keeps each instance once and drops a row without its id or its version", async () => {
    const port = fakePort({
      getProcessInstances: () => [
        instance("p1"),
        instance("p1"),
        { id: "p2" },
        { definitionId: "order:1:a" },
        { id: "", definitionId: "order:1:a" },
        instance("p3", "order:2:b"),
      ],
    })

    expect(await instancesWithIncident(port, {})).toEqual([
      { id: "p1", definitionId: "order:1:a" },
      { id: "p3", definitionId: "order:2:b" },
    ])
  })
})

describe("countWithIncident", () => {
  it("counts the scope's instances with an open incident in one request", async () => {
    const port = fakePort({ getProcessInstancesCount: () => ({ count: 6 }) })

    expect(
      await countWithIncident(port, { processDefinitionKey: "order", businessKey: "B-1" }),
    ).toBe(6)
    expect(port.calls).toStrictEqual([
      {
        operationId: "getProcessInstancesCount",
        input: {
          pathArgs: [],
          query: { withIncident: "true", processDefinitionKey: "order", businessKey: "B-1" },
        },
      },
    ])
  })

  it("asks the whole engine with the filter alone and reads an answer without a count as 0", async () => {
    const port = fakePort({ getProcessInstancesCount: () => ({}) })

    expect(await countWithIncident(port, {})).toBe(0)
    expect(port.calls[0]?.input.query).toStrictEqual({ withIncident: "true" })
  })
})

describe("withIncidentAmong", () => {
  it("asks for nothing without ids", async () => {
    const port = fakePort({})

    expect(await withIncidentAmong(port, [])).toEqual(new Set())
    expect(port.calls).toEqual([])
  })

  it("flags the ids the runtime holds an open incident for, 50 ids per request", async () => {
    const ids = Array.from({ length: 120 }, (_, at) => `p${at}`)
    const failing = new Set(["p3", "p77", "p119"])
    const port = fakePort({
      getProcessInstances: ({ query }) =>
        (query.processInstanceIds ?? "")
          .split(",")
          .filter((id) => failing.has(id))
          .map((id) => instance(id)),
    })

    expect(await withIncidentAmong(port, ids)).toEqual(failing)
    expect(
      port.calls.map((call) => call.input.query.processInstanceIds?.split(",").length),
    ).toEqual([50, 50, 20])
    for (const call of port.calls) {
      expect(call.operationId).toBe("getProcessInstances")
      expect(call.input.query.withIncident).toBe("true")
    }
  })

  it("ignores a row without an id", async () => {
    const port = fakePort({
      getProcessInstances: () => [{ definitionId: "order:1:a" }, instance("p1")],
    })

    expect(await withIncidentAmong(port, ["p1", "p2"])).toEqual(new Set(["p1"]))
  })
})

describe("withIncidentByVersion", () => {
  it("counts the instances with an open incident per version", () => {
    expect(
      withIncidentByVersion([
        { id: "p1", definitionId: "order:1:a" },
        { id: "p2", definitionId: "order:2:b" },
        { id: "p3", definitionId: "order:1:a" },
      ]),
    ).toEqual(
      new Map([
        ["order:1:a", 2],
        ["order:2:b", 1],
      ]),
    )
    expect(withIncidentByVersion([])).toEqual(new Map())
  })
})

describe("unrecordedIncidents", () => {
  it("names the runtime's open incidents when the history holds none of them", async () => {
    const port = fakePort({
      getIncidentsCount: () => ({ count: 7 }),
      getHistoricIncidents: () => [],
    })

    expect(await unrecordedIncidents(port)).toBe(7)
    expect(port.calls.map(({ operationId, input }) => [operationId, input.query])).toStrictEqual([
      ["getIncidentsCount", {}],
      ["getHistoricIncidents", { open: "true", firstResult: "0", maxResults: "2" }],
    ])
  })

  it("is 0 when the history holds an open incident, whatever the runtime counts", async () => {
    const port = fakePort({
      getIncidentsCount: () => ({ count: 7 }),
      getHistoricIncidents: () => [{ id: "i1" }],
    })

    expect(await unrecordedIncidents(port)).toBe(0)
  })

  it("is 0 while the runtime holds no open incident", async () => {
    const port = fakePort({
      getIncidentsCount: () => ({ count: 0 }),
      getHistoricIncidents: () => [],
    })

    expect(await unrecordedIncidents(port)).toBe(0)
  })
})
