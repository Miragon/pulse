import { describe, expect, it } from "vitest"
import { isWorkflowError, type WorkflowErrorReason } from "./errors.js"
import {
  checkRetryCount,
  executeWrite,
  missingRoots,
  planRetry,
  retriesWrite,
  retryEffect,
  retryMode,
  retryPlanView,
} from "./retry-plan.js"

function reasonOf(fn: () => unknown): WorkflowErrorReason {
  try {
    fn()
  } catch (error) {
    if (isWorkflowError(error)) return error.reason
  }
  throw new Error("expected a WorkflowError")
}

const incident = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  rootCauseIncidentId: id,
  incidentType: "failedJob",
  activityId: "book",
  processInstanceId: "p1",
  configuration: `j-${id}`,
  incidentTimestamp: `2026-01-01T00:00:0${id}.000+0000`,
  ...overrides,
})

describe("retryMode and retryEffect", () => {
  it("selects exactly one mode", () => {
    expect(retryMode({ id: "p", latest: false }, [])).toBe("instance")
    expect(retryMode({ latest: false }, ["i1"])).toBe("incidents")
    expect(retryMode({ processDefinitionKey: "k", latest: false }, [])).toBe("definition")
    expect([retryEffect("definition"), retryEffect("instance")]).toEqual(["bulk", "write"])
    expect(reasonOf(() => retryMode({ id: "p", latest: false }, ["i1"]))).toEqual({
      kind: "retry-selection-conflict",
    })
    expect(reasonOf(() => retryMode({ latest: false }, []))).toEqual({
      kind: "retry-selection-missing",
    })
  })
})

describe("planRetry", () => {
  it("retries root causes once, filtered, by time; skips what it cannot fix", () => {
    const incidents = [
      incident("2"),
      incident("3", { rootCauseIncidentId: "2" }),
      incident("1", { incidentType: "failedExternalTask", configuration: "e1", activityId: "pay" }),
      incident("4", { incidentType: "custom", incidentMessage: "m" }),
      incident("5", { rootCauseIncidentId: "9" }),
    ]
    const entries = planRetry(incidents, {})
    expect(entries.map((entry) => [entry.incidentId, entry.action])).toEqual([
      ["1", "externalTask"],
      ["2", "job"],
      ["4", "skip"],
    ])
    expect(planRetry(incidents, { activityId: "pay" }).map((entry) => entry.incidentId)).toEqual([
      "1",
    ])
    expect(planRetry(incidents, { incidentType: "custom" })).toMatchObject([{ message: "m" }])
    expect(missingRoots(incidents)).toEqual(["9"])
    const [external, job, skipped] = entries
    expect([external && retriesWrite(external, 2), job && retriesWrite(job, 1)]).toEqual([
      {
        label: "set the retries of external task e1 to 2",
        operationId: "setExternalTaskResourceRetries",
        input: { pathArgs: ["e1"], query: {}, body: { retries: 2 } },
      },
      {
        label: "set the retries of job j-2 to 1",
        operationId: "setJobRetries",
        input: { pathArgs: ["j-2"], query: {}, body: { retries: 1 } },
      },
    ])
    expect(skipped && retriesWrite(skipped, 1)).toBeUndefined()
    expect(job && executeWrite(job)).toEqual({
      label: "execute job j-2",
      operationId: "executeJob",
      input: { pathArgs: ["j-2"], query: {} },
    })
    expect(external && executeWrite(external)).toBeUndefined()
    expect(retryPlanView("instance", entries)).toEqual({
      mode: "instance",
      incidents: 3,
      jobs: 1,
      externalTasks: 1,
      skipped: [
        { incidentId: "4", type: "custom", next: { action: "resolveIncident", incidentId: "4" } },
      ],
    })
  })

  it("refuses more than 1000 retries or a truncated list", () => {
    const entries = planRetry(
      Array.from({ length: 1001 }, (_, index) =>
        incident(String(index), { incidentTimestamp: "t" }),
      ),
      {},
    )
    expect(
      reasonOf(() => {
        checkRetryCount(entries, false, "order")
      }),
    ).toEqual({
      kind: "retry-too-many",
      max: 1000,
      processDefinitionKey: "order",
    })
    expect(
      reasonOf(() => {
        checkRetryCount([], true, undefined)
      }),
    ).toEqual({
      kind: "retry-too-many",
      max: 1000,
    })
    expect(() => {
      checkRetryCount(entries.slice(0, 1000), false, undefined)
    }).not.toThrow()
  })
})
