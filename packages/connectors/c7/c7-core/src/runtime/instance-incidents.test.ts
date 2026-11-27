import {
  BpmnProcessId,
  DefinitionId,
  type DefinitionRef,
  ElementId,
  IncidentId,
  InstanceId,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { MAX_STACKTRACE_LINES } from "../inspect.js"
import type { IncidentView, WaitState as InspectedWait } from "../types.js"
import { type IncidentFacts, incidentOf } from "./instance-incidents.js"
import type { InspectView } from "./instance-inspection.js"

const ORDER: DefinitionRef = {
  id: DefinitionId("order:1:d1"),
  bpmnProcessId: BpmnProcessId("order"),
  tenantId: null,
  version: 1,
}
const LABEL: DefinitionRef = { ...ORDER, id: DefinitionId("label:2:d2"), version: 2 }
const SINCE = "2026-10-21T18:44:04.613+0000"
const INCIDENT: IncidentView = {
  id: "i1",
  type: "failedJob",
  activityId: "Activity_Charge",
  message: "Payment service is down",
  since: SINCE,
}

function viewWaitingAt(waitingAt: readonly InspectedWait[]): InspectView {
  return {
    id: "p1",
    definition: { id: ORDER.id, key: "order", version: 1 },
    versions: new Map(),
    state: "ACTIVE",
    waitingAt,
    incidents: [],
    children: [],
    timeline: [],
    next: [],
  }
}

function facts(
  waitStates: readonly WaitState[] = [],
  waitingAt: readonly InspectedWait[] = [],
): IncidentFacts {
  return {
    view: viewWaitingAt(waitingAt),
    definitions: new Map([
      ["p1", ORDER],
      ["c1", LABEL],
    ]),
    waitStates,
  }
}

function waitOf(kind: "asyncContinuation" | "userTask", incidentId: string): WaitState {
  const base = {
    instanceId: InstanceId("p1"),
    elementId: ElementId("a"),
    incidentId: IncidentId(incidentId),
  }
  return kind === "userTask" ? { ...base, kind } : { ...base, kind, retriesLeft: 3 }
}

describe("incidentOf", () => {
  it("is raised in the inspected instance unless it names another, with its version", () => {
    expect(incidentOf(INCIDENT, facts())).toStrictEqual({
      id: "i1",
      instanceId: "p1",
      definition: ORDER,
      elementId: "Activity_Charge",
      type: "failedJob",
      message: "Payment service is down",
      createdAt: "2026-10-21T18:44:04.613Z",
    })
    expect(incidentOf({ ...INCIDENT, processInstanceId: "c1" }, facts())).toMatchObject({
      instanceId: "c1",
      definition: LABEL,
    })
  })

  it("is left out when the version of its instance is unknown", () => {
    expect(incidentOf({ ...INCIDENT, processInstanceId: "c9" }, facts())).toBeUndefined()
  })

  it("has an empty message when the engine names none", () => {
    const { message, ...withoutMessage } = INCIDENT

    expect(message).not.toBe("")
    expect(incidentOf(withoutMessage, facts())?.message).toBe("")
  })

  it("takes the retries left of the wait it blocks, when that wait counts them", () => {
    const blocking = [waitOf("asyncContinuation", "i0"), waitOf("asyncContinuation", "i1")]

    expect(incidentOf(INCIDENT, facts(blocking))?.retriesLeft).toBe(3)
    expect(incidentOf(INCIDENT, facts([waitOf("userTask", "i1")]))).not.toHaveProperty(
      "retriesLeft",
    )
    expect(incidentOf(INCIDENT, facts([waitOf("asyncContinuation", "i0")]))).not.toHaveProperty(
      "retriesLeft",
    )
  })

  it("names its job", () => {
    expect(
      incidentOf({ ...INCIDENT, jobId: "j1", externalTaskId: "x1" }, facts())?.job,
    ).toStrictEqual({
      id: "j1",
    })
  })

  it("names its external task with the topic of the wait it blocks", () => {
    const external = { ...INCIDENT, type: "failedExternalTask", externalTaskId: "x1" }
    const waits: InspectedWait[] = [
      { kind: "asyncContinuation", activityId: "a", incidentId: "i1", jobId: "j9", retries: 0 },
      {
        kind: "externalTask",
        activityId: "b",
        incidentId: "i0",
        externalTaskId: "x0",
        topic: "other",
      },
      {
        kind: "externalTask",
        activityId: "c",
        incidentId: "i1",
        externalTaskId: "x1",
        topic: "mail",
      },
    ]

    expect(incidentOf(external, facts([], waits))?.job).toStrictEqual({ id: "x1", type: "mail" })
    expect(incidentOf(external, facts([], waits.slice(0, 2)))?.job).toStrictEqual({ id: "x1" })
  })

  it("names no job when it has neither a job nor an external task", () => {
    expect(incidentOf(INCIDENT, facts())).not.toHaveProperty("job")
  })

  it("carries the stack trace the inspection read with its root cause", () => {
    const stacktrace = [
      "org.x.Boom: outer",
      "\tat a.b.C.run(C.java:1)",
      "Caused by: java.net.ConnectException: refused",
    ]

    expect(incidentOf({ ...INCIDENT, stacktrace }, facts())?.details).toStrictEqual({
      kind: "stacktrace",
      text: stacktrace.join("\n"),
      truncated: false,
      rootCause: "ConnectException: refused",
      rootCauseLine: 2,
    })
  })

  it("says the stack trace is cut when it holds as many lines as the inspection reads", () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => `\tat F${String(index)}`)
    const detailsOf = (count: number) =>
      incidentOf({ ...INCIDENT, stacktrace: lines(count) }, facts())?.details

    expect(detailsOf(MAX_STACKTRACE_LINES)?.truncated).toBe(true)
    expect(detailsOf(MAX_STACKTRACE_LINES - 1)?.truncated).toBe(false)
  })
})
