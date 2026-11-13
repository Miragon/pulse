import { CAUSE_OPERATIONS, CORE_ROUTES, isMissing } from "@miragon/pulse-c7-core"
import { ROUTES } from "@miragon/pulse-c7-core/routes"
import { INSPECT_OPERATIONS } from "@miragon/pulse-c7-core/testing"
import { describe, expect, test } from "vitest"
import { EngineRequestError, RestEngineClient } from "../../src/engine-rest/index.js"
import { CoreRequests } from "../../src/engine-rest/inspect/core-requests.js"
import { HttpEngineTransport } from "../../src/engine-rest/inspect/http-engine-transport.js"
import { httpOver } from "../support/fake-engine.js"
import { fakeEngineRest, type RestRoute } from "../support/fake-engine-rest.js"

function get(path: string, answer: unknown): RestRoute {
  return { route: `GET ${path}`, answer }
}

function transportOver(routes: readonly RestRoute[]) {
  const engine = fakeEngineRest(routes)
  return { transport: HttpEngineTransport.over(httpOver(engine)), engine }
}

function routeOf(operationId: string) {
  const route = CORE_ROUTES[operationId]
  if (route === undefined) {
    throw new Error(`c7-core sends no ${operationId}`)
  }
  return route
}

describe("c7-core's port over the adapter's HTTP", () => {
  test("sends each operation c7-core's inspection sends as its route of c7-core's table", () => {
    expect(
      INSPECT_OPERATIONS.filter((operation) => !Object.hasOwn(CORE_ROUTES, operation)),
    ).toEqual([])
  })

  test("reads the text of each request that holds an incident's cause in c7-core", () => {
    for (const operation of CAUSE_OPERATIONS.values()) {
      expect(CoreRequests.answersText(routeOf(operation))).toBe(true)
      expect(CoreRequests.textPath(operation, "r1")).toMatch(/\/r1\//)
    }
  })

  test("reads a cause only through a request that answers with text", () => {
    const engine = fakeEngineRest([])
    const client = new RestEngineClient(httpOver(engine))
    expect(() => client.causeText("getJobs", "j1")).toThrow(RangeError)
    expect(engine.requests).toEqual([])
  })

  test("fills the path arguments encoded and reads text only by a route that answers text", () => {
    expect(CoreRequests.pathOf(routeOf("getActivityInstanceTree"), ["a/b"])).toBe(
      "/process-instance/a%2Fb/activity-instances",
    )
    expect(CoreRequests.answersText(routeOf("getActivityInstanceTree"))).toBe(false)
    expect(CoreRequests.textPath("getStacktrace", "j1")).toBe("/job/j1/stacktrace")
    expect(() => CoreRequests.textPath("getJobs", "j1")).toThrow(RangeError)
    expect(() => CoreRequests.textPath("deleteProcessInstance", "p1")).toThrow(RangeError)
    expect(() => CoreRequests.textPath("toString", "p1")).toThrow(RangeError)
  })

  test("refuses an operation c7-core's table does not hold before anything is sent", async () => {
    const { transport, engine } = transportOver([])
    await expect(
      transport.send("deleteProcessInstance", { pathArgs: ["p1"], query: {} }),
    ).rejects.toThrow("the route table does not hold")
    expect(engine.requests).toEqual([])
  })

  test.each([
    ["a write", "deleteProcessInstance", ["p1"]],
    ["a POST that reads", "queryProcessInstances", []],
  ])("refuses %s of the whole route table before anything is sent", async (_name, id, args) => {
    const route = ROUTES[id]
    if (route === undefined) {
      throw new Error(`the route table holds no ${id}`)
    }
    const engine = fakeEngineRest([])
    const wire = new HttpEngineTransport(httpOver(engine, true))
    await expect(wire.send(route, { pathArgs: args, query: {}, body: {} })).rejects.toThrow(
      RangeError,
    )
    expect(engine.requests).toEqual([])
  })

  test("sends each route of c7-core's table as the reading GET it is, without a body", async () => {
    expect(
      Object.values(CORE_ROUTES).filter(
        (route) => route.method !== "GET" || route.effect !== "read",
      ),
    ).toEqual([])
    const { transport, engine } = transportOver([get("/incident", [])])
    await transport.send("getIncidents", { pathArgs: [], query: {}, body: { ignored: true } })
    expect(engine.requests.map((request) => [request.route, request.body])).toEqual([
      ["GET /incident", ""],
    ])
  })

  test("reads JSON answers with their query and text answers as text", async () => {
    const { transport, engine } = transportOver([
      get("/incident", [{ id: "i1" }]),
      get("/external-task/x1/errorDetails", new Response("Boom")),
    ])
    const list = await transport.send("getIncidents", {
      pathArgs: [],
      query: { processInstanceId: "p1", absent: undefined },
    })
    const details = await transport.send("getExternalTaskErrorDetails", {
      pathArgs: ["x1"],
      query: {},
    })
    expect([transport.json(list), transport.text(list)]).toEqual([[{ id: "i1" }], undefined])
    expect([transport.json(details), transport.text(details)]).toEqual([undefined, "Boom"])
    expect(engine.requests.map((request) => request.query)).toEqual([
      { processInstanceId: "p1" },
      {},
    ])
  })

  test.each([
    [
      "a missing resource",
      EngineRequestError.answered(404, "gone", { engineType: "InvalidRequestException" }),
    ],
    [
      "a resource that ended meanwhile",
      EngineRequestError.answered(500, "x", { engineType: "NullValueException" }),
    ],
    ["a request refused before it leaves", EngineRequestError.refused("no")],
  ])("reads %s as missing, as the extension always did", (_name, error) => {
    expect(isMissing(HttpEngineTransport.over(httpOver(fakeEngineRest([]))).failure(error))).toBe(
      true,
    )
  })

  test.each([
    [
      "a wrong REST root",
      EngineRequestError.answered(404, "x", { engineType: "NotFoundException" }),
    ],
    [
      "a query value the engine cannot read",
      EngineRequestError.answered(404, "x", { engineType: "QueryParamException" }),
    ],
    ["a 404 without an engine answer", EngineRequestError.answered(404, "x")],
  ])("reads %s as no missing resource, by c7-core's one rule", (_name, error) => {
    expect(EngineRequestError.isMissingResource(error)).toBe(false)
    expect(isMissing(HttpEngineTransport.over(httpOver(fakeEngineRest([]))).failure(error))).toBe(
      false,
    )
  })

  test("passes every other engine answer on and nothing else", () => {
    const transport = HttpEngineTransport.over(httpOver(fakeEngineRest([])))
    expect(
      transport.failure(EngineRequestError.answered(404, "x", { engineType: "NotFoundException" })),
    ).toEqual({
      status: 404,
      engineType: "NotFoundException",
    })
    expect(transport.failure(EngineRequestError.answered(503, "x"))).toEqual({ status: 503 })
    expect(transport.failure(EngineRequestError.unanswered("down"))).toBeUndefined()
    expect(transport.failure(new Error("no engine"))).toBeUndefined()
  })
})
