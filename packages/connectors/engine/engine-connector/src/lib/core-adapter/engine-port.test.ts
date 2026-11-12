import { afterEach, describe, expect, it } from "vitest"
import { fetchJobStacktrace } from "@miragon/pulse-c7-client"
import { CORE_ROUTES, isUnknownEndpoint } from "@miragon/pulse-c7-core"
import { INSPECT_OPERATIONS, STATUS_OPERATIONS } from "@miragon/pulse-c7-core/testing"
import {
  clientFor,
  type FakeEngine,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { EngineRequestError, type EngineFailureKind } from "../engine/engine-error.js"
import { engineFailure, enginePortFor, isMissingResource, noneIfMissing } from "./engine-port.js"

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

describe("enginePortFor", () => {
  it("sends every operation c7-core's composites send as its route, all of them reads", () => {
    for (const operationId of new Set([...INSPECT_OPERATIONS, ...STATUS_OPERATIONS])) {
      expect(CORE_ROUTES[operationId]?.effect, operationId).toBe("read")
    }
  })

  it("refuses an operation the route table lacks and one without its id, nothing sent", async () => {
    const engine = await engineWith()
    const port = enginePortFor(clientFor(engine))
    await expect(port.json("getUsers", NO_INPUT)).rejects.toThrow(
      "c7-core asked for getUsers, which the route table does not hold",
    )
    await expect(port.json("getProcessInstance", NO_INPUT)).rejects.toThrow(
      "getProcessInstance takes 1 path values, c7-core sent 0",
    )
    expect(engine.requests).toEqual([])
  })

  it("fills a route's path values encoded and refuses one the URL would resolve away", async () => {
    const engine = await engineWith({ "GET /process-instance/a b/c": { body: { id: "x" } } })
    const port = enginePortFor(clientFor(engine))
    expect(await port.json("getProcessInstance", { pathArgs: ["a b/c"], query: {} })).toEqual({
      id: "x",
    })
    await expect(port.find("getProcessInstance", { pathArgs: [".."], query: {} })).rejects.toThrow(
      'the path value ".." was refused before sending (dot-segment)',
    )
    expect(engine.requests.map((request) => request.path)).toEqual(["/process-instance/a b/c"])
  })

  it("reads a Long beyond 2^53 as its exact digits", async () => {
    const engine = await engineWith({
      "GET /process-instance/pi-1/variables": (request) => ({
        body: `{"big":{"type":"Long","value":9223372036854775807},"q":"${request.query.deserializeValues ?? ""}"}`,
        contentType: "application/json;charset=UTF-8",
      }),
    })
    const port = enginePortFor(clientFor(engine))
    const input = { pathArgs: ["pi-1"], query: { deserializeValues: "false" } }
    expect(await port.json("getProcessInstanceVariables", input)).toEqual({
      big: { type: "Long", value: "9223372036854775807" },
      q: "false",
    })
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
 * The connector words a 404 that is no engine answer as a likely wrong REST root, by c7-core's
 * `isUnknownEndpoint`, on which the one missing-resource rule `isMissing` builds: held here over
 * real engine answers, through the SDK-bound text read.
 */
describe("the wrong-root hint of an engine 404 follows c7-core's isUnknownEndpoint", () => {
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

/** An engine error as the client's error interceptor words it. */
function engineError(
  kind: EngineFailureKind,
  details: { httpStatus?: number; type?: string } = {},
) {
  return new EngineRequestError("x", { kind, engineMessage: "x", engineId: "e", ...details })
}

describe("isMissingResource and noneIfMissing", () => {
  function http(httpStatus: number, type?: string) {
    return engineError("http", { httpStatus, type })
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
    const http = engineError("http", { httpStatus: 500, type: "NullValueException" })
    expect(engineFailure(http)).toEqual({
      status: 500,
      engineType: "NullValueException",
      engineMessage: "x",
    })
    const plain = engineError("http", { httpStatus: 503 })
    expect(engineFailure(plain)).toEqual({ status: 503, engineMessage: "x" })
    const noStatus = engineError("http")
    const down = engineError("unreachable")
    expect([engineFailure(noStatus), engineFailure(down), engineFailure(new Error("x"))]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})
