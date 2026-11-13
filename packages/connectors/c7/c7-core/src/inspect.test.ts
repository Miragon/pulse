import { describe, expect, it } from "vitest"
import { isWorkflowError, type WorkflowErrorReason } from "./errors.js"
import { BUILT_IN_INCIDENT_TYPES } from "./incident-recovery.js"
import {
  CAUSE_OPERATIONS,
  incidentCause,
  inspectInstance,
  instanceRequests,
  loadInstance,
  loadView,
} from "./inspect.js"
import { INSPECT_OPERATIONS, STATUS_OPERATIONS } from "./operations.js"
import { fakeFailure, fakePort, type Route } from "./testing/fake-port.js"
import { C, historyDto, P } from "./testing/fixture.js"
import { approveRoutes, STACKTRACE } from "./testing/inspect-routes.js"

const ALL = { variables: true, history: false, stacktrace: false }

async function rejection(promise: Promise<unknown>): Promise<WorkflowErrorReason> {
  try {
    await promise
  } catch (error) {
    if (isWorkflowError(error)) return error.reason
  }
  throw new Error("expected a WorkflowError")
}

const missing = () => {
  throw fakeFailure(404, "InvalidRequestException")
}

describe("instanceRequests", () => {
  it("reads runtime and history of an id", () => {
    expect(instanceRequests("p1").map((request) => request.operationId)).toEqual([
      "getProcessInstance",
      "getHistoricProcessInstance",
    ])
  })
})

describe("loadInstance", () => {
  it("loads the tree, the wait states, the root causes and the variables of a running instance", async () => {
    const port = fakePort(approveRoutes())
    const view = await loadInstance(port, P, ALL)
    expect(view).toMatchObject({
      id: P,
      state: "ACTIVE",
      waitingAt: [{ processInstanceId: C, activityId: "approve", kind: "userTask", taskId: "t1" }],
      incidents: [{ id: "i1", rootCause: "PropertyNotFoundException: missingBean" }],
      children: [{ id: C, parentId: P }],
      variables: { amount: 250 },
      next: [
        { action: "retry", processInstanceId: P },
        { action: "advance", processInstanceId: P },
      ],
    })
    const variables = port.calls.find((call) => call.operationId === "getProcessInstanceVariables")
    expect(variables?.input.query).toEqual({ deserializeValues: "false" })
  })

  it("adds the timeline and the stacktraces when asked", async () => {
    const view = await loadInstance(fakePort(approveRoutes()), P, {
      variables: false,
      history: true,
      stacktrace: true,
    })
    expect(view.timeline).toEqual([
      {
        activityId: "start",
        activityType: "startEvent",
        startTime: "2026-01-01T00:00:00.000+0000",
      },
    ])
    expect(view.incidents[0]?.stacktrace).toEqual(STACKTRACE.trimEnd().split("\n"))
    expect(view.variables).toBeUndefined()
  })

  it("loads an ended instance from the history with its historic variables", async () => {
    const ended = { ...historyDto, state: "COMPLETED", endTime: "2026-01-02T00:00:00.000+0000" }
    const port = fakePort({
      ...approveRoutes(),
      getProcessInstance: missing,
      getHistoricProcessInstance: () => ended,
      getHistoricVariableInstances: () => [
        { name: "amount", type: "Integer", value: 7, activityInstanceId: P },
      ],
    })
    const view = await loadInstance(port, P, { ...ALL, history: true })
    expect(view).toMatchObject({ state: "COMPLETED", waitingAt: [], variables: { amount: 7 } })
    expect(port.calls.map((call) => call.operationId)).not.toContain("getActivityInstanceTree")
  })

  it("is instance-missing for an id that neither runtime nor history know", async () => {
    const port = fakePort({ getProcessInstance: missing, getHistoricProcessInstance: missing })
    expect(await rejection(loadInstance(port, "nope", ALL))).toEqual({
      kind: "instance-missing",
      id: "nope",
    })
    expect(await loadView(port, "nope", ALL)).toEqual({ id: "nope", state: "ENDED" })
  })

  it("loads an instance that ended meanwhile once more, then as ended", async () => {
    let rounds = 0
    const routes: Record<string, Route> = {
      ...approveRoutes(),
      getProcessInstance: () => {
        rounds += 1
        return rounds === 1
          ? approveRoutes().getProcessInstance?.({ pathArgs: [P], query: {} })
          : undefined
      },
      getProcessInstanceVariables: () => {
        throw fakeFailure(500, "NullValueException")
      },
      getHistoricProcessInstance: () => ({ ...historyDto, state: "COMPLETED" }),
    }
    const view = await loadInstance(fakePort(routes), P, ALL)
    expect(rounds).toBe(2)
    expect(view.state).toBe("COMPLETED")
  })

  it("is instance-missing when the instance keeps ending between the rounds", async () => {
    const port = fakePort({
      ...approveRoutes(),
      getHistoricProcessInstance: missing,
      getActivityInstanceTree: missing,
    })
    expect(await rejection(loadInstance(port, P, ALL))).toEqual({ kind: "instance-missing", id: P })
  })

  it("rethrows every other failure", async () => {
    const port = fakePort({
      ...approveRoutes(),
      getProcessInstanceVariables: () => {
        throw fakeFailure(500, "ProcessEngineException")
      },
    })
    await expect(loadInstance(port, P, ALL)).rejects.toThrow("HTTP 500 ProcessEngineException")
    await expect(loadView(port, P, ALL)).rejects.toThrow("HTTP 500")
  })
})

describe("incidentCause", () => {
  const incident = (incidentType: string, configuration?: string) => ({
    id: "i",
    incidentType,
    incidentMessage: "the message",
    ...(configuration === undefined ? {} : { configuration }),
  })

  it("names the request of each built-in incident type, one the inspection and the status send", () => {
    expect([...CAUSE_OPERATIONS.keys()]).toEqual([...BUILT_IN_INCIDENT_TYPES])
    for (const operation of CAUSE_OPERATIONS.values()) {
      expect(INSPECT_OPERATIONS).toContain(operation)
      expect(STATUS_OPERATIONS).toContain(operation)
    }
  })

  it("reads the stacktrace of a failed job and the details of a failed external task", async () => {
    const lines = Array.from({ length: 250 }, (_, index) => `line ${index}`).join("\n")
    const port = fakePort({
      getStacktrace: () => `${STACKTRACE}${lines}\n`,
      getExternalTaskErrorDetails: () => "worker said no",
    })
    const job = await incidentCause(port, incident("failedJob", "j1"), true)
    expect(job.rootCause).toBe("PropertyNotFoundException: missingBean")
    expect(job.stacktrace).toHaveLength(200)
    expect(await incidentCause(port, incident("failedExternalTask", "e1"), false)).toEqual({
      rootCause: "worker said no",
    })
  })

  it("falls back to the incident message", async () => {
    const port = fakePort({ getStacktrace: () => "  " })
    expect(await incidentCause(port, incident("failedJob", "j1"), false)).toEqual({
      rootCause: "the message",
    })
    expect(await incidentCause(port, incident("custom", "x"), true)).toEqual({
      rootCause: "the message",
    })
    expect(await incidentCause(port, incident("failedJob"), false)).toEqual({
      rootCause: "the message",
    })
    expect(port.calls).toHaveLength(1)
  })
})

describe("inspectInstance", () => {
  it("selects the instance, then loads its view", async () => {
    const port = fakePort({
      ...approveRoutes(),
      getHistoricProcessInstances: () => [{ id: P, state: "ACTIVE" }],
      getProcessInstances: (input) =>
        input.query.businessKey === undefined
          ? (approveRoutes().getProcessInstances?.(input) ?? [])
          : [{ id: P }],
    })
    const view = await inspectInstance(port, { businessKey: "WF-1", latest: false }, ALL)
    expect(view.id).toBe(P)
    expect(port.calls.slice(0, 2).map((call) => call.operationId)).toEqual([
      "getHistoricProcessInstances",
      "getProcessInstances",
    ])
  })
})
