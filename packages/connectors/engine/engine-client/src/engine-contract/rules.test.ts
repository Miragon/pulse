import { describe, expect, it } from "vitest"
// Imported from the modules themselves, not ./index.js: the index also
// re-exports the SDK-bound reads, and loading the generated SDK would put its
// hundreds of wrappers into this package's coverage measurement.
import { endedBatchReport, queuedBatch, runningBatchReport } from "./batches.js"
import { BUILT_IN_INCIDENT_TYPES, incidentRecovery } from "./incidents.js"
import { engineSorting } from "./sorting.js"

describe("engineSorting — the engine takes sortBy and sortOrder only as a pair", () => {
  it("sorts ascending when only sortBy is given", () => {
    expect(engineSorting({ sortBy: "priority" })).toEqual({ sortBy: "priority", sortOrder: "asc" })
  })

  it("keeps an explicit direction", () => {
    expect(engineSorting({ sortBy: "created", sortOrder: "desc" })).toEqual({
      sortBy: "created",
      sortOrder: "desc",
    })
  })

  it("drops a lone sortOrder and sends nothing without sortBy", () => {
    expect(engineSorting({ sortOrder: "desc" })).toEqual({})
    expect(engineSorting({})).toEqual({})
  })
})

describe("incidentRecovery — built-in incidents are retried, never resolved", () => {
  it("names exactly the two engine-raised types", () => {
    expect(BUILT_IN_INCIDENT_TYPES).toEqual(["failedJob", "failedExternalTask"])
  })

  it("retries the failed job a failedJob incident points at", () => {
    expect(incidentRecovery({ incidentType: "failedJob", configuration: "job-1" })).toEqual({
      action: "retry-job",
      jobId: "job-1",
    })
  })

  it("retries the external task a failedExternalTask incident points at", () => {
    expect(
      incidentRecovery({ incidentType: "failedExternalTask", configuration: "ext-1" }),
    ).toEqual({ action: "retry-external-task", externalTaskId: "ext-1" })
  })

  it.each([null, undefined, ""])(
    "offers nothing for a built-in incident without configuration %j (propagated: act on the root cause)",
    (configuration) => {
      expect(incidentRecovery({ incidentType: "failedJob", configuration })).toEqual({
        action: "none",
      })
      expect(incidentRecovery({ incidentType: "failedExternalTask", configuration })).toEqual({
        action: "none",
      })
    },
  )

  it("resolves custom incident types", () => {
    expect(incidentRecovery({ incidentType: "invoiceMismatch", configuration: "x" })).toEqual({
      action: "resolve",
    })
    expect(incidentRecovery({ incidentType: null })).toEqual({ action: "resolve" })
  })
})

describe("batch reports — queued is never done", () => {
  it("hands back the id and status queued instead of a success flag", () => {
    const queued = queuedBatch({ id: "b-1", type: "set-job-retries", totalJobs: 3 })
    expect(queued).toEqual({
      batchId: "b-1",
      status: "queued",
      type: "set-job-retries",
      totalJobs: 3,
    })
    expect(queued).not.toHaveProperty("success")
    expect(queuedBatch({})).toEqual({ batchId: "", status: "queued", type: null, totalJobs: null })
  })

  const stats = {
    id: "b-1",
    type: "instance-migration",
    totalJobs: 10,
    remainingJobs: 4,
    completedJobs: 6,
    failedJobs: 0,
    suspended: false,
    startTime: "2026-10-09T09:30:45.664+0000",
  }

  it("reports a running batch with its counts", () => {
    expect(runningBatchReport(stats)).toEqual({
      batchId: "b-1",
      type: "instance-migration",
      status: "running",
      totalJobs: 10,
      remainingJobs: 4,
      completedJobs: 6,
      failedJobs: 0,
      startTime: "2026-10-09T09:30:45.664+0000",
      endTime: null,
    })
  })

  it("flags failed batch jobs as failing and suspension as suspended", () => {
    expect(runningBatchReport({ ...stats, failedJobs: 2 }).status).toBe("failing")
    expect(runningBatchReport({ ...stats, failedJobs: 2, suspended: true }).status).toBe(
      "suspended",
    )
    expect(runningBatchReport({}).status).toBe("running")
    expect(runningBatchReport({})).toMatchObject({ batchId: "", failedJobs: 0, totalJobs: null })
  })

  it("reports an ended batch from its history record", () => {
    expect(
      endedBatchReport({
        id: "b-1",
        type: "set-job-retries",
        totalJobs: 1,
        startTime: "2026-10-09T09:30:45.664+0000",
        endTime: "2026-10-09T09:30:45.684+0000",
      }),
    ).toEqual({
      batchId: "b-1",
      type: "set-job-retries",
      status: "completed",
      totalJobs: 1,
      remainingJobs: null,
      completedJobs: null,
      failedJobs: null,
      startTime: "2026-10-09T09:30:45.664+0000",
      endTime: "2026-10-09T09:30:45.684+0000",
    })
    expect(endedBatchReport({ id: "b-2" })).toMatchObject({ status: "running", endTime: null })
  })
})
