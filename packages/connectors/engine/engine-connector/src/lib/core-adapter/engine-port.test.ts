import { afterEach, describe, expect, it } from "vitest"
import { EngineRequestError, fetchJobStacktrace } from "@miragon/pulse-c7-client"
import { isUnknownEndpoint } from "@miragon/pulse-c7-core"
import { INSPECT_OPERATIONS, STATUS_OPERATIONS } from "@miragon/pulse-c7-core/testing"
import {
  clientFor,
  type FakeEngine,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import {
  engineFailure,
  enginePortFor,
  isMissingResource,
  noneIfMissing,
  READS,
} from "./engine-port.js"

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
  it("maps exactly the operations c7-core's composites send", () => {
    expect(Object.keys(READS).sort()).toEqual(
      [...new Set([...INSPECT_OPERATIONS, ...STATUS_OPERATIONS])].sort(),
    )
  })
})

describe("enginePortFor", () => {
  it("refuses an operation it does not map and an operation without its id", async () => {
    const port = enginePortFor(clientFor(await engineWith()))
    await expect(port.json("getUsers", NO_INPUT)).rejects.toThrow(
      "c7-core asked for getUsers, which the engine port does not map",
    )
    await expect(port.json("getProcessInstance", NO_INPUT)).rejects.toThrow(
      "c7-core sent an operation without its id",
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

describe("a 404 of the port's text reads", () => {
  it("is none for a missing job and fails loud on a wrong REST root", async () => {
    const engine = await engineWith({
      "GET /job/gone/stacktrace": {
        status: 404,
        body: { type: "InvalidRequestException", message: "No job found with id gone" },
      },
      "GET /job/root/stacktrace": {
        status: 404,
        body: { type: "NotFoundException", message: "HTTP 404 Not Found" },
      },
      "GET /external-task/root/errorDetails": {
        status: 404,
        body: "<html>Not Found</html>",
        contentType: "text/html",
      },
    })
    const port = enginePortFor(clientFor(engine))
    expect(await port.text("getStacktrace", ["gone"])).toBeUndefined()
    await expect(port.text("getStacktrace", ["root"])).rejects.toMatchObject({ httpStatus: 404 })
    await expect(port.text("getExternalTaskErrorDetails", ["root"])).rejects.toMatchObject({
      httpStatus: 404,
    })
  })
})

/**
 * c7-client words a 404 that is no engine answer as a likely wrong REST root; it is a leaf and
 * cannot ask c7-core. Its wording is held here, over real engine answers, to c7-core's
 * `isUnknownEndpoint`, on which the one missing-resource rule `isMissing` builds.
 */
describe("the wrong-root hint of c7-client's 404 follows c7-core's isUnknownEndpoint", () => {
  const HINT = "check that the engine URL points at the REST API root"
  const answers = [
    { status: 404, body: { type: "InvalidRequestException", message: "gone" } },
    { status: 404, body: { type: "RestException", message: "No such definition" } },
    { status: 404, body: { type: "NotFoundException", message: "HTTP 404 Not Found" } },
    { status: 404, body: { type: "QueryParamException", message: "bad maxResults" } },
    { status: 404, body: "<html>Not Found</html>", contentType: "text/html" },
    { status: 404 },
    { status: 400, body: { type: "NotFoundException", message: "x" } },
    { status: 500 },
  ] as const

  it.each(answers.map((answer, index) => [index, answer] as const))("answer %i", async (_, a) => {
    const client = clientFor(await engineWith({ "GET /job/j/stacktrace": a }))
    const error: unknown = await fetchJobStacktrace(client, "j").then(
      () => new Error("expected the read to fail"),
      (reason: unknown) => reason,
    )
    const failure = engineFailure(error)
    expect(failure).toBeDefined()
    expect((error as Error).message.includes(HINT)).toBe(isUnknownEndpoint(failure))
  })
})

describe("isMissingResource and noneIfMissing", () => {
  function http(httpStatus: number, type?: string) {
    return new EngineRequestError("x", { kind: "http", httpStatus, type, engineMessage: "x" })
  }

  it("are c7-core's isMissing over the client's error", () => {
    expect(isMissingResource(http(404, "InvalidRequestException"))).toBe(true)
    expect(isMissingResource(http(404, "NotFoundException"))).toBe(false)
    expect(isMissingResource(http(404, "QueryParamException"))).toBe(false)
    expect(isMissingResource(http(404))).toBe(false)
    expect(isMissingResource(http(500, "InvalidRequestException"))).toBe(false)
    expect(isMissingResource(new Error("x"))).toBe(false)
  })

  it("reads a missing resource as null and rethrows everything else", async () => {
    expect(await noneIfMissing(Promise.resolve("v"))).toBe("v")
    expect(await noneIfMissing(Promise.reject(http(404, "InvalidRequestException")))).toBeNull()
    const root = http(404, "NotFoundException")
    await expect(noneIfMissing(Promise.reject(root))).rejects.toBe(root)
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
