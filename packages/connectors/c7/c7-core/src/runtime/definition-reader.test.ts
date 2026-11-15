import { BpmnProcessId, DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { DefinitionReader } from "./definition-reader.js"

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

/** Statistics in an order that is neither the versions' nor the keys': the reader sorts. */
const STATISTICS = [
  { definition: REVIEW_1, instances: 2 },
  { definition: INVOICE_1, instances: 5 },
  { definition: ORDER_1, instances: 0 },
  { definition: INVOICE_3, instances: 1 },
  { definition: INVOICE_2, instances: 7 },
]

/** Instances with an open incident: two on invoice 1, one on invoice 3, one on review 1. */
const WITH_INCIDENT = [
  { id: "p1", definitionId: INVOICE_1.id },
  { id: "p2", definitionId: INVOICE_1.id },
  { id: "p3", definitionId: INVOICE_3.id },
  { id: "p4", definitionId: REVIEW_1.id },
]

function readerOver(statistics: unknown = STATISTICS, failing: unknown = WITH_INCIDENT) {
  const port = fakePort({
    getProcessDefinitionStatistics: () => statistics,
    getProcessInstances: () => failing,
    getProcessDefinitionBpmn20Xml: () => ({ bpmn20Xml: "<definitions/>" }),
  })
  return { port, reader: new DefinitionReader(port) }
}

describe("DefinitionReader.list", () => {
  it("summarises each process by its latest version with the sums over its versions", async () => {
    const { reader } = readerOver()
    expect(await reader.list()).toStrictEqual([
      { latest: ref(INVOICE_3), running: 13, withIncident: 3 },
      { latest: ref(ORDER_1), running: 0, withIncident: 0 },
      { latest: ref(REVIEW_1), running: 2, withIncident: 1 },
    ])
  })

  it("orders the processes by their keys as localeCompare does, not by code unit", async () => {
    const { reader } = readerOver()
    const keys = (await reader.list()).map((summary) => summary.latest.bpmnProcessId)
    expect(keys).toEqual(["invoice", "order", "ReviewInvoice"].sort((a, b) => a.localeCompare(b)))
    expect(keys).not.toEqual(["invoice", "order", "ReviewInvoice"].sort())
  })

  it("reads the statistics and the instances with an open incident, every page", async () => {
    const { port, reader } = readerOver()
    await reader.list()
    expect(port.calls.map((call) => call.operationId)).toEqual([
      "getProcessDefinitionStatistics",
      "getProcessInstances",
    ])
    expect(port.calls[1]?.input.query).toEqual({
      withIncident: "true",
      sortBy: "instanceId",
      sortOrder: "asc",
      firstResult: "0",
      maxResults: "500",
    })
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
      { definition: ref(INVOICE_3), running: 1, withIncident: 1 },
      { definition: ref(INVOICE_2), running: 7, withIncident: 0 },
      { definition: ref(INVOICE_1), running: 5, withIncident: 2 },
    ])
  })

  it("has none for a process the engine does not hold", async () => {
    const { reader } = readerOver()
    expect(await reader.versions(BpmnProcessId("refund"))).toEqual([])
  })
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

describe("DefinitionReader.refsById", () => {
  it("names every deployed version by its id, from the statistics alone", async () => {
    const { port, reader } = readerOver()
    const refs = await reader.refsById()
    expect([...refs.entries()]).toStrictEqual(
      STATISTICS.map((row) => [row.definition.id, ref(row.definition)]),
    )
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitionStatistics"])
  })
})
