import { BpmnProcessId, DefinitionId, type DefinitionRef } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import type { WaitState as InspectedWait } from "../types.js"
import { instanceDetailOf } from "./instance-detail.js"
import type { InspectView } from "./instance-inspection.js"
import type { VariableRow } from "./variable-instances.js"

const T0 = "2026-10-21T18:44:04.586+0000"
const T1 = "2026-10-21T18:44:05.000+0000"
const ORDER: DefinitionRef = {
  id: DefinitionId("order:1:d1"),
  bpmnProcessId: BpmnProcessId("order"),
  version: 1,
  name: "Order",
}
const VIEW: InspectView = {
  id: "p1",
  definition: { id: "order:1:d1", key: "order", version: 1, name: "Order" },
  versions: new Map(),
  state: "ACTIVE",
  waitingAt: [],
  incidents: [],
  children: [],
  timeline: [],
  next: [],
}

function detailOf(view: Partial<InspectView>, typed?: readonly VariableRow[]) {
  return instanceDetailOf({ ...VIEW, ...view }, new Map([["p1", ORDER]]), typed)
}

function waitOf(wait: InspectedWait) {
  return detailOf({ waitingAt: [wait] }).waitStates[0]
}

describe("instanceDetailOf: the instance", () => {
  it("is summarised with its version, state, business key, times and parent", () => {
    const detail = detailOf({ businessKey: "ORD-1", startTime: T0, endTime: T1, parentId: "p0" })

    expect(detail.instance).toStrictEqual({
      id: "p1",
      definition: ORDER,
      state: "running",
      hasIncident: false,
      businessKey: "ORD-1",
      startedAt: "2026-10-21T18:44:04.586Z",
      endedAt: "2026-10-21T18:44:05.000Z",
      parentInstanceId: "p0",
    })
    expect(detailOf({ state: "COMPLETED" }).instance).toStrictEqual({
      id: "p1",
      definition: ORDER,
      state: "completed",
      hasIncident: false,
    })
  })

  it.each([
    [
      "an incident of its own",
      { incidents: [{ id: "i9", type: "x", activityId: "a", since: T0 }] },
    ],
    ["an incident copied up from a called instance", { propagatedIncidents: 1 }],
  ])("has an incident with %s", (_name, view) => {
    expect(detailOf(view).instance.hasIncident).toBe(true)
  })

  it("has none when no incident is copied up", () => {
    expect(detailOf({ propagatedIncidents: 0 }).instance.hasIncident).toBe(false)
  })
})

describe("instanceDetailOf: the path", () => {
  it("is the history's steps, each with its element, times and whether it was cancelled", () => {
    const detail = detailOf({
      timeline: [
        {
          activityId: "start",
          activityName: "Start",
          activityType: "startEvent",
          startTime: T0,
          endTime: T0,
        },
        { activityId: "call", activityType: "callActivity", startTime: T1, canceled: true },
      ],
    })

    expect(detail.path).toStrictEqual([
      {
        elementId: "start",
        startedAt: "2026-10-21T18:44:04.586Z",
        canceled: false,
        elementName: "Start",
        endedAt: "2026-10-21T18:44:04.586Z",
      },
      { elementId: "call", startedAt: "2026-10-21T18:44:05.000Z", canceled: true },
    ])
  })
})

describe("instanceDetailOf: the wait states", () => {
  const base = { activityId: "a", activityName: "A", since: T0 }
  const said = {
    instanceId: "p1",
    elementId: "a",
    elementName: "A",
    since: "2026-10-21T18:44:04.586Z",
  }

  it("say the called instance, the element a boundary event is attached to and the incident", () => {
    expect(
      waitOf({
        kind: "message",
        activityId: "cancel",
        processInstanceId: "c1",
        attachedTo: "review",
        incidentId: "i1",
        eventSubscriptionId: "s1",
        executionId: "e1",
      }),
    ).toStrictEqual({
      instanceId: "c1",
      elementId: "cancel",
      attachedToElementId: "review",
      incidentId: "i1",
      kind: "message",
    })
  })

  it("read a user task with its assignee and due date", () => {
    expect(
      waitOf({ ...base, kind: "userTask", taskId: "t1", assignee: "demo", due: T1 }),
    ).toStrictEqual({
      ...said,
      kind: "userTask",
      assignee: "demo",
      dueAt: "2026-10-21T18:44:05.000Z",
    })
    expect(waitOf({ ...base, kind: "userTask", taskId: "t1" })).toStrictEqual({
      ...said,
      kind: "userTask",
    })
  })

  it("read an external task as a worker task with its topic and retries left", () => {
    const task = { ...base, kind: "externalTask", externalTaskId: "x1", topic: "mail" } as const

    expect(waitOf({ ...task, retries: 2 })).toStrictEqual({
      ...said,
      kind: "workerTask",
      taskType: "mail",
      retriesLeft: 2,
    })
    expect(waitOf(task)).toStrictEqual({ ...said, kind: "workerTask", taskType: "mail" })
  })

  it("read an async continuation with its retries left", () => {
    expect(waitOf({ ...base, kind: "asyncContinuation", jobId: "j1", retries: 0 })).toStrictEqual({
      ...said,
      kind: "asyncContinuation",
      retriesLeft: 0,
    })
  })

  it("read a timer with its due date, none when the engine names none", () => {
    const timer = { ...base, kind: "timer", jobId: "j1", retries: 3 } as const

    expect(waitOf({ ...timer, dueDate: T1 })).toStrictEqual({
      ...said,
      kind: "timer",
      dueAt: "2026-10-21T18:44:05.000Z",
    })
    expect(waitOf({ ...timer, dueDate: "" })).toStrictEqual({ ...said, kind: "timer" })
  })

  it("read a message and a signal with the event's name", () => {
    const event = { ...base, eventSubscriptionId: "s1", executionId: "e1" }

    expect(waitOf({ ...event, kind: "message", eventName: "Paid" })).toStrictEqual({
      ...said,
      kind: "message",
      messageName: "Paid",
    })
    expect(waitOf({ ...event, kind: "signal", eventName: "Stop" })).toStrictEqual({
      ...said,
      kind: "signal",
      signalName: "Stop",
    })
    expect(waitOf({ ...event, kind: "signal" })).toStrictEqual({ ...said, kind: "signal" })
  })

  it("read any other wait as other, described by its activity type, else its kind", () => {
    const event = { ...base, eventSubscriptionId: "s1", executionId: "e1" }

    expect(
      waitOf({ ...base, kind: "other", executionId: "e1", activityType: "manualTask" }),
    ).toStrictEqual({
      ...said,
      kind: "other",
      description: "manualTask",
    })
    expect(waitOf({ ...event, kind: "conditional" })).toStrictEqual({
      ...said,
      kind: "other",
      description: "conditional",
    })
  })
})

describe("instanceDetailOf: what it holds", () => {
  it("holds the root incidents of known versions, the called instances and the variables", () => {
    const detail = detailOf(
      {
        incidents: [
          { id: "i1", type: "failedJob", activityId: "a", since: T0, jobId: "j1" },
          { id: "i2", type: "failedJob", activityId: "b", since: T0, processInstanceId: "c9" },
        ],
        children: [{ id: "c1", parentId: "p1", key: "label", state: "ACTIVE" }],
        timeline: [
          {
            activityId: "call",
            activityType: "callActivity",
            startTime: T0,
            calledProcessInstanceId: "c1",
          },
        ],
      },
      [{ name: "amount", valueJson: "1" }],
    )

    expect(detail.incidents.map((incident) => incident.id)).toStrictEqual(["i1"])
    expect(detail.calledInstances).toStrictEqual([
      {
        id: "c1",
        parentInstanceId: "p1",
        bpmnProcessId: "label",
        state: "running",
        calledFromElementId: "call",
      },
    ])
    expect(detail.variables.map((variable) => variable.name)).toStrictEqual(["amount"])
    expect(detail.truncated).toBe(false)
  })

  it("takes the retries of a wait the incident blocks", () => {
    const detail = detailOf({
      waitingAt: [
        { kind: "asyncContinuation", activityId: "a", incidentId: "i1", jobId: "j1", retries: 0 },
      ],
      incidents: [{ id: "i1", type: "failedJob", activityId: "a", since: T0, jobId: "j1" }],
    })

    expect(detail.incidents[0]?.retriesLeft).toBe(0)
  })

  it("is cut when the inspection was, or when it read as many typed variables as it asks for", () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `v${String(index)}`, valueJson: "1" }))

    expect(detailOf({ truncated: true }).truncated).toBe(true)
    expect(detailOf({}, rows(500)).truncated).toBe(true)
    expect(detailOf({}, rows(499)).truncated).toBe(false)
    expect(detailOf({ state: "SUSPENDED" }, rows(500)).truncated).toBe(true)
  })
})
