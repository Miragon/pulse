import { describe, expect, test } from "vitest"
import { RestEngineClient } from "../../../../src/adapters/c7/engine-rest/index.js"
import { httpOver } from "../support/fake-engine.js"
import { engineFailure, fakeEngineRest, type RestRoute } from "../support/fake-engine-rest.js"

const ORDER = "order:1:d1"

function get(path: string, answer: unknown): RestRoute {
  return { route: `GET ${path}`, answer }
}

describe("the inspect view of engine-core's instance view", () => {
  const RUNNING = [
    get("/process-instance/p1", { id: "p1", definitionId: ORDER }),
    get("/history/process-instance/p1", engineFailure(404, "InvalidRequestException", "none")),
    get("/process-instance/p1/activity-instances", {
      id: "p1",
      activityId: ORDER,
      childActivityInstances: [
        { id: "timer:a1", activityId: "timer", activityType: "timer", executionIds: ["e1"] },
      ],
    }),
    get("/process-instance/p1/variables", { untyped: { value: "x" }, json: { type: "Json" } }),
    get("/job", [{ id: "j1", executionId: "e1", failedActivityId: "timer" }]),
    ...["/incident", "/event-subscription", "/task", "/external-task", "/job-definition"].map(
      (path) => get(path, []),
    ),
    get("/history/activity-instance", []),
  ]

  test("leaves out what the engine did not send and keeps the extension's variable views", async () => {
    const engine = fakeEngineRest([
      ...RUNNING,
      get("/process-instance", []),
      get("/process-definition", [{ id: ORDER, key: "order", version: 2 }]),
    ])
    const view = (await new RestEngineClient(httpOver(engine)).inspect("p1"))!
    expect(view.waitingAt).toEqual([{ kind: "timer", activityId: "timer", activityType: "timer" }])
    expect(view.variables).toEqual([
      { name: "json", valueJson: "null", type: "Json" },
      { name: "untyped", valueJson: '"x"' },
    ])
    expect(view.definition).toEqual({ id: ORDER, key: "order", version: 2 })
  })

  test("fails on a definition the engine does not list", async () => {
    const engine = fakeEngineRest([
      ...RUNNING,
      get("/process-instance", []),
      get("/process-definition", []),
    ])
    await expect(new RestEngineClient(httpOver(engine)).inspect("p1")).rejects.toThrow(
      `definition ${ORDER} is missing`,
    )
  })
})
