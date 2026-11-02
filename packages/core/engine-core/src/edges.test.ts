/** Defensive reads of sparse engine data across the modules: missing fields read as absent. */

import { describe, expect, it } from "vitest"
import { advanceSteps } from "./advance-plan.js"
import { inspectInstance, loadInstance } from "./inspect.js"
import { missingRoots, planRetry } from "./retry-plan.js"
import { mergeCandidates } from "./select.js"
import { definitionStatus, groupIncidents, jobStatus, topicStatus } from "./status.js"
import { fakeFailure, FakeFailure, fakePort } from "./testing/fake-port.js"
import { activeData, activity, activityTree, P, PARENT_DEF } from "./testing/fixture.js"
import { approveRoutes } from "./testing/inspect-routes.js"
import { MESSAGE, SIGNAL } from "./testing/waits.js"
import { omit } from "./util.js"
import { waitStates } from "./waits.js"

const ALL = { variables: true, history: false, stacktrace: false }

describe("sparse status data", () => {
  it("reads statistics rows without a definition object and groups without timestamps", () => {
    expect(
      definitionStatus(
        [
          { id: "bare:1:x", instances: 1 },
          { definition: null, instances: 2 },
        ],
        [],
      ),
    ).toEqual([
      { key: "", latestVersion: 0, versions: 1, instances: 2, failedJobs: 0, incidents: 0 },
      { key: "bare", latestVersion: 0, versions: 1, instances: 1, failedJobs: 0, incidents: 0 },
    ])
    const grouped = groupIncidents(
      [
        { id: "a", rootCauseIncidentId: "a", processDefinitionId: "bare:1:x" },
        { id: "b", rootCauseIncidentId: "b", processDefinitionId: "bare:1:x" },
      ],
      [{ instances: 1 }, { id: "bare:1:x", definition: "not an object" }],
    )
    expect(grouped.groups).toMatchObject([
      { processDefinitionKey: "bare", count: 2, firstAt: "", lastAt: "", processInstanceIds: [] },
    ])
    expect(
      topicStatus(
        [
          { topicName: "t", lockExpirationTime: "2999-01-01T00:00:00.000+0000" },
          { topicName: "t", errorMessage: "x", createTime: "2026-01-01T00:00:00.000+0000" },
        ],
        0,
      ),
    ).toMatchObject([{ locked: 1, waiting: 1, workers: [] }])
    expect(jobStatus(1, [{}], 10)).toEqual({ executable: 1, overdue: 0 })
  })
})

describe("sparse instance data", () => {
  it("reads a variables answer that is no object and timers without an id", async () => {
    const port = fakePort({
      ...approveRoutes(),
      getProcessInstanceVariables: () => "no map",
      getJobs: (input) => (input.query.timers === "true" ? [{}] : []),
    })
    expect((await loadInstance(port, P, ALL)).variables).toEqual({})
  })

  it("rethrows a variables failure that is no engine answer", async () => {
    const port = fakePort({
      ...approveRoutes(),
      getProcessInstanceVariables: () => {
        throw new Error("offline")
      },
    })
    await expect(inspectInstance(port, { id: P, latest: false }, ALL)).rejects.toThrow("offline")
  })

  it("reads suspended jobs and waits of instances outside the tree", () => {
    const waits = waitStates(
      activeData({
        activityTrees: [
          activityTree(P, PARENT_DEF, [activity("t:ai", "cool-down", "timer", ["x"])]),
        ],
        jobs: [{ id: "j", executionId: "x", suspended: true, processInstanceId: "elsewhere" }],
        timerJobIds: new Set(["j"]),
      }),
    )
    expect(waits).toMatchObject([
      { kind: "timer", suspended: true, processInstanceId: "elsewhere" },
    ])
  })
})

describe("sparse rows of selection, retry and advance", () => {
  it("reads defaults", () => {
    expect(mergeCandidates([{ id: "h" }], [])).toEqual([{ id: "h", state: "ACTIVE" }])
    expect(missingRoots([{ id: "a" }])).toEqual([])
    expect(
      planRetry([{ id: "a", rootCauseIncidentId: "a", incidentType: "custom" }], {}),
    ).toMatchObject([{ action: "skip" }])
    expect(advanceSteps(omit(MESSAGE, "eventName"), {}, "w")[0]?.input.pathArgs).toEqual(["x1", ""])
    expect(advanceSteps(omit(SIGNAL, "eventName"), {}, "w")[0]?.input.body).toEqual({
      name: "",
      executionId: "x2",
    })
  })
})

describe("the fake port", () => {
  it("refuses an operation without a route and reads its failures back", async () => {
    const port = fakePort({ getIncidents: () => [] })
    await expect(port.json("getJobs", { pathArgs: [], query: {} })).rejects.toThrow(
      "fakePort: no route for getJobs",
    )
    expect(fakeFailure(500).message).toBe("HTTP 500")
    expect(fakeFailure(404, "X")).toBeInstanceOf(FakeFailure)
    expect(port.failure(fakeFailure(404, "X"))).toEqual({ status: 404, engineType: "X" })
    expect(port.failure(new Error("x"))).toBeUndefined()
    const routes = approveRoutes()
    const none = { pathArgs: [], query: {} }
    expect([
      routes.getProcessInstance?.(none),
      routes.getHistoricProcessInstance?.(none),
      routes.getActivityInstanceTree?.(none),
    ]).toEqual([undefined, undefined, undefined])
  })
})
