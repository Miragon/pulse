import { describe, expect, it } from "vitest"
import { endedBatchReport, queuedBatch, runningBatchReport } from "./batches.js"

describe("batch reports: queued is never done", () => {
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
