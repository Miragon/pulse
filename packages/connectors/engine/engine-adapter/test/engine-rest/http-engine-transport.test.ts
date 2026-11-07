import { isMissing } from "@miragon/pulse-engine-core"
import { INSPECT_OPERATIONS } from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import { EngineRequestError } from "../../src/engine-rest/index.js"
import { HttpEngineTransport } from "../../src/engine-rest/inspect/http-engine-transport.js"
import { InspectOperations } from "../../src/engine-rest/inspect/inspect-operations.js"
import { httpOver } from "../support/fake-engine.js"
import { fakeEngineRest, type RestRoute } from "../support/fake-engine-rest.js"

function get(path: string, answer: unknown): RestRoute {
  return { route: `GET ${path}`, answer }
}

function transportOver(routes: readonly RestRoute[]) {
  const engine = fakeEngineRest(routes)
  return { transport: new HttpEngineTransport(httpOver(engine)), engine }
}

describe("engine-core's port over the adapter's HTTP", () => {
  test("knows a REST path for exactly the operations engine-core's inspection sends", () => {
    expect(InspectOperations.ids().sort()).toEqual([...INSPECT_OPERATIONS].sort())
  })

  test("fills the path arguments encoded and refuses an operation it does not know", () => {
    expect(InspectOperations.requestOf("getActivityInstanceTree", ["a/b"])).toEqual({
      path: "/process-instance/a%2Fb/activity-instances",
      text: false,
    })
    expect(InspectOperations.requestOf("getStacktrace", ["j1"])).toEqual({
      path: "/job/j1/stacktrace",
      text: true,
    })
    expect(() => InspectOperations.requestOf("deleteProcessInstance", ["p1"])).toThrow(RangeError)
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
    ["a missing resource", EngineRequestError.answered(404, "gone", "InvalidRequestException")],
    [
      "a resource that ended meanwhile",
      EngineRequestError.answered(500, "x", "NullValueException"),
    ],
    ["a request refused before it leaves", EngineRequestError.refused("no")],
  ])("reads %s as missing, as the extension always did", (_name, error) => {
    expect(isMissing(new HttpEngineTransport(httpOver(fakeEngineRest([]))).failure(error))).toBe(
      true,
    )
  })

  test.each([
    ["a wrong REST root", EngineRequestError.answered(404, "x", "NotFoundException")],
    [
      "a query value the engine cannot read",
      EngineRequestError.answered(404, "x", "QueryParamException"),
    ],
    ["a 404 without an engine answer", EngineRequestError.answered(404, "x")],
  ])("reads %s as no missing resource, by engine-core's one rule", (_name, error) => {
    expect(EngineRequestError.isMissingResource(error)).toBe(false)
    expect(isMissing(new HttpEngineTransport(httpOver(fakeEngineRest([]))).failure(error))).toBe(
      false,
    )
  })

  test("passes every other engine answer on and nothing else", () => {
    const transport = new HttpEngineTransport(httpOver(fakeEngineRest([])))
    expect(transport.failure(EngineRequestError.answered(404, "x", "NotFoundException"))).toEqual({
      status: 404,
      engineType: "NotFoundException",
    })
    expect(transport.failure(EngineRequestError.answered(503, "x"))).toEqual({ status: 503 })
    expect(transport.failure(EngineRequestError.unanswered("down"))).toBeUndefined()
    expect(transport.failure(new Error("no engine"))).toBeUndefined()
  })
})
