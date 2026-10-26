import { describe, expect, it } from "vitest"
import { portOf } from "../../test/support/engine-port.js"
import { engineError, fakeServer, json, text } from "../../test/support/fake-fetch.js"
import { ALL, approveEngine } from "../../test/support/inspect-engine.js"
import {
  activityTree,
  C,
  CHILD_DEF,
  DEFINITIONS,
  historyDto,
  P,
} from "../../test/support/workflow-fixture.js"
import { PulseCliError } from "../errors.js"
import { incidentCause, inspect, instanceRequests, loadInstance, loadView } from "./inspect.js"

describe("loadInstance", () => {
  it("loads the fixture with 19 requests in the documented rounds", async () => {
    const server = approveEngine()
    const view = await loadInstance(portOf(server.fetch), P, ALL)
    expect(server.requests).toHaveLength(19)
    const paths = server.requests.map((request) => request.path)
    expect(paths.slice(0, 2).sort()).toEqual([
      `/history/process-instance/${P}`,
      `/process-instance/${P}`,
    ])
    expect(paths.at(-1)).toBe("/job/j1/stacktrace")
    expect(view).toMatchObject({
      waitingAt: [{ processInstanceId: C, activityId: "approve", kind: "userTask", taskId: "t1" }],
      incidents: [
        {
          id: "i1",
          processInstanceId: C,
          rootCause: "PropertyNotFoundException: missingBean",
          jobId: "j1",
        },
      ],
      children: [{ id: C, key: "workflow-child" }],
      variables: { amount: 250 },
    })
    const taskRequest = server.requests.find((request) => request.path === "/task")
    expect(taskRequest?.query.get("processInstanceIdIn")).toBe(`${P},${C}`)
  })

  it("leaves out the variables, adds the timeline and the stacktrace when asked", async () => {
    const server = approveEngine()
    const view = await loadInstance(portOf(server.fetch), P, {
      variables: false,
      history: true,
      stacktrace: true,
    })
    expect(view.variables).toBeUndefined()
    expect(view.timeline).toEqual([
      {
        activityId: "start",
        activityType: "startEvent",
        startTime: "2026-01-01T00:00:00.000+0000",
      },
    ])
    expect(view.incidents[0]?.stacktrace).toEqual([
      "org.x.ProcessEngineException: outer",
      "Caused by: org.x.PropertyNotFoundException: missingBean",
    ])
    expect(server.requests.some((request) => request.path.endsWith("/variables"))).toBe(false)
    const activities = server.requests.find(
      (request) => request.path === "/history/activity-instance",
    )
    expect(activities?.query.get("sortBy")).toBe("occurrence")
  })

  it("finds the parent without a history record", async () => {
    const server = fakeServer()
      .on("GET", "/process-instance/c1", json({ id: "c1", definitionId: CHILD_DEF }))
      .on(
        "GET",
        "/history/process-instance/c1",
        engineError(404, "InvalidRequestException", "no history"),
      )
      .on("GET", "/process-instance", (request) =>
        json(request.query.get("subProcessInstance") === "c1" ? [{ id: "parent-1" }] : []),
      )
      .on("GET", "/process-instance/c1/activity-instances", json(activityTree("c1", CHILD_DEF, [])))
      .on("GET", "/incident", json([]))
      .on("GET", "/event-subscription", json([]))
      .on("GET", "/task", json([]))
      .on("GET", "/external-task", json([]))
      .on("GET", "/job", json([]))
      .on("GET", "/process-definition", json(DEFINITIONS))
      .on("GET", "/job-definition", json([]))
    const view = await loadInstance(portOf(server.fetch), "c1", { ...ALL, variables: false })
    expect(view).toMatchObject({
      parentId: "parent-1",
      state: "ACTIVE",
      definition: { key: "workflow-child", version: 1 },
    })
  })

  it("loads an ended instance from the history with its process scope variables", async () => {
    const server = fakeServer()
      .on("GET", `/process-instance/${P}`, engineError(404, "InvalidRequestException", "gone"))
      .on(
        "GET",
        `/history/process-instance/${P}`,
        json({ ...historyDto, state: "COMPLETED", endTime: "2026-01-01T00:00:09.000+0000" }),
      )
      .on(
        "GET",
        "/history/variable-instance",
        json([
          { name: "amount", type: "Integer", value: 250, activityInstanceId: P },
          { name: "local", type: "String", value: "x", activityInstanceId: "task:1" },
        ]),
      )
    const view = await loadInstance(portOf(server.fetch), P, ALL)
    expect(view).toMatchObject({
      state: "COMPLETED",
      waitingAt: [],
      variables: { amount: 250 },
      next: [`pulse-cli inspect ${P} --history`],
    })
    expect(
      server.requests
        .find((request) => request.path === "/history/variable-instance")
        ?.query.get("deserializeValues"),
    ).toBe("false")
  })

  it("is NOT_FOUND when neither runtime nor history know the id", async () => {
    const server = fakeServer()
      .on("GET", "/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
      .on("GET", "/history/process-instance/x", engineError(404, "InvalidRequestException", "gone"))
    await expect(loadInstance(portOf(server.fetch), "x", ALL)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Process instance x does not exist (neither running nor in the history)",
    })
    expect(await loadView(portOf(server.fetch), "x", ALL)).toEqual({ id: "x", state: "ENDED" })
    const broken = fakeServer()
    await expect(loadView(portOf(broken.fetch), "x", ALL)).rejects.toBeInstanceOf(PulseCliError)
  })
})

describe("incidentCause", () => {
  it("reads the error details of a failed external task and falls back to the message", async () => {
    const server = fakeServer().on(
      "GET",
      "/external-task/e1/errorDetails",
      text("java.io.IOException: refused\n\tat x", "text/plain"),
    )
    const port = portOf(server.fetch)
    expect(
      await incidentCause(
        port,
        { incidentType: "failedExternalTask", configuration: "e1", incidentMessage: "m" },
        false,
      ),
    ).toEqual({ rootCause: "IOException: refused" })
    expect(
      await incidentCause(port, { incidentType: "custom", incidentMessage: "m" }, true),
    ).toEqual({ rootCause: "m" })
    expect(
      await incidentCause(port, { incidentType: "failedJob", incidentMessage: "m" }, true),
    ).toEqual({ rootCause: "m" })
  })
})

describe("inspect", () => {
  it("previews the first round with --dry-run and sends nothing", async () => {
    const server = fakeServer()
    const port = portOf(server.fetch)
    expect(await inspect(port, { id: "p1", latest: false }, { ...ALL, dryRun: true })).toEqual({
      kind: "dry-run",
      requests: instanceRequests("p1"),
    })
    const filtered = await inspect(
      port,
      { businessKey: "B", latest: false },
      { ...ALL, dryRun: true },
    )
    expect(
      filtered.kind === "dry-run" ? filtered.requests.map((request) => request.operationId) : [],
    ).toEqual(["getHistoricProcessInstances", "getProcessInstances"])
    expect(server.requests).toEqual([])
    await expect(inspect(port, { latest: false }, { ...ALL, dryRun: true })).rejects.toThrow(
      "Select a process instance",
    )
  })

  it("selects and loads the instance", async () => {
    const result = await inspect(
      portOf(approveEngine().fetch),
      { id: P, latest: false },
      { ...ALL, dryRun: false },
    )
    expect(result.kind === "view" ? result.view.id : undefined).toBe(P)
  })
})
