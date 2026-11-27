import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { DefinitionReader } from "./definition-reader.js"
import type { WithIncidentCounting } from "./with-incident-per-version.js"

const REVIEW_1 = { id: "ReviewInvoice:1:r", key: "ReviewInvoice", version: 1, name: "Review" }
const INVOICE_1 = { id: "invoice:1:a", key: "invoice", version: 1, name: "Invoice" }
const INVOICE_2 = { id: "invoice:2:b", key: "invoice", version: 2, name: "Invoice v2" }
const INVOICE_3 = { id: "invoice:3:c", key: "invoice", version: 3 }
const ORDER_1 = { id: "order:1:o", key: "order", version: 1 }

const ref = (definition: { id: string; key: string; version: number; name?: string }) => ({
  id: definition.id,
  bpmnProcessId: definition.key,
  version: definition.version,
  ...(definition.name === undefined ? {} : { name: definition.name }),
})

const rootIncidents = (failedJobs: number, externalTasks = 0) => [
  { incidentType: "failedJob", incidentCount: failedJobs },
  ...(externalTasks === 0
    ? []
    : [{ incidentType: "failedExternalTask", incidentCount: externalTasks }]),
]

/**
 * Statistics in an order that is neither the versions' nor the keys': the reader sorts. The root
 * incidents per type, as the engine answers `rootIncidents=true`: invoice 1 holds three of two
 * types, invoice 3 one, review 1 none though an instance of it has an incident (it waits for one in
 * an instance it called, whose copy is no root incident).
 */
const STATISTICS = [
  { definition: REVIEW_1, instances: 2, incidents: [] },
  { definition: INVOICE_1, instances: 5, incidents: rootIncidents(2, 1) },
  { definition: ORDER_1, instances: 0, incidents: [] },
  { definition: INVOICE_3, instances: 1, incidents: rootIncidents(1) },
  { definition: INVOICE_2, instances: 7, incidents: [] },
]

/** Instances with an open incident: two on invoice 1, one on invoice 3, one on review 1. */
const WITH_INCIDENT = [
  { id: "p1", definitionId: INVOICE_1.id },
  { id: "p2", definitionId: INVOICE_1.id },
  { id: "p3", definitionId: INVOICE_3.id },
  { id: "p4", definitionId: REVIEW_1.id },
]

const KEY_OF = new Map(STATISTICS.map(({ definition }) => [definition.id, definition.key]))

/** The instances with an open incident of a query's process (all without one), as it pages them. */
function withIncidentOf(failing: readonly { id: string; definitionId: string }[]): Route {
  return ({ query }) => {
    const rows = failing.filter(
      (row) =>
        query.processDefinitionKey === undefined ||
        KEY_OF.get(row.definitionId) === query.processDefinitionKey,
    )
    const first = Number(query.firstResult ?? 0)
    return rows.slice(first, first + Number(query.maxResults ?? rows.length))
  }
}

/** The count of the instances with an open incident of a version, of a process or of the engine. */
const countOf: Route = ({ query }) => ({
  count: WITH_INCIDENT.filter(
    (row) =>
      (query.processDefinitionId ?? row.definitionId) === row.definitionId &&
      (query.processDefinitionKey ?? KEY_OF.get(row.definitionId)) === KEY_OF.get(row.definitionId),
  ).length,
})

function readerOver(
  statistics: unknown = STATISTICS,
  failing: readonly { id: string; definitionId: string }[] = WITH_INCIDENT,
  counting?: WithIncidentCounting,
) {
  const port = fakePort({
    getProcessDefinitionStatistics: () => statistics,
    getProcessInstances: withIncidentOf(failing),
    getProcessInstancesCount: countOf,
    getProcessDefinitionBpmn20Xml: () => ({ bpmn20Xml: "<definitions/>" }),
    getProcessDefinitions: ({ query }) =>
      STATISTICS.map((row) => row.definition).filter((definition) =>
        (query.processDefinitionIdIn ?? "").split(",").includes(definition.id),
      ),
  })
  return { port, reader: new DefinitionReader(port, undefined, counting) }
}

/** The versions each count of the instances with an open incident of one version asked for. */
function countedVersions(port: { readonly calls: readonly FakeCall[] }): (string | undefined)[] {
  return port.calls
    .filter((call) => call.operationId === "getProcessInstancesCount")
    .flatMap((call) => call.input.query.processDefinitionId ?? [])
}

describe("DefinitionReader.list", () => {
  it("summarises each process by its latest version with the sums over its versions", async () => {
    const { reader } = readerOver()
    expect(await reader.list()).toStrictEqual([
      { latest: ref(INVOICE_3), running: 13, withIncident: 3, incidents: 4 },
      { latest: ref(ORDER_1), running: 0, withIncident: 0, incidents: 0 },
      { latest: ref(REVIEW_1), running: 2, withIncident: 1, incidents: 0 },
    ])
  })

  it("orders the processes by their keys as localeCompare does, not by code unit", async () => {
    const { reader } = readerOver()
    const keys = (await reader.list()).map((summary) => summary.latest.bpmnProcessId)
    expect(keys).toEqual(["invoice", "order", "ReviewInvoice"].sort((a, b) => a.localeCompare(b)))
    expect(keys).not.toEqual(["invoice", "order", "ReviewInvoice"].sort())
  })

  it("reads the statistics with their root incidents and one page of the instances with an open incident", async () => {
    const { port, reader } = readerOver()
    await reader.list()
    expect(port.calls.map((call) => call.operationId)).toEqual([
      "getProcessDefinitionStatistics",
      "getProcessInstances",
    ])
    expect(port.calls[0]?.input.query).toEqual({ rootIncidents: "true" })
    expect(port.calls[1]?.input.query).toEqual({
      withIncident: "true",
      sortBy: "instanceId",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
  })

  it("counts each version that runs an instance on its own past a full page where it is told to", async () => {
    const { port, reader } = readerOver(STATISTICS, WITH_INCIDENT, {
      pageSize: 3,
      path: "perVersion",
    })

    expect(await reader.list()).toStrictEqual(await readerOver().reader.list())
    expect(port.calls.filter((call) => call.operationId === "getProcessInstances")).toHaveLength(1)
    expect(port.calls[1]?.input.query).toMatchObject({ firstResult: "0", maxResults: "3" })
    expect(port.calls[2]?.input.query).toStrictEqual({ withIncident: "true" })
    // ORDER_1 runs no instance, so none of its instances can hold an incident.
    expect(countedVersions(port).sort()).toEqual(
      [REVIEW_1.id, INVOICE_1.id, INVOICE_3.id, INVOICE_2.id].sort(),
    )
  })

  it("has no processes on an engine without deployments", async () => {
    const { reader } = readerOver([], [])
    expect(await reader.list()).toEqual([])
  })
})

describe("DefinitionReader.versions", () => {
  it("lists the versions of one process newest first, each with its own counts", async () => {
    const { reader } = readerOver()
    expect(await reader.versions(BpmnProcessId("invoice"))).toStrictEqual([
      { definition: ref(INVOICE_3), running: 1, withIncident: 1, incidents: 1 },
      { definition: ref(INVOICE_2), running: 7, withIncident: 0, incidents: 0 },
      { definition: ref(INVOICE_1), running: 5, withIncident: 2, incidents: 3 },
    ])
  })

  it("lists the process's instances with an open incident alone", async () => {
    const { port, reader } = readerOver()
    await reader.versions(BpmnProcessId("invoice"))
    expect(port.calls.map((call) => call.operationId)).toEqual([
      "getProcessDefinitionStatistics",
      "getProcessInstances",
    ])
    expect(port.calls[1]?.input.query).toMatchObject({
      withIncident: "true",
      processDefinitionKey: "invoice",
    })
  })

  it("counts the process's versions that run an instance past a full page where it is told to", async () => {
    const { port, reader } = readerOver(STATISTICS, WITH_INCIDENT, {
      pageSize: 2,
      path: "perVersion",
    })

    expect(await reader.versions(BpmnProcessId("invoice"))).toStrictEqual(
      await readerOver().reader.versions(BpmnProcessId("invoice")),
    )
    expect(countedVersions(port).sort()).toEqual([INVOICE_1.id, INVOICE_3.id, INVOICE_2.id].sort())
  })

  it("has none for a process the engine does not hold", async () => {
    const { reader } = readerOver()
    expect(await reader.versions(BpmnProcessId("refund"))).toEqual([])
  })
})

/**
 * An engine with `versions` versions of `order` that each run an instance, and `failing` instances
 * with an open incident over them, round and round, listed by id and counted by version or scope.
 */
function engineWith(versions: number, failing: number) {
  const definitions = Array.from({ length: versions }, (_, at) => ({
    id: `order:${String(at + 1)}:x`,
    key: "order",
    version: at + 1,
  }))
  const rows = Array.from({ length: failing }, (_, at) => ({
    id: `p${String(at).padStart(5, "0")}`,
    definitionId: definitions[at % versions]?.id ?? "",
  }))
  const on = (id: string | undefined) =>
    rows.filter((row) => id === undefined || row.definitionId === id)
  const port = fakePort({
    getProcessDefinitionStatistics: () =>
      definitions.map((definition) => ({
        definition,
        instances: on(definition.id).length + 1,
        incidents: [],
      })),
    getProcessInstances: ({ query }) => {
      const first = Number(query.firstResult)
      return rows.slice(first, first + Number(query.maxResults))
    },
    getProcessInstancesCount: ({ query }) => ({ count: on(query.processDefinitionId).length }),
  })
  return { port, reader: new DefinitionReader(port) }
}

/** What each request asked: the statistics, a page of the listing from its first row, a count. */
function requestsOf(port: { readonly calls: readonly FakeCall[] }): string[] {
  return port.calls.map(({ operationId, input: { query } }) => {
    if (operationId === "getProcessInstances") return `page from ${query.firstResult ?? "?"}`
    if (operationId === "getProcessInstancesCount") {
      return query.processDefinitionId === undefined ? "count" : "count of a version"
    }
    return operationId
  })
}

/** The requests in `requests` and how many of each, in the order each first came. */
function tally(requests: readonly string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const request of requests) counts.set(request, (counts.get(request) ?? 0) + 1)
  return [...counts]
}

describe("DefinitionReader's requests past a page of instances with an incident", () => {
  it("reads the page left where 1,000 versions run an instance and 501 instances hold an incident", async () => {
    const { port, reader } = engineWith(1000, 501)

    const [order] = await reader.list()

    expect(order?.withIncident).toBe(501)
    expect(requestsOf(port)).toEqual([
      "getProcessDefinitionStatistics",
      "page from 0",
      "count",
      "page from 500",
    ])
  })

  it("counts each version where 2 run an instance and 2,600 instances hold an incident", async () => {
    const { port, reader } = engineWith(2, 2600)

    const versions = await reader.versions(BpmnProcessId("order"))

    expect(versions.map((version) => version.withIncident)).toEqual([1300, 1300])
    expect(requestsOf(port)).toEqual([
      "getProcessDefinitionStatistics",
      "page from 0",
      "count",
      "count of a version",
      "count of a version",
    ])
    expect(port.calls[2]?.input.query).toStrictEqual({
      withIncident: "true",
      processDefinitionKey: "order",
    })
  })

  it.each([
    [1, 1250, [["count of a version", 1]]],
    [
      2,
      1250,
      [
        ["page from 500", 1],
        ["page from 1000", 1],
      ],
    ],
    [
      3,
      1250,
      [
        ["page from 500", 1],
        ["page from 1000", 1],
      ],
    ],
    [1, 1000, [["count of a version", 1]]],
    [
      2,
      1000,
      [
        ["page from 500", 1],
        ["page from 1000", 1],
      ],
    ],
  ] as const)(
    "where %i versions run an instance and %i instances hold an incident, takes the path of fewer requests, the listing where both send as many",
    async (versions, failing, past) => {
      const { port, reader } = engineWith(versions, failing)

      const summaries = await reader.list()

      expect(summaries.map((summary) => summary.withIncident)).toEqual([failing])
      expect(tally(requestsOf(port))).toEqual([
        ["getProcessDefinitionStatistics", 1],
        ["page from 0", 1],
        ["count", 1],
        ...past,
      ])
    },
  )
})

describe("DefinitionReader.diagramXml", () => {
  it("reads the XML of a version", async () => {
    const { port, reader } = readerOver()
    expect(await reader.diagramXml(DefinitionId(ORDER_1.id))).toBe("<definitions/>")
    expect(port.calls).toEqual([
      {
        operationId: "getProcessDefinitionBpmn20Xml",
        input: { pathArgs: [ORDER_1.id], query: {} },
      },
    ])
  })

  it("is undefined for a version the engine does not know", async () => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
    })
    expect(await new DefinitionReader(port).diagramXml(DefinitionId("nope:1:x"))).toBeUndefined()
  })
})

describe("DefinitionReader.refsOf", () => {
  it("names the versions it is asked for by their ids, read by those ids alone", async () => {
    const { port, reader } = readerOver()
    const refs = await reader.refsOf([INVOICE_2.id, REVIEW_1.id, INVOICE_2.id, "gone:1:x"])
    expect(refs).toStrictEqual(
      new Map([
        [REVIEW_1.id, ref(REVIEW_1)],
        [INVOICE_2.id, ref(INVOICE_2)],
      ]),
    )
    expect(port.calls).toStrictEqual([
      {
        operationId: "getProcessDefinitions",
        input: {
          pathArgs: [],
          query: {
            processDefinitionIdIn: `${INVOICE_2.id},${REVIEW_1.id},gone:1:x`,
            sortBy: "id",
            sortOrder: "asc",
            firstResult: "0",
            maxResults: "500",
          },
        },
      },
    ])
  })

  it("asks for nothing without ids, and for no id an engine never assigns", async () => {
    const { port, reader } = readerOver()
    expect(await reader.refsOf([])).toStrictEqual(new Map())
    expect(await reader.refsOf(["order 1", "a,b"])).toStrictEqual(new Map())
    expect(port.calls).toStrictEqual([])
  })

  it("fails a version it cannot read, never leaving it out", async () => {
    const port = fakePort({ getProcessDefinitions: () => [{ id: INVOICE_1.id }] })
    await expect(new DefinitionReader(port).refsOf([INVOICE_1.id])).rejects.toMatchObject({
      failure: "unexpectedResponse",
    })
  })
})
