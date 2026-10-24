/** The details of instanceView (snapshot.ts) beyond the verified fixture. */

import { describe, expect, it } from "vitest"
import {
  activeData,
  activity,
  activityTree,
  C,
  CHILD_DEF,
  CHILD_NODE,
  endedStage,
  P,
  PARENT_DEF,
  ROOT_NODE,
} from "../../test/support/workflow-fixture.js"
import { instanceView } from "./snapshot.js"

describe("instanceView details", () => {
  it("sorts incidents by time and id, children by depth, key and id", () => {
    const incident = (id: string, since: string) => ({
      id,
      rootCauseIncidentId: id,
      incidentType: "x",
      activityId: "a",
      processInstanceId: P,
      incidentTimestamp: since,
    })
    const node = (id: string, key: string, depth: number) => ({
      id,
      parentId: P,
      definitionId: `${key}:1:x`,
      definitionKey: key,
      suspended: false,
      depth,
    })
    const view = instanceView(
      activeData({
        incidents: [
          incident("b", "2026-01-01T00:00:01.000+0000"),
          incident("c", "2026-01-01T00:00:00.000+0000"),
          incident("a", "2026-01-01T00:00:01.000+0000"),
        ],
        tree: [
          ROOT_NODE,
          node("z", "beta", 2),
          node("y", "beta", 1),
          node("x", "alpha", 1),
          node("w", "beta", 1),
        ],
      }),
    )
    expect(view.incidents.map((entry) => entry.id)).toEqual(["c", "a", "b"])
    expect(view.children.map((child) => child.id)).toEqual(["x", "w", "y", "z"])
  })

  it("marks boundary events with attachedTo, ignores compensation, keeps conditional events", () => {
    const data = activeData({
      activityTrees: [
        activityTree(P, PARENT_DEF, [
          activity("review:ai", "review", "userTask", ["ex-review", "name=Review"]),
          activity("cond:ai", "cond", "intermediateConditional", ["ex-cond"]),
        ]),
      ],
      tasks: [
        {
          id: "t1",
          taskDefinitionKey: "review",
          executionId: "ex-review",
          processInstanceId: P,
          assignee: "demo",
          due: "2026-10-10T00:00:00.000+0000",
        },
      ],
      jobs: [
        {
          id: "j-boundary",
          jobDefinitionId: "jd-boundary",
          processInstanceId: P,
          executionId: "ex-review",
          retries: 3,
          dueDate: "2026-10-10T00:00:00.000+0000",
        },
      ],
      timerJobIds: new Set(["j-boundary"]),
      jobDefinitions: [{ id: "jd-boundary", activityId: "reminder" }],
      subscriptions: [
        {
          id: "s-comp",
          eventType: "compensate",
          executionId: "ex-review",
          processInstanceId: P,
          activityId: "undo",
        },
        {
          id: "s-cond",
          eventType: "conditional",
          executionId: "ex-cond",
          processInstanceId: P,
          activityId: "cond",
        },
        {
          id: "s-start",
          eventType: "message",
          eventName: "Cancel",
          executionId: P,
          processInstanceId: P,
          activityId: "cancel-start",
        },
      ],
    })
    const waits = instanceView(data).waitingAt
    expect(waits.map((wait) => [wait.activityId, wait.kind, wait.attachedTo])).toEqual([
      ["cancel-start", "message", undefined],
      ["cond", "conditional", undefined],
      ["reminder", "timer", "review"],
      ["review", "userTask", undefined],
    ])
    expect(waits.find((wait) => wait.kind === "userTask")).toMatchObject({
      assignee: "demo",
      due: "2026-10-10T00:00:00.000+0000",
      activityName: "Review",
    })
    expect(instanceView(data).next).toEqual([
      `pulse-cli advance ${P} --activity-id cancel-start`,
      `pulse-cli advance ${P} --activity-id reminder`,
    ])
  })

  it("counts propagated incidents and names the instance of a root cause in a called instance", () => {
    const data = activeData({
      tree: [ROOT_NODE, CHILD_NODE],
      activityTrees: [
        activityTree(P, PARENT_DEF, [
          activity("call:ai", "call-approval", "callActivity", ["ex-call"]),
        ]),
        activityTree(C, CHILD_DEF, []),
      ],
      incidents: [
        {
          id: "inc-p",
          rootCauseIncidentId: "inc-c",
          incidentType: "failedExternalTask",
          activityId: "call-approval",
          processInstanceId: P,
          incidentTimestamp: "2026-01-01T00:00:01.000+0000",
        },
        {
          id: "inc-c",
          rootCauseIncidentId: "inc-c",
          incidentType: "failedExternalTask",
          activityId: "charge",
          processInstanceId: C,
          configuration: "et-9",
          incidentMessage: "Card declined",
          incidentTimestamp: "2026-01-01T00:00:00.000+0000",
          annotation: "Mail sent",
        },
      ],
      causes: new Map([["inc-c", { rootCause: "Card declined", stacktrace: ["a", "b"] }]]),
      parentId: "grand",
      history: {
        ...activeData().history,
        superProcessInstanceId: null,
        rootProcessInstanceId: "grand-root",
      },
      truncated: true,
    })
    const view = instanceView(data)
    expect(view.incidents).toEqual([
      {
        id: "inc-c",
        type: "failedExternalTask",
        activityId: "charge",
        processInstanceId: C,
        message: "Card declined",
        // a root cause equal to the message is left out
        externalTaskId: "et-9",
        since: "2026-01-01T00:00:00.000+0000",
        annotation: "Mail sent",
        stacktrace: ["a", "b"],
      },
    ])
    expect(view).toMatchObject({
      propagatedIncidents: 1,
      truncated: true,
      parentId: "grand",
      rootId: "grand-root",
    })
    expect(view.waitingAt).toEqual([])
  })

  it("takes the definition from the definition list without a history record", () => {
    const { history: _, ...data } = activeData({
      runtime: { id: P, definitionId: CHILD_DEF, businessKey: "B", suspended: true },
    })
    const view = instanceView(data)
    expect(view).toMatchObject({
      businessKey: "B",
      state: "SUSPENDED",
      definition: { key: "workflow-child", version: 1, name: "Child", id: CHILD_DEF },
    })
    const unknown = instanceView({
      ...data,
      runtime: { id: P, definitionId: "other:3:x" },
      definitions: [],
    })
    expect(unknown.definition).toEqual({ key: "other", id: "other:3:x" })
  })

  it("adds the timeline with the historic incidents of its activities", () => {
    const view = instanceView({
      ...endedStage(),
      timeline: [
        {
          activityId: "start",
          activityType: "startEvent",
          startTime: "2026-10-09T13:38:15.430+0000",
          endTime: "2026-10-09T13:38:15.430+0000",
          durationInMillis: 0,
        },
        {
          activityId: "book",
          activityType: "serviceTask",
          startTime: "2026-10-09T13:38:48.325+0000",
          durationInMillis: 1,
          canceled: true,
          assignee: "x",
          calledProcessInstanceId: "c",
        },
      ],
      historicIncidents: [
        {
          id: "h1",
          incidentType: "failedJob",
          activityId: "book",
          incidentMessage: "boom",
          createTime: "2026-10-09T13:38:39.877+0000",
          open: false,
          resolved: true,
          deleted: false,
        },
      ],
      historyRequested: true,
    })
    expect(view.timeline).toEqual([
      {
        activityId: "start",
        activityType: "startEvent",
        startTime: "2026-10-09T13:38:15.430+0000",
        endTime: "2026-10-09T13:38:15.430+0000",
        durationMs: 0,
      },
      {
        activityId: "book",
        activityType: "serviceTask",
        startTime: "2026-10-09T13:38:48.325+0000",
        durationMs: 1,
        canceled: true,
        assignee: "x",
        calledProcessInstanceId: "c",
        incidents: [{ type: "failedJob", message: "boom", state: "resolved" }],
      },
    ])
  })
})
