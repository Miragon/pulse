import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { MAX_STACKTRACE_LINES } from "../inspect.js"
import type { OperationInput } from "../port.js"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { InstanceInspection } from "./instance-inspection.js"
import { parseExact } from "../raw-json.js"
import { inspectedVariablesOf } from "./variable-instances.js"

const SINCE = "2026-10-21T18:00:00.000+0000"
const LATER = "2026-10-21T19:00:00.000+0000"
const ORDER = "order:1:d1"
const LABEL = "label:1:d2"

type Routes = Record<string, Route>

const missing: Route = () => {
  throw fakeFailure(404, "InvalidRequestException")
}

function byPath(answers: Readonly<Record<string, unknown>>): Route {
  return (input) => answers[input.pathArgs[0] ?? ""]
}

function byQuery(key: string, answers: Readonly<Record<string, unknown>>): Route {
  return (input) => answers[input.query[key] ?? ""] ?? []
}

function history(id: string, more: Record<string, unknown> = {}) {
  const definition = { processDefinitionKey: "order", processDefinitionVersion: 1 }
  return { id, processDefinitionId: ORDER, ...definition, ...more }
}

function leaf(id: string, activityType: string, executionId: string) {
  const activityId = id.split(":")[0]
  return { id, activityId, activityType, activityName: activityId, executionIds: [executionId] }
}

function incident(id: string, root: string, more: Record<string, string>) {
  return { id, rootCauseIncidentId: root, incidentTimestamp: SINCE, ...more }
}

const ORDER_TREE = {
  id: "p1",
  activityId: ORDER,
  childActivityInstances: [
    leaf("review:a1", "userTask", "e1"),
    leaf("work:a2", "serviceTask", "e2"),
    leaf("host:a3", "task", "e3"),
    leaf("call:a4", "callActivity", "e4"),
    leaf("manual:a5", "manualTask", "e5"),
  ],
  childTransitionInstances: [{ id: "async:t1", activityId: "async", executionId: "e6" }],
}
const LABEL_TREE = {
  id: "c1",
  activityId: LABEL,
  childActivityInstances: [leaf("print:b1", "x", "c1")],
}

/** The answers of an instance p1 with a called instance c1, both with incidents. */
function runningTree(): Routes {
  return {
    getProcessInstance: byPath({ p1: { id: "p1", definitionId: ORDER } }),
    getHistoricProcessInstance: byPath({
      p1: history("p1", { businessKey: "ORD-1", startTime: SINCE }),
    }),
    getProcessInstances: byQuery("superProcessInstance", {
      p1: [{ id: "c1", definitionId: LABEL, suspended: true }],
    }),
    getActivityInstanceTree: byPath({ p1: ORDER_TREE, c1: LABEL_TREE }),
    getIncidents: byQuery("processInstanceId", {
      p1: [
        incident("i1", "i1", {
          incidentType: "failedExternalTask",
          activityId: "work",
          configuration: "x1",
        }),
        incident("i3", "i2", { incidentType: "failedJob", activityId: "call" }),
        incident("i0", "i1", { incidentType: "failedExternalTask", configuration: "x1" }),
        {
          ...incident("i4", "i4", { incidentType: "custom", activityId: "manual" }),
          incidentTimestamp: LATER,
        },
      ],
      c1: [
        incident("i2", "i2", {
          incidentType: "failedJob",
          activityId: "print",
          processInstanceId: "c1",
          configuration: "j2",
        }),
      ],
    }),
    getEventSubscriptions: byQuery("processInstanceId", {
      p1: [
        {
          id: "s1",
          eventType: "message",
          eventName: "Cancel",
          activityId: "cancel",
          executionId: "e3",
        },
        { id: "s2", eventType: "compensate", activityId: "undo", executionId: "e3" },
      ],
    }),
    getTasks: () => [
      {
        id: "t1",
        taskDefinitionKey: "review",
        executionId: "e1",
        created: SINCE,
        assignee: "demo",
      },
    ],
    getExternalTasks: () => [
      { id: "x1", activityId: "work", activityInstanceId: "work:a2", topicName: "work-topic" },
    ],
    getJobs: (input) =>
      input.query.timers === "true"
        ? [{ id: "j1" }]
        : [
            { id: "j1", jobDefinitionId: "jd1", executionId: "e3", dueDate: LATER },
            { id: "j3", jobDefinitionId: "jd3", executionId: "e6", retries: 3 },
            {
              id: "j2",
              failedActivityId: "print",
              executionId: "c1",
              processInstanceId: "c1",
              retries: 0,
            },
          ],
    getProcessDefinitions: () => [{ id: ORDER, key: "order", version: 1 }],
    getJobDefinitions: byQuery("processDefinitionId", {
      [ORDER]: [
        { id: "jd1", activityId: "timer" },
        { id: "jd3", activityId: "async" },
      ],
    }),
    getProcessInstanceVariables: () =>
      parseExact(
        '{"total":{"type":"Long","value":9007199254740993},"doc":{"type":"Json","value":"{}"}}',
      ),
    queryHistoricActivityInstances: () => [
      { activityId: "call", startTime: SINCE, calledProcessInstanceId: "c1", canceled: true },
    ],
    getExternalTaskErrorDetails: () => "Boom\n\tat Worker\n",
    getStacktrace: missing,
  }
}

function inspect(routes: Routes, id = "p1") {
  const port = fakePort(routes)
  return { port, view: new InstanceInspection(port).inspect(id) }
}

function pathReads(calls: readonly { operationId: string; input: OperationInput }[]) {
  return calls.filter((call) => call.operationId === "queryHistoricActivityInstances")
}

describe("InstanceInspection over the instance view's rounds", () => {
  it("finds where the tree waits, its root incidents and its called instances", async () => {
    const view = (await inspect(runningTree()).view)!

    expect(
      view.waitingAt.map(({ kind, activityId, attachedTo, processInstanceId, incidentId }) => [
        kind,
        activityId,
        attachedTo,
        processInstanceId,
        incidentId,
      ]),
    ).toEqual([
      ["asyncContinuation", "async", undefined, undefined, undefined],
      ["message", "cancel", "host", undefined, undefined],
      ["other", "manual", undefined, undefined, undefined],
      ["userTask", "review", undefined, undefined, undefined],
      ["timer", "timer", "host", undefined, undefined],
      ["externalTask", "work", undefined, undefined, "i1"],
      ["asyncContinuation", "print", undefined, "c1", "i2"],
    ])
    expect(view.waitingAt[3]).toEqual({
      kind: "userTask",
      taskId: "t1",
      activityId: "review",
      activityName: "review",
      activityType: "userTask",
      since: SINCE,
      assignee: "demo",
    })
    expect(
      view.incidents.map(({ id, jobId, externalTaskId, stacktrace }) => [
        id,
        jobId ?? externalTaskId,
        stacktrace,
      ]),
    ).toEqual([
      ["i1", "x1", ["Boom", "\tat Worker"]],
      ["i2", "j2", undefined],
      ["i4", undefined, undefined],
    ])
    expect(view).toMatchObject({
      businessKey: "ORD-1",
      definition: { id: ORDER, key: "order", version: 1 },
      propagatedIncidents: 2,
      children: [{ id: "c1", parentId: "p1", key: "label", state: "SUSPENDED" }],
      timeline: [
        { activityId: "call", startTime: SINCE, canceled: true, calledProcessInstanceId: "c1" },
      ],
    })
    expect(inspectedVariablesOf(view.variables)).toEqual([
      { name: "doc", valueJson: '"{}"', type: "Json" },
      { name: "total", valueJson: "9007199254740993" },
    ])
  })

  it("reads the path once, in parallel, whole and in the history's one order, and no historic incident", async () => {
    const { port, view } = inspect(runningTree())
    await view

    expect(pathReads(port.calls).map((call) => call.input)).toStrictEqual([
      {
        pathArgs: [],
        query: { firstResult: "0", maxResults: "500" },
        body: {
          processInstanceId: "p1",
          sorting: [
            { sortBy: "startTime", sortOrder: "asc" },
            { sortBy: "occurrence", sortOrder: "asc" },
            { sortBy: "activityInstanceId", sortOrder: "asc" },
          ],
        },
      },
    ])
    expect(port.calls.slice(0, 3).map((call) => call.operationId)).toStrictEqual([
      "getProcessInstance",
      "getHistoricProcessInstance",
      "queryHistoricActivityInstances",
    ])
  })

  it("cuts a long stack trace at c7-core's limit", async () => {
    const frames = Array.from({ length: 250 }, (_, index) => `\tat Frame${String(index)}`)
    const routes = { ...runningTree(), getExternalTaskErrorDetails: () => frames.join("\n") }

    const stacktrace = (await inspect(routes).view)?.incidents[0]?.stacktrace

    expect(stacktrace).toHaveLength(MAX_STACKTRACE_LINES)
  })

  it("reads a suspended instance's path once", async () => {
    const routes = {
      ...runningTree(),
      getProcessInstance: () => ({ id: "p1", definitionId: ORDER, suspended: true }),
    }
    const { port, view } = inspect(routes)

    expect((await view)?.state).toBe("SUSPENDED")
    expect(pathReads(port.calls)).toHaveLength(1)
  })

  it("fails when the engine fails to read the variables", async () => {
    const routes = {
      ...runningTree(),
      getProcessInstanceVariables: () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    }

    await expect(inspect(routes).view).rejects.toThrow("HTTP 500 ProcessEngineException")
  })

  it("fails on a live instance whose path could not be read", async () => {
    const routes = {
      ...runningTree(),
      queryHistoricActivityInstances: () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    }

    await expect(inspect(routes).view).rejects.toThrow("HTTP 500 ProcessEngineException")
  })

  it.each([
    ["activityId", { startTime: SINCE }],
    ["startTime", { activityId: "call" }],
  ])("fails as an unexpected answer when a step of the path has no %s", async (field, step) => {
    const routes = { ...runningTree(), queryHistoricActivityInstances: () => [step] }
    const failure = await inspect(routes).view.catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RuntimeError)
    expect(failure).toMatchObject({ failure: "unexpectedResponse", message: `${field} is missing` })
  })

  it("fails as an unexpected answer on a step that is no object", async () => {
    const routes = { ...runningTree(), queryHistoricActivityInstances: () => ["call"] }

    await expect(inspect(routes).view).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "activity instance[0] is not an object",
    })
  })
})

describe("InstanceInspection of the tree", () => {
  it("fails on a definition the engine does not list", async () => {
    const routes = {
      ...runningTree(),
      getHistoricProcessInstance: missing,
      getProcessDefinitions: () => [],
    }
    const failure = await inspect(routes).view.catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(RuntimeError)
    expect(failure).toMatchObject({
      failure: "unexpectedResponse",
      message: `definition ${ORDER} is missing`,
    })
  })

  it("cuts the tree ten levels down and leaves out those that ended", async () => {
    const view = await inspect({
      ...runningTree(),
      getProcessInstances: () => [{ id: "c", definitionId: LABEL }],
      getActivityInstanceTree: byPath({ p1: { id: "p1", activityId: ORDER } }),
      getIncidents: () => [],
      getEventSubscriptions: () => [],
      getTasks: () => [],
      getExternalTasks: () => [],
      getJobs: () => [],
      getProcessInstanceVariables: () => ({}),
    }).view

    expect(view).toMatchObject({ truncated: true, children: [] })
  })

  it("reads a timer of the instance view with its job", async () => {
    const view = await inspect({
      ...runningTree(),
      getProcessInstances: () => [],
      getHistoricProcessInstance: missing,
      getActivityInstanceTree: () => ({
        id: "p1",
        activityId: ORDER,
        childActivityInstances: [
          { id: "timer:a1", activityId: "timer", activityType: "timer", executionIds: ["e1"] },
        ],
      }),
      getProcessInstanceVariables: () => ({ untyped: { value: "x" }, json: { type: "Json" } }),
      getJobs: () => [{ id: "j1", executionId: "e1", failedActivityId: "timer" }],
      getIncidents: () => [],
      getEventSubscriptions: () => [],
      getTasks: () => [],
      getExternalTasks: () => [],
      getJobDefinitions: () => [],
      getProcessDefinitions: () => [{ id: ORDER, key: "order", version: 2 }],
      queryHistoricActivityInstances: () => [],
    }).view

    expect(view?.waitingAt).toEqual([
      {
        kind: "timer",
        activityId: "timer",
        activityType: "timer",
        jobId: "j1",
        dueDate: "",
        retries: 0,
      },
    ])
    expect(view?.definition).toEqual({ id: ORDER, key: "order", version: 2 })
    expect(view?.timeline).toEqual([])
  })
})
