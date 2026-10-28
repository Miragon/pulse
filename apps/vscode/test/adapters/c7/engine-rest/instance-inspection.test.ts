import { describe, expect, test } from "vitest"
import { RestEngineClient } from "../../../../src/adapters/c7/engine-rest/index.js"
import { httpOver } from "../support/fake-engine.js"
import { engineFailure, fakeEngineRest, type RestRoute } from "../support/fake-engine-rest.js"

const SINCE = "2026-10-21T18:00:00.000+0000"
const LATER = "2026-10-21T19:00:00.000+0000"
const MISSING = engineFailure(404, "InvalidRequestException", "does not exist")
const ORDER = "order:1:d1"
const LABEL = "label:1:d2"
const LISTS = ["/incident", "/event-subscription", "/task", "/external-task", "/job"]
const DEFINITION_LISTS = ["/process-definition", "/job-definition", "/history/activity-instance"]

function get(path: string, answer: unknown, when?: RestRoute["when"]): RestRoute {
  return { route: `GET ${path}`, answer, ...(when === undefined ? {} : { when }) }
}

function where(name: string, value: string): RestRoute["when"] {
  return (url) => url.searchParams.get(name) === value
}

function emptyLists(paths = [...LISTS, ...DEFINITION_LISTS]): RestRoute[] {
  return paths.map((path) => get(path, []))
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

const RUNNING_TREE: readonly RestRoute[] = [
  get("/process-instance/p1", { id: "p1", definitionId: ORDER }),
  get("/history/process-instance/p1", history("p1", { businessKey: "ORD-1", startTime: SINCE })),
  get(
    "/process-instance",
    [{ id: "c1", definitionId: LABEL, suspended: true }],
    where("superProcessInstance", "p1"),
  ),
  get("/process-instance", [], where("superProcessInstance", "c1")),
  get("/process-instance/p1/activity-instances", ORDER_TREE),
  get("/process-instance/c1/activity-instances", LABEL_TREE),
  get(
    "/incident",
    [
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
    where("processInstanceId", "p1"),
  ),
  get(
    "/incident",
    [
      incident("i2", "i2", {
        incidentType: "failedJob",
        activityId: "print",
        processInstanceId: "c1",
        configuration: "j2",
      }),
    ],
    where("processInstanceId", "c1"),
  ),
  get(
    "/event-subscription",
    [
      {
        id: "s1",
        eventType: "message",
        eventName: "Cancel",
        activityId: "cancel",
        executionId: "e3",
      },
      { id: "s2", eventType: "compensate", activityId: "undo", executionId: "e3" },
    ],
    where("processInstanceId", "p1"),
  ),
  get("/event-subscription", [], where("processInstanceId", "c1")),
  get("/task", [
    { id: "t1", taskDefinitionKey: "review", executionId: "e1", created: SINCE, assignee: "demo" },
  ]),
  get("/external-task", [
    { id: "x1", activityId: "work", activityInstanceId: "work:a2", topicName: "work-topic" },
  ]),
  get("/job", [{ id: "j1" }], where("timers", "true")),
  get("/job", [
    { id: "j1", jobDefinitionId: "jd1", executionId: "e3", dueDate: LATER },
    { id: "j3", jobDefinitionId: "jd3", executionId: "e6", retries: 3 },
    { id: "j2", failedActivityId: "print", executionId: "c1", processInstanceId: "c1", retries: 0 },
  ]),
  get("/process-definition", [{ id: ORDER, key: "order", version: 1 }]),
  get(
    "/job-definition",
    [
      { id: "jd1", activityId: "timer" },
      { id: "jd3", activityId: "async" },
    ],
    where("processDefinitionId", ORDER),
  ),
  get("/job-definition", [], where("processDefinitionId", LABEL)),
  get(
    "/process-instance/p1/variables",
    new Response(
      '{"total":{"type":"Long","value":9007199254740993},"doc":{"type":"Json","value":"{}"}}',
    ),
  ),
  get("/history/activity-instance", [
    { activityId: "call", startTime: SINCE, calledProcessInstanceId: "c1", canceled: true },
  ]),
  get("/external-task/x1/errorDetails", new Response("Boom\n\tat Worker\n")),
  get("/job/j2/stacktrace", MISSING),
]

function inspect(routes: readonly RestRoute[], id = "p1") {
  return new RestEngineClient(httpOver(fakeEngineRest(routes))).inspect(id)
}

describe("inspecting an instance over REST", () => {
  test("finds where the tree waits, its root incidents and its called instances", async () => {
    const view = (await inspect(RUNNING_TREE))!

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
      ["i1", "x1", { lines: ["Boom", "\tat Worker"], truncated: false }],
      ["i2", "j2", undefined],
      ["i4", undefined, undefined],
    ])
    expect(view).toMatchObject({
      businessKey: "ORD-1",
      definition: { id: ORDER, key: "order", version: 1 },
      propagatedIncidents: 2,
      children: [{ id: "c1", parentId: "p1", key: "label", state: "SUSPENDED" }],
      calls: [{ activityId: "call", calledProcessInstanceId: "c1" }],
      timeline: [{ activityId: "call", startTime: SINCE, canceled: true }],
      variables: [
        { name: "total", valueJson: "9007199254740993" },
        { name: "doc", valueJson: '"{}"', type: "Json" },
      ],
    })
  })

  test("reads an ended instance from its history alone", async () => {
    const view = await inspect(
      [
        get("/process-instance/e1", MISSING),
        get(
          "/history/process-instance/e1",
          history("e1", { state: "COMPLETED", superProcessInstanceId: "p0" }),
        ),
        get("/history/variable-instance", [
          { name: "route", type: "String", value: "review", activityInstanceId: "e1" },
          { name: "local", type: "String", value: "x", activityInstanceId: "task:1" },
        ]),
        get("/history/activity-instance", []),
      ],
      "e1",
    )

    expect(view).toMatchObject({ state: "COMPLETED", parentId: "p0", waitingAt: [], children: [] })
    expect(view?.variables).toEqual([{ name: "route", valueJson: '"review"' }])
  })

  test("names the definition and the caller of an instance without history", async () => {
    const view = await inspect([
      get("/process-instance/p1", { id: "p1", definitionId: ORDER, businessKey: "K" }),
      get("/history/process-instance/p1", MISSING),
      get("/process-instance", [{ id: "p0" }], where("subProcessInstance", "p1")),
      get("/process-instance", []),
      get("/process-instance/p1/activity-instances", { id: "p1", activityId: ORDER }),
      get("/process-instance/p1/variables", {}),
      get("/process-definition", [{ id: ORDER, key: "order", version: 4 }]),
      ...emptyLists([...LISTS, "/job-definition", "/history/activity-instance"]),
    ])

    expect(view).toMatchObject({ businessKey: "K", parentId: "p0", definition: { version: 4 } })
  })

  test("reads an instance that ended between two reads as ended", async () => {
    let runtimeReads = 0
    const view = await inspect([
      get("/process-instance/p1", { id: "p1", definitionId: ORDER }, () => runtimeReads++ === 0),
      get("/process-instance/p1", MISSING),
      get("/history/process-instance/p1", history("p1", { state: "COMPLETED" })),
      get("/process-instance", []),
      get("/process-instance/p1/activity-instances", MISSING),
      get("/process-instance/p1/variables", engineFailure(500, "NullValueException", "gone")),
      get("/history/variable-instance", []),
      ...emptyLists(),
    ])

    expect(view).toMatchObject({ id: "p1", state: "COMPLETED", waitingAt: [] })
  })

  test("cuts the tree of called instances ten levels down and leaves out those that ended", async () => {
    const view = await inspect([
      get("/process-instance/p1", { id: "p1", definitionId: ORDER }),
      get("/history/process-instance/p1", history("p1")),
      get("/process-instance", [{ id: "c", definitionId: LABEL }]),
      get("/process-instance/p1/activity-instances", { id: "p1", activityId: ORDER }),
      get("/process-instance/c/activity-instances", MISSING),
      get("/process-instance/p1/variables", {}),
      ...emptyLists(),
    ])

    expect(view).toMatchObject({ truncated: true, children: [] })
  })

  test("fails when the engine fails to read the variables", async () => {
    const failing = get(
      "/process-instance/p1/variables",
      engineFailure(500, "ProcessEngineException", "down"),
    )
    const routes = RUNNING_TREE.filter(
      (route) => !/variables|errorDetails|stacktrace/.test(route.route),
    )
    await expect(inspect([...routes, failing])).rejects.toMatchObject({ status: 500 })
  })
})
