import { afterEach, describe, expect, it } from "vitest"
import { fetchJobStacktrace } from "@miragon/pulse-c7-client"
import { CORE_ROUTES, isUnknownEndpoint, type Route } from "@miragon/pulse-c7-core"
import {
  INSPECT_OPERATIONS,
  RUNTIME_OPERATIONS,
  STATUS_OPERATIONS,
} from "@miragon/pulse-c7-core/testing"
import {
  clientFor,
  type FakeEngine,
  startFakeEngine,
} from "../../tools/test-support/fake-engine.js"
import { createEngineConnection } from "../engine/engine-connection.js"
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
  it("sends every operation c7-core's composites and its runtime send as its route, all of them reads", () => {
    const sent = [...INSPECT_OPERATIONS, ...STATUS_OPERATIONS, ...RUNTIME_OPERATIONS]
    for (const operationId of new Set(sent)) {
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

/** The route of an operation c7-core sends; every one is in `CORE_ROUTES`. */
function routeFor(operationId: string): Route {
  const route = CORE_ROUTES[operationId]
  if (route === undefined) throw new Error(`${operationId} has no route`)
  return route
}

/** A route's path with the values `v0`, `v1`, … in its placeholders, and those values. */
function filled(route: Route): { readonly path: string; readonly pathArgs: string[] } {
  const pathArgs: string[] = []
  const path = route.path.replace(/\{[^}]+\}/g, () => {
    pathArgs.push(`v${String(pathArgs.length)}`)
    return pathArgs.at(-1) ?? ""
  })
  return { path, pathArgs }
}

/**
 * c7-core's `C7Runtime` reads over this port in the engine suite (c7-runtime.engine.test.ts):
 * every operation of its readers goes out through the SDK wire by its route, a text route read as
 * text, a reading `POST` with its JSON body.
 */
describe("the runtime's operations over the SDK wire", () => {
  it.each([...RUNTIME_OPERATIONS])("%s goes out by its route's method and path", async (id) => {
    const route = routeFor(id)
    const engine = await engineWith({}, { body: { ok: true } })
    const port = enginePortFor(clientFor(engine))
    const { path, pathArgs } = filled(route)
    if (route.accepts.includes("text/plain")) {
      expect(await port.text(id, pathArgs)).toBe('{"ok":true}')
    } else {
      const body = route.method === "POST" ? { id } : undefined
      expect(await port.json(id, { pathArgs, query: {}, body })).toEqual({ ok: true })
    }
    expect(engine.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      `${route.method} ${path}`,
    ])
    expect(engine.requests[0]?.headers.accept).toBe(route.accepts.join(", "))
  })
})

describe("the runtime's reading POSTs", () => {
  const posts = RUNTIME_OPERATIONS.filter((id) => routeFor(id).method === "POST")
  const readOnly = (engine: FakeEngine) =>
    createEngineConnection(
      { id: "ro", baseUrl: engine.baseUrl },
      { type: "none" },
      {
        readOnly: true,
      },
    )

  it("are the history's instance query, its count, its variables and an instance's path, and the migration pair", () => {
    expect(posts).toEqual([
      "queryHistoricProcessInstances",
      "queryHistoricProcessInstancesCount",
      "queryHistoricVariableInstances",
      "queryHistoricActivityInstances",
      "generateMigrationPlan",
      "validateMigrationPlan",
    ])
  })

  it.each(posts)("%s sends its query and its JSON body, on a read-only engine too", async (id) => {
    const engine = await engineWith({}, { body: { count: 1 } })
    const body = { processInstanceIds: ["pi-1"], sorting: [{ sortBy: "startTime" }] }
    const input = { pathArgs: [], query: { firstResult: "0", maxResults: "500" }, body }
    expect(await enginePortFor(readOnly(engine)).json(id, input)).toEqual({ count: 1 })
    expect(engine.requests).toEqual([
      expect.objectContaining({
        method: "POST",
        path: routeFor(id).path,
        query: { firstResult: "0", maxResults: "500" },
        body,
      }),
    ])
    expect(engine.requests[0]?.headers["content-type"]).toMatch(/^application\/json\b/)
  })

  it("go out as reads: a write never leaves the read-only client, and no answer gets the write caveat", async () => {
    const engine = await engineWith(
      {},
      { body: "<html>", contentType: "application/json;charset=UTF-8" },
    )
    const client = readOnly(engine)
    await expect(client.post({ url: "/process-instance/delete", body: {} })).rejects.toThrow(
      "the profile of this engine is read-only on this server; nothing was sent (engine ro)",
    )
    expect(engine.requests).toEqual([])
    const input = { pathArgs: [], query: {}, body: {} }
    const failed: unknown = await enginePortFor(client)
      .json("queryHistoricProcessInstances", input)
      .catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(EngineRequestError)
    expect((failed as EngineRequestError).message).toBe("the answer of engine ro is no valid JSON")
    expect(engine.requests.map((request) => request.method)).toEqual(["POST"])
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
