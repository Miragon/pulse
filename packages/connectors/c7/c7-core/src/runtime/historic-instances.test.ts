import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
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
