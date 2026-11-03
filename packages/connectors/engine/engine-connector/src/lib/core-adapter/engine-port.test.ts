import { afterEach, describe, expect, it } from "vitest"
import { EngineRequestError } from "@miragon/pulse-engine-client"
import { INSPECT_OPERATIONS, STATUS_OPERATIONS } from "@miragon/pulse-engine-core/testing"
import {
  clientFor,
  type FakeEngine,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { engineFailure, enginePortFor, READS } from "./engine-port.js"

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(...args: Parameters<typeof startFakeEngine>) {
  const engine = await startFakeEngine(...args)
  engines.push(engine)
  return engine
}

const NO_INPUT = { pathArgs: [], query: {} }

describe("READS", () => {
  it("maps exactly the operations engine-core's composites send", () => {
    expect(Object.keys(READS).sort()).toEqual(
      [...new Set([...INSPECT_OPERATIONS, ...STATUS_OPERATIONS])].sort(),
    )
  })
})

describe("enginePortFor", () => {
  it("refuses an operation it does not map and an operation without its id", async () => {
    const port = enginePortFor(clientFor(await engineWith()))
    await expect(port.json("getUsers", NO_INPUT)).rejects.toThrow(
      "engine-core asked for getUsers, which the engine port does not map",
    )
    await expect(port.json("getProcessInstance", NO_INPUT)).rejects.toThrow(
      "engine-core sent an operation without its id",
    )
  })

  it("reaches /version for getRestAPIVersion and sends the query as text", async () => {
    const engine = await engineWith({
      "GET /version": { body: { version: "2.1.0" } },
      "GET /incident": { body: [] },
    })
    const port = enginePortFor(clientFor(engine))
    expect(await port.json("getRestAPIVersion", NO_INPUT)).toEqual({ version: "2.1.0" })
    await port.list("getIncidents", { processDefinitionKeyIn: "a,b", sortBy: undefined }, 5)
    expect(engine.requests.map((request) => request.path)).toEqual(["/version", "/incident"])
    expect(engine.requests[1]?.query).toEqual({
      processDefinitionKeyIn: "a,b",
      firstResult: "0",
      maxResults: "6",
    })
  })

  it("reads a missing instance as undefined and a stacktrace as text", async () => {
    const engine = await engineWith({
      "GET /process-instance/gone": {
        status: 404,
        body: { type: "InvalidRequestException", message: "gone" },
      },
      "GET /job/j1/stacktrace": { body: "trace", contentType: "text/plain" },
    })
    const port = enginePortFor(clientFor(engine))
    expect(await port.find("getProcessInstance", { pathArgs: ["gone"], query: {} })).toBeUndefined()
    expect(await port.text("getStacktrace", ["j1"])).toBe("trace")
    expect(engine.requests[1]?.headers.accept).toBe("text/plain")
  })
})

describe("engineFailure", () => {
  it("reads an http failure and nothing else", () => {
    const http = new EngineRequestError("x", {
      kind: "http",
      httpStatus: 500,
      type: "NullValueException",
      engineMessage: "m",
    })
    expect(engineFailure(http)).toEqual({
      status: 500,
      engineType: "NullValueException",
      engineMessage: "m",
    })
    const plain = new EngineRequestError("x", { kind: "http", httpStatus: 503, engineMessage: "" })
    expect(engineFailure(plain)).toEqual({ status: 503, engineMessage: "" })
    const noStatus = new EngineRequestError("x", { kind: "http", engineMessage: "" })
    const down = new EngineRequestError("x", { kind: "unreachable", engineMessage: "" })
    expect([engineFailure(noStatus), engineFailure(down), engineFailure(new Error("x"))]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})
