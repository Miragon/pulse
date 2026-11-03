import { afterEach, describe, expect, it } from "vitest"
import {
  APPROVE_INCIDENT,
  approveRoutes,
  C,
  CHILD_DEF,
  historyDto,
  P,
} from "@miragon/pulse-engine-core/testing"
import {
  engineWith,
  errorText,
  fixtureEngine,
  inspect,
  stopFakeEngines,
} from "./composites.test-support.js"
import {
  MAX_INCIDENTS,
  MAX_TIMELINE_ENTRIES,
  MAX_VARIABLES,
  MAX_WAIT_STATES,
} from "./composites.js"
import { MAX_VARIABLE_VALUE_CHARS } from "../mcp/variable-truncation.js"

/** engine_inspect_process_instance on the wire (helpers: composites.test-support.ts). */

afterEach(stopFakeEngines)

describe("inspectForModel", () => {
  it("returns the inspect view of the verified fixture as data, without next steps", async () => {
    const engine = await engineWith({}, fixtureEngine(approveRoutes()))
    const view = await inspect(engine, {
      processInstanceId: P,
      includeVariables: true,
      includeStacktraces: true,
    })
    expect(view).toMatchObject({
      id: P,
      businessKey: "WF-1",
      definition: { key: "workflow-parent", version: 1 },
      state: "ACTIVE",
      waitingAt: [
        {
          processInstanceId: C,
          activityId: "approve",
          activityName: "Approve",
          kind: "userTask",
          taskId: "t1",
        },
      ],
      incidents: [
        {
          id: "i1",
          rootCause: "PropertyNotFoundException: missingBean",
          jobId: "j1",
          stacktrace:
            "org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: missingBean",
        },
      ],
      children: [{ id: C, parentId: P, key: "workflow-child", state: "ACTIVE" }],
      variables: { amount: 250 },
    })
    expect(view).not.toHaveProperty("next")
    const tasks = engine.requests.find((request) => request.path === "/task")
    expect(tasks?.query.processInstanceIdIn).toBe(`${P},${C}`)
    const variables = engine.requests.find((request) => request.path.endsWith("/variables"))
    expect(variables?.query.deserializeValues).toBe("false")
    const trace = engine.requests.find((request) => request.path === "/job/j1/stacktrace")
    expect(trace?.headers.accept).toBe("text/plain")
  })

  it("cuts a long string variable and adds the timeline when asked", async () => {
    const routes = {
      ...approveRoutes(),
      getProcessInstanceVariables: () => ({ text: { type: "String", value: "x".repeat(2500) } }),
    }
    const engine = await engineWith({}, fixtureEngine(routes))
    const view = await inspect(engine, {
      processInstanceId: P,
      includeVariables: true,
      includeHistory: true,
    })
    expect(view.variables?.text).toEqual({
      value: "x".repeat(MAX_VARIABLE_VALUE_CHARS),
      truncated: true,
      valueLength: 2500,
    })
    expect(view.timeline).toEqual([
      {
        activityId: "start",
        activityType: "startEvent",
        startTime: "2026-01-01T00:00:00.000+0000",
      },
    ])
  })

  it("keeps the newest 100 timeline entries and names the total in truncated", async () => {
    const activities = Array.from({ length: MAX_TIMELINE_ENTRIES + 30 }, (_, index) => ({
      activityId: `step${index}`,
      activityType: "serviceTask",
      startTime: "2026-01-01T00:00:00.000+0000",
    }))
    const engine = await engineWith(
      {},
      fixtureEngine({ ...approveRoutes(), getHistoricActivityInstances: () => activities }),
    )
    const view = await inspect(engine, { processInstanceId: P, includeHistory: true })
    expect(view.timeline).toHaveLength(MAX_TIMELINE_ENTRIES)
    expect(view.timeline?.[0]?.activityId).toBe("step30")
    expect(view.timeline?.at(-1)?.activityId).toBe("step129")
    expect(view.truncated).toEqual(["timeline: the newest 100 of 130 entries shown"])
  })

  it("caps an ended instance's variables at 100, each value cut like every read", async () => {
    const rows = Array.from({ length: MAX_VARIABLES + 5 }, (_, index) => ({
      name: `v${String(index).padStart(3, "0")}`,
      type: "String",
      value: index === 0 ? "x".repeat(2500) : "ok",
      activityInstanceId: P,
    }))
    const ended = {
      ...approveRoutes(),
      getProcessInstance: () => undefined,
      getHistoricProcessInstance: (input: { pathArgs: readonly string[] }) =>
        input.pathArgs[0] === P
          ? { ...historyDto, state: "COMPLETED", endTime: "2026-01-02T00:00:00.000+0000" }
          : undefined,
      getHistoricVariableInstances: () => rows,
    }
    const engine = await engineWith({}, fixtureEngine(ended))
    const view = await inspect(engine, { processInstanceId: P, includeVariables: true })
    expect(view.state).toBe("COMPLETED")
    // engine-core reads called instances from the running tree only: no claim about an ended one
    expect(view).not.toHaveProperty("children")
    expect(Object.keys(view.variables ?? {})).toHaveLength(MAX_VARIABLES)
    expect(view.variables?.v000).toMatchObject({ truncated: true, valueLength: 2500 })
    expect(view.variables).not.toHaveProperty("v100")
    expect(view.truncated).toEqual(["variables: 100 of 105 shown"])
    const read = engine.requests.find((request) => request.path === "/history/variable-instance")
    expect(read?.query.deserializeValues).toBe("false")
  })

  it("names a cut instance tree in truncated instead of engine-core's flag", async () => {
    const children = Array.from({ length: 101 }, (_, index) => ({
      id: `c${index}`,
      definitionId: CHILD_DEF,
      definitionKey: "workflow-child",
      suspended: false,
    }))
    const engine = await engineWith(
      {},
      fixtureEngine({
        ...approveRoutes(),
        getProcessInstances: (input) => (input.query.superProcessInstance === P ? children : []),
      }),
    )
    const view = await inspect(engine, { processInstanceId: P })
    expect(view.truncated).toEqual(["children: the called-instance tree was cut"])
  })

  it("condenses a stacktrace the way every other tool gives it to the model", async () => {
    const frames = Array.from(
      { length: 40 },
      (_, index) => `\tat org.camunda.bpm.engine.impl.Step${index}.run(Step.java:${index})`,
    )
    const raw = ["org.x.ProcessEngineException: outer", ...frames].join("\n")
    const engine = await engineWith(
      {},
      fixtureEngine({ ...approveRoutes(), getStacktrace: () => raw }),
    )
    const view = await inspect(engine, { processInstanceId: P, includeStacktraces: true })
    const trace = (view.incidents[0]?.stacktrace ?? "").split("\n")
    expect(trace[0]).toBe("org.x.ProcessEngineException: outer")
    expect(trace.length).toBeLessThan(frames.length)
    expect(trace.at(-1)).toMatch(/framework\/internal frames trimmed$/)
  })

  it("condenses the whole stacktrace, not engine-core's first 200 lines", async () => {
    const frames = Array.from(
      { length: 240 },
      (_, index) => `\tat org.springframework.Step${index}.run(Step.java:${index})`,
    )
    const raw = [
      "org.x.ProcessEngineException: outer",
      ...frames,
      "Caused by: com.acme.billing.InvoiceException: customer 42 has no billing address",
      "\tat com.acme.billing.InvoiceDelegate.execute(InvoiceDelegate.java:57)",
    ].join("\n")
    const engine = await engineWith(
      {},
      fixtureEngine({ ...approveRoutes(), getStacktrace: () => raw }),
    )
    const view = await inspect(engine, { processInstanceId: P, includeStacktraces: true })
    const trace = view.incidents[0]?.stacktrace ?? ""
    expect(trace).toContain(
      "Caused by: com.acme.billing.InvoiceException: customer 42 has no billing address",
    )
    expect(trace).toContain("at com.acme.billing.InvoiceDelegate.execute(InvoiceDelegate.java:57)")
    expect(view.incidents[0]?.rootCause).toBe(
      "InvoiceException: customer 42 has no billing address",
    )
  })

  it("shows the first 100 wait states and names the total in truncated", async () => {
    const tasks = Array.from({ length: MAX_WAIT_STATES + 5 }, (_, index) => ({
      id: `t${String(index).padStart(3, "0")}`,
      taskDefinitionKey: "approve",
      executionId: C,
      processInstanceId: C,
    }))
    const engine = await engineWith(
      {},
      fixtureEngine({ ...approveRoutes(), getTasks: () => tasks }),
    )
    const view = await inspect(engine, { processInstanceId: P })
    expect(view.waitingAt).toHaveLength(MAX_WAIT_STATES)
    expect(view.waitingAt.at(-1)).toMatchObject({ taskId: "t099" })
    expect(view.truncated).toEqual(["waitingAt: 100 of 105 shown"])
  })

  it("shows the 10 oldest root incidents, the ones with a root cause, and names the total", async () => {
    const incidents = Array.from({ length: MAX_INCIDENTS + 2 }, (_, index) => ({
      ...APPROVE_INCIDENT,
      id: `i${String(index).padStart(2, "0")}`,
      rootCauseIncidentId: `i${String(index).padStart(2, "0")}`,
      configuration: `j${index}`,
      incidentTimestamp: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000+0000`,
    }))
    const engine = await engineWith(
      {},
      fixtureEngine({
        ...approveRoutes(),
        getIncidents: (input) => (input.query.processInstanceId === C ? incidents : []),
      }),
    )
    const view = await inspect(engine, { processInstanceId: P })
    expect(view.incidents.map((incident) => incident.id)).toEqual(
      incidents.slice(0, MAX_INCIDENTS).map((incident) => incident.id),
    )
    expect(view.incidents.every((incident) => incident.rootCause !== undefined)).toBe(true)
    expect(view.truncated).toEqual(["incidents: 10 of 12 shown"])
  })

  it("words selection errors in the tool's parameters; an invalid one sends nothing", async () => {
    const two = {
      ...approveRoutes(),
      getHistoricProcessInstances: () => [
        { id: "a", state: "ACTIVE", businessKey: "B-1" },
        { id: "b", state: "COMPLETED", businessKey: "B-1" },
      ],
      getProcessInstances: () => [],
    }
    const ambiguous = await engineWith({}, fixtureEngine(two))
    expect(await errorText(ambiguous, { businessKey: "B-1" })).toBe(
      '[AMBIGUOUS_SELECTION] businessKey "B-1" matches 2 process instances: pass one as processInstanceId, narrow with processDefinitionKey, or take the most recently started with latest: true. Candidates, running before ended, the most recently started first (running ones without startTime last, in engine order): [{"id":"a","businessKey":"B-1","state":"ACTIVE"},{"id":"b","businessKey":"B-1","state":"COMPLETED"}]',
    )
    const none = await engineWith(
      {},
      fixtureEngine({ ...two, getHistoricProcessInstances: () => [] }),
    )
    expect(await errorText(none, { businessKey: "B-1" })).toBe(
      '[NOT_FOUND] No process instance with businessKey "B-1", running or in the history (engine fake). If the engine\'s history level is none, ended instances cannot be found.',
    )
    const invalid = await engineWith({})
    expect(
      await errorText(invalid, {
        processInstanceId: P,
        businessKey: "B-1",
      }),
    ).toBe(
      "[INVALID_SELECTION] processInstanceId excludes businessKey, processDefinitionKey and latest.",
    )
    expect(invalid.requests).toEqual([])
  })

  it("prints an engine failure of the first round as the client words it", async () => {
    const engine = await engineWith({}, () => ({
      status: 500,
      body: { type: "ProcessEngineException", message: "database down" },
    }))
    expect(await errorText(engine, { processInstanceId: P })).toBe(
      "[500 ProcessEngineException] database down (engine fake)",
    )
  })
})
