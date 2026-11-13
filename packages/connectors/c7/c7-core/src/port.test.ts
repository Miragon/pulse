import { describe, expect, it } from "vitest"
import {
  createEnginePort,
  type EngineFailure,
  type EngineTransport,
  failureOf,
  isMissing,
  isUnknownEndpoint,
  type OperationInput,
  pageQuery,
  Slots,
} from "./port.js"

class Failed extends Error {
  constructor(readonly failure: EngineFailure) {
    super(`HTTP ${failure.status}`)
  }
}

interface Answer {
  readonly json?: unknown
  readonly text?: string
}

/** A transport whose answers come from `answer`; it records the inputs. */
function transport(answer: (operationId: string, input: OperationInput) => Answer) {
  const inputs: OperationInput[] = []
  const fake: EngineTransport<Answer> & { inputs: OperationInput[] } = {
    inputs,
    send(operationId, input) {
      inputs.push(input)
      try {
        return Promise.resolve(answer(operationId, input))
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)))
      }
    },
    json: (value) => value.json,
    text: (value) => value.text,
    failure: (error) => (error instanceof Failed ? error.failure : undefined),
  }
  return fake
}

const NO_INPUT = { pathArgs: [], query: {} }

describe("failureOf", () => {
  it("carries the status and the exception type, message and code the body states", () => {
    const problem = { type: "InvalidRequestException", message: "No job j1", code: 7 }
    expect(failureOf(400, problem)).toStrictEqual({
      status: 400,
      engineType: "InvalidRequestException",
      engineMessage: "No job j1",
      engineCode: 7,
    })
  })

  it("carries only what the body states, so a page without an exception stays an unknown endpoint", () => {
    expect(failureOf(404, undefined)).toStrictEqual({ status: 404 })
    expect(failureOf(502, {})).toStrictEqual({ status: 502 })
    expect(failureOf(500, { message: "boom" })).toStrictEqual({
      status: 500,
      engineMessage: "boom",
    })
    expect(failureOf(404, { type: "NullValueException", code: 0 })).toStrictEqual({
      status: 404,
      engineType: "NullValueException",
      engineCode: 0,
    })
    expect(isUnknownEndpoint(failureOf(404, { message: "Not Found" }))).toBe(true)
    expect(isMissing(failureOf(404, { type: "InvalidRequestException" }))).toBe(true)
  })
})

describe("isMissing", () => {
  it("is true only for an engine 404 that names a missing resource", () => {
    expect(isMissing({ status: 404, engineType: "InvalidRequestException" })).toBe(true)
    expect(isMissing({ status: 404, engineType: "NotFoundException" })).toBe(false)
    expect(isMissing({ status: 404, engineType: "QueryParamException" })).toBe(false)
    expect(isMissing({ status: 404 })).toBe(false)
    expect(isMissing({ status: 500, engineType: "InvalidRequestException" })).toBe(false)
    expect(isMissing(undefined)).toBe(false)
  })
})

describe("isUnknownEndpoint", () => {
  it("is true only for a 404 that is no engine answer about a resource", () => {
    expect(isUnknownEndpoint({ status: 404 })).toBe(true)
    expect(isUnknownEndpoint({ status: 404, engineType: "NotFoundException" })).toBe(true)
    expect(isUnknownEndpoint({ status: 404, engineType: "InvalidRequestException" })).toBe(false)
    expect(isUnknownEndpoint({ status: 404, engineType: "QueryParamException" })).toBe(false)
    expect(isUnknownEndpoint({ status: 500 })).toBe(false)
    expect(isUnknownEndpoint({ status: 400, engineType: "NotFoundException" })).toBe(false)
    expect(isUnknownEndpoint(undefined)).toBe(false)
  })
})

describe("createEnginePort", () => {
  it("reads the JSON value and the failure of the transport", async () => {
    const port = createEnginePort(transport(() => ({ json: { id: "p1" } })))
    expect(await port.json("getProcessInstance", NO_INPUT)).toEqual({ id: "p1" })
    const failure = { status: 500, engineType: "X" }
    expect(port.failure(new Failed(failure))).toEqual(failure)
    expect(port.failure(new Error("offline"))).toBeUndefined()
  })

  it("finds a missing resource as undefined and rethrows every other error", async () => {
    const answers: Record<string, () => Answer> = {
      found: () => ({ json: { id: "p1" } }),
      missing: () => {
        throw new Failed({ status: 404, engineType: "InvalidRequestException" })
      },
      routing: () => {
        throw new Failed({ status: 404, engineType: "NotFoundException" })
      },
      query: () => {
        throw new Failed({ status: 404, engineType: "QueryParamException" })
      },
      offline: () => {
        throw new Error("offline")
      },
    }
    const port = createEnginePort(
      transport((_operationId, input) => answers[input.pathArgs[0] ?? ""]?.() ?? {}),
    )
    const find = (id: string) => port.find("getProcessInstance", { pathArgs: [id], query: {} })
    expect(await find("found")).toEqual({ id: "p1" })
    expect(await find("missing")).toBeUndefined()
    await expect(find("routing")).rejects.toThrow("HTTP 404")
    await expect(find("query")).rejects.toThrow("HTTP 404")
    await expect(find("offline")).rejects.toThrow("offline")
  })

  it("pages lists by 500, asks for one more than the cap and reports truncation", async () => {
    const items = Array.from({ length: 700 }, (_, index) => ({ id: `i${index}` }))
    const fake = transport((_operationId, input) => {
      const first = Number(input.query.firstResult)
      return { json: items.slice(first, first + Number(input.query.maxResults)) }
    })
    const port = createEnginePort(fake)
    const capped = await port.list("getIncidents", { a: "b" }, 600)
    expect(capped.items).toHaveLength(600)
    expect(capped.truncated).toBe(true)
    expect(fake.inputs.map((input) => input.query)).toEqual([
      { a: "b", firstResult: "0", maxResults: "500" },
      { a: "b", firstResult: "500", maxResults: "101" },
    ])
    const all = await port.list("getIncidents", {})
    expect(all).toMatchObject({ truncated: false })
    expect(all.items).toHaveLength(700)
  })

  it("stops paging at a short page and when the engine ignores the page size", async () => {
    const short = createEnginePort(transport(() => ({ json: [{ id: "a" }, "skipped"] })))
    expect(await short.list("getIncidents", {}, 10)).toEqual({
      items: [{ id: "a" }],
      truncated: false,
    })
    const ignoring = transport(() => ({ json: Array.from({ length: 3 }, () => ({})) }))
    await createEnginePort(ignoring).list("getIncidents", {}, 1)
    expect(ignoring.inputs).toHaveLength(1)
  })

  it("reads texts; missing, absent and blank texts are undefined", async () => {
    const texts: Record<string, () => Answer> = {
      trace: () => ({ text: "trace" }),
      blank: () => ({ text: "  \n" }),
      none: () => ({}),
      missing: () => {
        throw new Failed({ status: 404, engineType: "InvalidRequestException" })
      },
      broken: () => {
        throw new Failed({ status: 500 })
      },
    }
    const port = createEnginePort(
      transport((_operationId, input) => texts[input.pathArgs[0] ?? ""]?.() ?? {}),
    )
    const text = (id: string) => port.text("getStacktrace", [id])
    expect(await text("trace")).toBe("trace")
    expect([await text("blank"), await text("none"), await text("missing")]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    await expect(text("broken")).rejects.toThrow("HTTP 500")
  })

  it("is a plain object a caller can spread", () => {
    const port = { ...createEnginePort(transport(() => ({}))), extra: true }
    expect(Object.keys(port).sort()).toEqual(["extra", "failure", "find", "json", "list", "text"])
  })
})

describe("pageQuery", () => {
  it("adds the page to the query", () => {
    expect(pageQuery({ a: "b" }, 0, 500)).toEqual({ a: "b", firstResult: "0", maxResults: "500" })
  })
})

describe("Slots", () => {
  it("keeps at most `limit` holders and hands a released slot to the next waiter in order", async () => {
    const slots = new Slots(2)
    const order: string[] = []
    await slots.acquire()
    await slots.acquire()
    const waiting = ["c", "d"].map(async (name) => {
      await slots.acquire()
      order.push(name)
    })
    expect(order).toEqual([])
    slots.release()
    await waiting[0]
    expect(order).toEqual(["c"])
    slots.release()
    await waiting[1]
    expect(order).toEqual(["c", "d"])
    slots.release()
    slots.release()
    await slots.acquire()
    await slots.acquire()
    expect(order).toEqual(["c", "d"])
  })

  it("runs a function in a slot and frees the slot when it settles, a rejection included", async () => {
    const slots = new Slots(1)
    expect(await slots.run(() => Promise.resolve("done"))).toBe("done")
    await expect(slots.run(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom")
    let ran = false
    await slots.run(() => {
      ran = true
      return Promise.resolve()
    })
    expect(ran).toBe(true)
  })
})
