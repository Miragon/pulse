import { describe, expect, it } from "vitest"
import { countByIds, ID_CHUNK, listByIds, queryInput } from "./requests.js"
import { fakePort } from "./testing/fake-port.js"

const ids = Array.from({ length: ID_CHUNK * 2 + 1 }, (_, index) => `p${index}`)

describe("countByIds", () => {
  it("counts over id lists in chunks of 50 and sends nothing for no ids", async () => {
    const port = fakePort({ getProcessInstancesCount: () => ({ count: 2 }) })
    const request = { operationId: "getProcessInstancesCount", key: "processInstanceIds" }
    expect(await countByIds(port, { ...request, ids, query: { withIncident: "true" } })).toBe(6)
    expect(
      port.calls.map((call) => call.input.query.processInstanceIds?.split(",").length),
    ).toEqual([50, 50, 1])
    expect(port.calls.every((call) => call.input.query.withIncident === "true")).toBe(true)
    expect(await countByIds(port, { ...request, ids: [] })).toBe(0)
    expect(port.calls).toHaveLength(3)
  })
})

describe("listByIds", () => {
  it("lists over id lists, concatenates the chunks and caps each one", async () => {
    const port = fakePort({
      getTasks: (input) => [{ id: input.query.processInstanceIdIn?.split(",")[0] }],
    })
    const items = await listByIds(port, {
      operationId: "getTasks",
      key: "processInstanceIdIn",
      ids,
      cap: 5,
    })
    expect(items).toEqual([{ id: "p0" }, { id: "p50" }, { id: "p100" }])
    expect(port.calls[0]?.input.query.maxResults).toBe("6")
  })
})

describe("queryInput", () => {
  it("is a request without path arguments", () => {
    expect(queryInput({ a: "b" })).toEqual({ pathArgs: [], query: { a: "b" } })
  })
})
