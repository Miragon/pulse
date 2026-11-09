import { describe, expect, test } from "vitest"
import { RestEngineClient } from "../../../../src/adapters/c7/engine-rest/index.js"
import { InspectedVariables } from "../../../../src/adapters/c7/mapping/inspected-variables.js"
import { httpOver } from "../support/fake-engine.js"
import { engineFailure, fakeEngineRest, type RestRoute } from "../support/fake-engine-rest.js"

const ORDER = "order:1:d1"

function get(path: string, answer: unknown): RestRoute {
  return { route: `GET ${path}`, answer }
}

describe("the inspect view", () => {
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

  test("is c7-core's instance view with the adapter's timeline", async () => {
    const engine = fakeEngineRest([
      ...RUNNING,
      get("/process-instance", []),
      get("/process-definition", [{ id: ORDER, key: "order", version: 2 }]),
    ])
    const view = (await new RestEngineClient(httpOver(engine)).inspect("p1"))!
    expect(view.waitingAt).toEqual([
      {
        kind: "timer",
        activityId: "timer",
        activityType: "timer",
        jobId: "j1",
        dueDate: "",
        retries: 0,
      },
    ])
    expect(view.definition).toEqual({ id: ORDER, key: "order", version: 2 })
    expect(view.timeline).toEqual([])
  })

  test("keeps the extension's variable views of the variable map", () => {
    expect(
      InspectedVariables.of({
        untyped: { value: "x" },
        json: { type: "Json" },
        blank: { type: "", value: 1 },
        plain: 7,
      }),
    ).toEqual([
      { name: "untyped", valueJson: '{"value":"x"}' },
      { name: "json", valueJson: "null", type: "Json" },
      { name: "blank", valueJson: "1" },
      { name: "plain", valueJson: "7" },
    ])
    expect(InspectedVariables.of(undefined)).toEqual([])
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
