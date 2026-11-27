import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import type { OperationInput } from "../port.js"
import { readAll, readFrom, readPage } from "./read-all.js"

const rows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `i${String(from + index)}` }))

/** A port that answers the pages of `pages` in turn, and what it was asked. */
function pagedPort(...pages: unknown[]) {
  const answers = [...pages]
  return fakePort({ getIncidents: () => answers.shift() })
}

const queryOf = (input: OperationInput | undefined) => input?.query

describe("readAll", () => {
  it("reads one page that holds fewer rows than a page", async () => {
    const port = pagedPort(rows(2))
    expect(await readAll(port, "getIncidents", { processDefinitionId: "order:1:x" })).toEqual(
      rows(2),
    )
    expect(port.calls.map((call) => call.input)).toEqual([
      {
        pathArgs: [],
        query: { processDefinitionId: "order:1:x", firstResult: "0", maxResults: "500" },
      },
    ])
  })

  it("asks for the page after the query's own values, firstResult before maxResults", async () => {
    const port = pagedPort([])
    await readAll(port, "getIncidents", { sortBy: "incidentTimestamp", sortOrder: "desc" })
    expect(Object.keys(queryOf(port.calls[0]?.input) ?? {})).toEqual([
      "sortBy",
      "sortOrder",
      "firstResult",
      "maxResults",
    ])
  })

  it("reads page after page until a page holds fewer than 500 rows", async () => {
    const port = pagedPort(rows(500), rows(500, 500), rows(1, 1000))
    const all = await readAll(port, "getIncidents", {})
    expect(all).toEqual(rows(1001))
    expect(port.calls.map((call) => queryOf(call.input))).toEqual([
      { firstResult: "0", maxResults: "500" },
      { firstResult: "500", maxResults: "500" },
      { firstResult: "1000", maxResults: "500" },
    ])
  })

  it("sends a body with every page as it is, and none without one", async () => {
    const answers = [rows(500), rows(1, 500)]
    const port = fakePort({ queryHistoricActivityInstances: () => answers.shift() })
    const body = { processInstanceId: "p1", sorting: [{ sortBy: "startTime", sortOrder: "asc" }] }
    expect(await readAll(port, "queryHistoricActivityInstances", {}, body)).toEqual(rows(501))
    expect(port.calls.map((call) => call.input)).toEqual([
      { pathArgs: [], query: { firstResult: "0", maxResults: "500" }, body },
      { pathArgs: [], query: { firstResult: "500", maxResults: "500" }, body },
    ])
    const bodiless = pagedPort([])
    await readAll(bodiless, "getIncidents", {})
    expect(bodiless.calls[0]?.input).not.toHaveProperty("body")
  })

  it("reads one more page after a full one, even when it is empty", async () => {
    const port = pagedPort(rows(500), [])
    expect(await readAll(port, "getIncidents", {})).toHaveLength(500)
    expect(port.calls).toHaveLength(2)
  })

  it("leaves the rows as the engine sent them, for the caller to check", async () => {
    expect(await readAll(pagedPort([1, "a", null]), "getIncidents", {})).toEqual([1, "a", null])
  })

  it.each([
    ["an object", { id: "i1" }],
    ["an empty answer", undefined],
    ["a text", "[]"],
  ])("fails %s as no list, in words that name the path", async (_kind, answer) => {
    const failure = readAll(pagedPort(answer), "getIncidents", {})
    await expect(failure).rejects.toBeInstanceOf(RuntimeError)
    await expect(failure).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "/incident is not a list",
    })
  })

  it("fails a later page that is no list", async () => {
    await expect(readAll(pagedPort(rows(500), {}), "getIncidents", {})).rejects.toMatchObject({
      message: "/incident is not a list",
    })
  })

  it("names an operation no route of c7-core holds by its id", async () => {
    const port = fakePort({ getSomething: () => ({}) })
    await expect(readAll(port, "getSomething", {})).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "getSomething is not a list",
    })
  })

  it("rejects with the port's failure as it is", async () => {
    const failure = fakeFailure(401)
    const port = fakePort({
      getIncidents: () => {
        throw failure
      },
    })
    await expect(readAll(port, "getIncidents", {})).rejects.toBe(failure)
  })
})

describe("readPage", () => {
  it("reads one page in its window, even a full one, with the body as it is", async () => {
    const port = pagedPort(rows(2))
    const read = { operationId: "getIncidents", query: { sortBy: "id" }, body: { a: 1 } }
    expect(await readPage(port, read, { firstResult: 4, maxResults: 2 })).toEqual(rows(2))
    expect(port.calls.map((call) => call.input)).toEqual([
      {
        pathArgs: [],
        query: { sortBy: "id", firstResult: "4", maxResults: "2" },
        body: { a: 1 },
      },
    ])
  })

  it("fails an answer that is no list", async () => {
    const read = { operationId: "getIncidents", query: {} }
    await expect(
      readPage(pagedPort({}), read, { firstResult: 0, maxResults: 2 }),
    ).rejects.toMatchObject({ failure: "unexpectedResponse", message: "/incident is not a list" })
  })
})

describe("readFrom", () => {
  it("reads on from a row in pages of the window's size until one holds fewer", async () => {
    const port = pagedPort(rows(2, 2), rows(2, 4), rows(1, 6))
    const read = { operationId: "getIncidents", query: {} }
    expect(await readFrom(port, read, { firstResult: 2, maxResults: 2 })).toEqual(rows(5, 2))
    expect(port.calls.map((call) => queryOf(call.input))).toEqual([
      { firstResult: "2", maxResults: "2" },
      { firstResult: "4", maxResults: "2" },
      { firstResult: "6", maxResults: "2" },
    ])
    expect(port.calls[0]?.input).not.toHaveProperty("body")
  })
})
