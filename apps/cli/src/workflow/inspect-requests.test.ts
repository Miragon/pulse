/** An instance that ends while inspect reads it, and the requests inspect sends (inspect.ts). */

import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import { engineError, fakeServer, json } from "../../test/support/fake-fetch.js"
import { ALL, approveEngine } from "../../test/support/inspect-engine.js"
import {
  activity,
  activityTree,
  C,
  CHILD_DEF,
  historyDto,
  P,
  PARENT_DEF,
  runtimeDto,
} from "../../test/support/workflow-fixture.js"
import { loadInstance, loadView } from "./inspect.js"

describe("an instance that ends while inspect reads it", () => {
  /** The job executor ends the instance after the first runtime read. */
  function racingEngine(after: "activities" | "variables") {
    let reads = 0
    const gone = engineError(404, "InvalidRequestException", `Process instance ${P} does not exist`)
    return approveEngine()
      .on("GET", `/process-instance/${P}`, () => (++reads === 1 ? json(runtimeDto) : gone.clone()))
      .on("GET", `/history/process-instance/${P}`, () =>
        json(reads === 1 ? historyDto : { ...historyDto, state: "COMPLETED" }),
      )
      .on("GET", `/process-instance/${P}/activity-instances`, () =>
        after === "activities"
          ? gone.clone()
          : json(
              activityTree(P, PARENT_DEF, [
                activity("call:ai", "call-approval", "callActivity", ["ex-call"]),
              ]),
            ),
      )
      .on("GET", `/process-instance/${P}/variables`, () =>
        after === "variables"
          ? engineError(
              500,
              "NullValueException",
              `execution ${P} doesn't exist: execution is null`,
            )
          : json({}),
      )
      .on("GET", "/history/variable-instance", json([]))
  }

  it("loads it again, then as ended, when its activity instances answer 404", async () => {
    const server = racingEngine("activities")
    const view = await loadInstance(portOf(server.fetch), P, ALL)
    expect(view).toMatchObject({ id: P, state: "COMPLETED", waitingAt: [] })
    expect(
      server.requests.filter((request) => request.path === `/process-instance/${P}`),
    ).toHaveLength(2)
  })

  it("loads it again when its variables answer 500 NullValueException", async () => {
    const view = await loadInstance(portOf(racingEngine("variables").fetch), P, ALL)
    expect(view).toMatchObject({ state: "COMPLETED", waitingAt: [] })
  })

  it("leaves out a called instance that ended since the tree was read", async () => {
    const server = approveEngine().on(
      "GET",
      `/process-instance/${C}/activity-instances`,
      engineError(404, "InvalidRequestException", `Process instance ${C} does not exist`),
    )
    const view = await loadInstance(portOf(server.fetch), P, ALL)
    expect(view.children).toEqual([])
    expect(view.incidents).toEqual([])
    expect(view.state).toBe("ACTIVE")
  })

  it("gives up after the second attempt and rethrows other errors", async () => {
    const always = approveEngine().on(
      "GET",
      `/process-instance/${P}/activity-instances`,
      engineError(404, "InvalidRequestException", "gone"),
    )
    await expect(loadInstance(portOf(always.fetch), P, ALL)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: `Process instance ${P} does not exist (neither running nor in the history)`,
    })
    expect(await loadView(portOf(always.fetch), P, ALL)).toEqual({ id: P, state: "ENDED" })
    const broken = approveEngine().on(
      "GET",
      `/process-instance/${P}/variables`,
      engineError(500, "ProcessEngineException", "database down"),
    )
    await expect(loadInstance(portOf(broken.fetch), P, ALL)).rejects.toMatchObject({
      code: "HTTP_SERVER_ERROR",
    })
  })
})

describe("inspect requests", () => {
  const sent = (server: {
    requests: readonly { method: string; path: string; query: URLSearchParams }[]
  }) =>
    server.requests
      .map((request) => `${request.method} ${request.path}?${request.query.toString()}`)
      .sort()
  const page = "firstResult=0&maxResults=500"
  const ids = `${P}%2C${C}`
  const def = (id: string) => encodeURIComponent(id)

  it("sends every query of the documented rounds", async () => {
    const server = approveEngine()
    await loadInstance(portOf(server.fetch), P, { ...ALL, history: true })
    expect(sent(server)).toEqual([
      `GET /event-subscription?processInstanceId=${P}&${page}`,
      `GET /event-subscription?processInstanceId=${C}&${page}`,
      `GET /external-task?processInstanceIdIn=${ids}&${page}`,
      `GET /history/activity-instance?sortBy=occurrence&sortOrder=asc&${page}&processInstanceId=${P}`,
      `GET /history/incident?processInstanceId=${P}&${page}`,
      `GET /history/process-instance/${P}?`,
      `GET /incident?processInstanceId=${P}&${page}`,
      `GET /incident?processInstanceId=${C}&${page}`,
      `GET /job-definition?processDefinitionId=${def(CHILD_DEF)}&${page}`,
      `GET /job-definition?processDefinitionId=${def(PARENT_DEF)}&${page}`,
      "GET /job/j1/stacktrace?",
      `GET /job?processInstanceIds=${ids}&${page}`,
      `GET /job?processInstanceIds=${ids}&timers=true&${page}`,
      `GET /process-definition?processDefinitionIdIn=${def(PARENT_DEF)}%2C${def(CHILD_DEF)}&${page}`,
      `GET /process-instance/${P}/activity-instances?`,
      `GET /process-instance/${P}/variables?deserializeValues=false`,
      `GET /process-instance/${P}?`,
      `GET /process-instance/${C}/activity-instances?`,
      `GET /process-instance?firstResult=0&maxResults=101&superProcessInstance=${P}`,
      `GET /process-instance?firstResult=0&maxResults=101&superProcessInstance=${C}`,
      `GET /task?processInstanceIdIn=${ids}&${page}`,
    ])
  })

  it("marks timer jobs from the timers query and keeps the job definitions of every definition", async () => {
    const server = approveEngine().on("GET", "/job", (request) =>
      json(
        request.query.get("timers") === "true"
          ? [{ id: "timer-1" }, {}]
          : [
              {
                id: "timer-1",
                jobDefinitionId: "jd-timer",
                processInstanceId: P,
                executionId: "ex-call",
              },
            ],
      ),
    )
    const view = await loadInstance(portOf(server.fetch), P, ALL)
    expect(view.waitingAt).toContainEqual(
      expect.objectContaining({ kind: "timer", jobId: "timer-1", activityId: "cool-down" }),
    )
  })

  it("loads the ended instance and its timeline with the instance queries", async () => {
    const server = fakeServer()
      .on("GET", `/process-instance/${P}`, engineError(404, "InvalidRequestException", "gone"))
      .on("GET", `/history/process-instance/${P}`, json({ ...historyDto, state: "COMPLETED" }))
      .on("GET", "/history/variable-instance", json([]))
      .on("GET", "/history/activity-instance", json([{ id: "h1", activityId: "start" }]))
      .on(
        "GET",
        "/history/incident",
        json([{ id: "hi", activityId: "start", createTime: "t", incidentType: "failedJob" }]),
      )
    const view = await loadInstance(portOf(server.fetch), P, { ...ALL, history: true })
    expect(view.timeline).toEqual([
      expect.objectContaining({
        activityId: "start",
        incidents: [{ type: "failedJob", state: "resolved" }],
      }),
    ])
    expect(sent(server)).toEqual([
      `GET /history/activity-instance?sortBy=occurrence&sortOrder=asc&${page}&processInstanceId=${P}`,
      `GET /history/incident?processInstanceId=${P}&${page}`,
      `GET /history/process-instance/${P}?`,
      `GET /history/variable-instance?processInstanceId=${P}&${page}&deserializeValues=false`,
      `GET /process-instance/${P}?`,
    ])
  })

  it("keeps NOT_FOUND errors with a status and other errors in loadView", async () => {
    const server = fakeServer()
      .on("GET", "/process-instance/x", engineError(404, "NotFoundException", "gone"))
      .on("GET", "/history/process-instance/x", engineError(404, "NotFoundException", "gone"))
    await expect(loadView(portOf(server.fetch), "x", ALL)).rejects.toMatchObject({
      code: "NOT_FOUND",
      details: { status: 404 },
    })
    const failing = fakeServer()
      .on("GET", "/process-instance/x", engineError(500, "ProcessEngineException", "down"))
      .on("GET", "/history/process-instance/x", engineError(500, "ProcessEngineException", "down"))
    await expect(loadView(portOf(failing.fetch), "x", ALL)).rejects.toThrow(/HTTP 500/)
  })

  it("keeps the hint of a missing instance and previews an empty id", async () => {
    const server = fakeServer()
      .on("GET", "/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
      .on("GET", "/history/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
    await expect(loadInstance(portOf(server.fetch), "x", ALL)).rejects.toMatchObject({
      details: {
        hint: "List instances with `operate process-instance list` (running) or `operate historic-process-instance list` (also ended); with history level none, ended instances cannot be found.",
      },
    })
  })
})
