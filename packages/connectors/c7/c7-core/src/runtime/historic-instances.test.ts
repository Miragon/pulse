import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakePort, type Route } from "../testing/fake-port.js"
import {
  countHistoricInstances,
  instanceSummaryOf,
  readHistoricInstances,
} from "./historic-instances.js"

const REQUIRED = {
  id: "p1",
  processDefinitionId: "order:1:a",
  processDefinitionKey: "order",
  processDefinitionVersion: 1,
  state: "ACTIVE",
}
const FULL = {
  ...REQUIRED,
  businessKey: "ORD-1",
  processDefinitionName: "Order",
  startTime: "2026-10-21T18:44:04.496+0000",
  endTime: "2026-10-21T18:45:04.496+0200",
  superProcessInstanceId: "parent-1",
}

async function rejection(read: Promise<unknown>): Promise<unknown> {
  return read.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe("readHistoricInstances", () => {
  it("sends the query in the body, newest first, and the window as the engine's paging", async () => {
    const port = fakePort({ queryHistoricProcessInstances: () => [] })
    await readHistoricInstances(
      port,
      { processDefinitionKey: "order", unfinished: true },
      { firstResult: 10, maxResults: 6 },
    )
    expect(port.calls).toHaveLength(1)
    const [call] = port.calls
    expect(call?.operationId).toBe("queryHistoricProcessInstances")
    expect(call?.input.pathArgs).toStrictEqual([])
    expect(call?.input.query).toStrictEqual({ firstResult: "10", maxResults: "6" })
    expect(Object.keys(call?.input.query ?? {})).toStrictEqual(["firstResult", "maxResults"])
    expect(JSON.stringify(call?.input.body)).toBe(
      '{"processDefinitionKey":"order","unfinished":true,"sorting":[{"sortBy":"startTime","sortOrder":"desc"},{"sortBy":"instanceId","sortOrder":"asc"}]}',
    )
  })

  it("reads every field of a row and leaves out what the engine did not name", async () => {
    const port = fakePort({
      queryHistoricProcessInstances: () => [
        { ...FULL, deleteReason: null },
        { ...REQUIRED, businessKey: null, endTime: null },
      ],
    })
    expect(await readHistoricInstances(port, {}, { firstResult: 0, maxResults: 2 })).toStrictEqual([
      FULL,
      REQUIRED,
    ])
  })

  it.each([
    ["no list", { id: "p1" }, "historic process instances is not a list"],
    ["a row that is no object", ["p1"], "historic process instances[0] is not an object"],
    ["a row without its id", [{ ...REQUIRED, id: null }], "id is missing"],
    [
      "a row without its version",
      [{ ...REQUIRED, processDefinitionId: undefined }],
      "processDefinitionId is missing",
    ],
    [
      "a row without its key",
      [{ ...REQUIRED, processDefinitionKey: null }],
      "processDefinitionKey is missing",
    ],
    [
      "a version that is no number",
      [{ ...REQUIRED, processDefinitionVersion: "1" }],
      "processDefinitionVersion is not a number",
    ],
    ["a row without its state", [{ ...REQUIRED, state: undefined }], "state is missing"],
    [
      "a business key that is no text",
      [{ ...REQUIRED, businessKey: 1 }],
      "businessKey is not a string",
    ],
    [
      "a name that is no text",
      [{ ...REQUIRED, processDefinitionName: 1 }],
      "processDefinitionName is not a string",
    ],
    ["a start that is no text", [{ ...REQUIRED, startTime: 1 }], "startTime is not a string"],
    ["an end that is no text", [{ ...REQUIRED, endTime: 1 }], "endTime is not a string"],
    [
      "a parent that is no text",
      [{ ...REQUIRED, superProcessInstanceId: 1 }],
      "superProcessInstanceId is not a string",
    ],
  ])("fails %s as an answer it cannot use", async (_name, answer, message) => {
    const port = fakePort({ queryHistoricProcessInstances: () => answer })
    const error = await rejection(
      readHistoricInstances(port, {}, { firstResult: 0, maxResults: 1 }),
    )
    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })
})

describe("countHistoricInstances", () => {
  it("sends the query as the body of the count, without paging", async () => {
    const port = fakePort({ queryHistoricProcessInstancesCount: () => ({ count: 7 }) })
    expect(await countHistoricInstances(port, { finished: true })).toBe(7)
    expect(port.calls).toStrictEqual([
      {
        operationId: "queryHistoricProcessInstancesCount",
        input: { pathArgs: [], query: {}, body: { finished: true } },
      },
    ])
  })

  it.each([
    ["no object", [], "historic process instance count is not an object"],
    ["no number", { count: "many" }, "count is not a number"],
    ["no count", {}, "count is missing"],
  ])("fails an answer with %s", async (_name, answer, message) => {
    const port = fakePort({ queryHistoricProcessInstancesCount: () => answer })
    const error = await rejection(countHistoricInstances(port, {}))
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })
})

/** The history of `rows` (newest first): a request's ids, newest first, its window of them. */
function historyOf(rows: readonly { readonly id: string }[]): Route {
  return (input) => {
    const { processInstanceIds } = input.body as { readonly processInstanceIds: string[] }
    const first = Number(input.query.firstResult)
    return rows
      .filter((row) => processInstanceIds.includes(row.id))
      .slice(first, first + Number(input.query.maxResults))
  }
}

function idsSent(calls: readonly FakeCall[]): unknown[] {
  return calls.map(
    (call) => (call.input.body as { processInstanceIds?: unknown }).processInstanceIds,
  )
}

function rowAt(id: string, second: number) {
  return { ...REQUIRED, id, startTime: `2026-10-21T18:44:0${String(second)}.000+0000` }
}

describe("the history's instances over more ids than one request carries", () => {
  const newestFirst = [rowAt("p4", 9), rowAt("p1", 8), rowAt("p5", 7), rowAt("p2", 6)]
  const ids = ["p1", "p2", "p3", "p4", "p5"]

  it("reads each chunk's rows up to the window's end and merges them newest first", async () => {
    const port = fakePort({ queryHistoricProcessInstances: historyOf(newestFirst) })

    const rows = await readHistoricInstances(
      port,
      { unfinished: true, processInstanceIds: ids },
      { firstResult: 1, maxResults: 2 },
      2,
    )

    expect(rows.map((row) => row.id)).toStrictEqual(["p1", "p5"])
    expect(idsSent(port.calls)).toStrictEqual([["p1", "p2"], ["p3", "p4"], ["p5"]])
    expect(port.calls.map((call) => call.input.query)).toStrictEqual(
      Array.from({ length: 3 }, () => ({ firstResult: "0", maxResults: "2" })),
    )
    expect(JSON.stringify(port.calls[2]?.input.body)).toBe(
      '{"unfinished":true,"processInstanceIds":["p5"],"sorting":[{"sortBy":"startTime","sortOrder":"desc"},{"sortBy":"instanceId","sortOrder":"asc"}]}',
    )
  })

  it("asks a chunk for the rows up to the window's end where they are fewer than its ids", async () => {
    const port = fakePort({ queryHistoricProcessInstances: historyOf(newestFirst) })

    const rows = await readHistoricInstances(
      port,
      { processInstanceIds: ids },
      { firstResult: 0, maxResults: 2 },
      3,
    )

    expect(rows.map((row) => row.id)).toStrictEqual(["p4", "p1"])
    expect(port.calls.map((call) => call.input.query.maxResults)).toStrictEqual(["2", "2"])
  })

  it("sends a window as it is while the query names no more ids than a chunk holds", async () => {
    const port = fakePort({ queryHistoricProcessInstances: () => [] })

    await readHistoricInstances(
      port,
      { processInstanceIds: ids },
      { firstResult: 3, maxResults: 2 },
      5,
    )
    await readHistoricInstances(
      port,
      { processInstanceIds: Array.from({ length: 500 }, (_, index) => `p${String(index)}`) },
      { firstResult: 3, maxResults: 2 },
    )

    expect(port.calls.map((call) => call.input.query)).toStrictEqual([
      { firstResult: "3", maxResults: "2" },
      { firstResult: "3", maxResults: "2" },
    ])
  })

  it("sends at most 500 ids per request by default", async () => {
    const many = Array.from({ length: 1001 }, (_, index) => `p${String(index)}`)
    const read = fakePort({ queryHistoricProcessInstances: () => [] })
    const count = fakePort({ queryHistoricProcessInstancesCount: () => ({ count: 0 }) })

    await readHistoricInstances(
      read,
      { processInstanceIds: many },
      { firstResult: 0, maxResults: 51 },
    )
    await countHistoricInstances(count, { processInstanceIds: many })

    for (const port of [read, count]) {
      expect(idsSent(port.calls).map((sent) => (sent as string[]).length)).toStrictEqual([
        500, 500, 1,
      ])
    }
  })

  it("counts the sum of the chunks' counts, each with the rest of the query", async () => {
    const port = fakePort({
      queryHistoricProcessInstancesCount: (input) => ({
        count: (input.body as { processInstanceIds: string[] }).processInstanceIds.length,
      }),
    })

    expect(await countHistoricInstances(port, { finished: true, processInstanceIds: ids }, 2)).toBe(
      5,
    )
    expect(port.calls.map((call) => call.input)).toStrictEqual([
      { pathArgs: [], query: {}, body: { finished: true, processInstanceIds: ["p1", "p2"] } },
      { pathArgs: [], query: {}, body: { finished: true, processInstanceIds: ["p3", "p4"] } },
      { pathArgs: [], query: {}, body: { finished: true, processInstanceIds: ["p5"] } },
    ])
  })

  it("fails the count and the read when a chunk fails, never a smaller sum or a shorter page", async () => {
    const failing: Route = (input) => {
      const sent = (input.body as { processInstanceIds: string[] }).processInstanceIds
      if (sent.includes("p5")) throw new Error("the engine is gone")
      return input.query.firstResult === undefined ? { count: 2 } : []
    }
    const port = fakePort({
      queryHistoricProcessInstances: failing,
      queryHistoricProcessInstancesCount: failing,
    })

    await expect(countHistoricInstances(port, { processInstanceIds: ids }, 2)).rejects.toThrow(
      "the engine is gone",
    )
    await expect(
      readHistoricInstances(
        port,
        { processInstanceIds: ids },
        { firstResult: 0, maxResults: 5 },
        2,
      ),
    ).rejects.toThrow("the engine is gone")
  })
})

describe("instanceSummaryOf", () => {
  it("reads a row as the contract's instance with its version, state, key, times and parent", () => {
    expect(instanceSummaryOf(FULL, true)).toStrictEqual({
      id: "p1",
      definition: { id: "order:1:a", bpmnProcessId: "order", version: 1, name: "Order" },
      state: "running",
      hasIncident: true,
      businessKey: "ORD-1",
      startedAt: "2026-10-21T18:44:04.496Z",
      endedAt: "2026-10-21T16:45:04.496Z",
      parentInstanceId: "parent-1",
    })
  })

  it("leaves out what the row does not name", () => {
    expect(instanceSummaryOf({ ...REQUIRED, state: "COMPLETED" }, false)).toStrictEqual({
      id: "p1",
      definition: { id: "order:1:a", bpmnProcessId: "order", version: 1 },
      state: "completed",
      hasIncident: false,
    })
  })

  it("fails a state no engine of the family writes", () => {
    expect(() => instanceSummaryOf({ ...REQUIRED, state: "PAUSED" }, false)).toThrow(
      "Unknown process instance state PAUSED",
    )
  })
})
