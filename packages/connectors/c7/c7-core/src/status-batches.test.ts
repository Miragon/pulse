import { describe, expect, it } from "vitest"
import { readStatus } from "./engine-status.js"
import { WorkflowError } from "./errors.js"
import { STATUS_OPERATIONS } from "./operations.js"
import { BATCH_REQUESTS, batchesCut, readBatches } from "./status-batches.js"
import { fakePort, type Route } from "./testing/fake-port.js"
import { NOW } from "./testing/status.js"

const OPTIONS = { keys: [], staleAfterMs: 300_000, maxGroups: 10 }

/** An engine that answers every status read with an empty list, the batch count 0, but `routes`. */
function engine(routes: Readonly<Record<string, Route>>) {
  const empty = Object.fromEntries(STATUS_OPERATIONS.map((id): [string, Route] => [id, () => []]))
  return fakePort({ ...empty, getBatchStatisticsCount: () => ({ count: 0 }), ...routes })
}

/** `failed` batches with failed jobs listed, `running` and `withFailures` counted. */
function batches(failed: number, running: number, withFailures: number) {
  return {
    getBatchStatistics: (input: { query: Readonly<Record<string, string | undefined>> }) =>
      Array.from({ length: Math.min(failed, Number(input.query.maxResults)) }, (_, index) => ({
        id: `b${index}`,
        type: "instance-migration",
        failedJobs: 1,
        batchJobDefinitionId: `jd-${index}`,
      })),
    getBatchStatisticsCount: (input: { query: Readonly<Record<string, string | undefined>> }) => ({
      count: input.query.withFailures === "true" ? withFailures : running,
    }),
  }
}

describe("the batches of the status", () => {
  it("counts the running batches and those with failed jobs, and lists the failed ones", async () => {
    const port = engine(batches(2, 7, 2))
    const data = await readStatus({ port, now: () => NOW }, OPTIONS)
    expect(data.batches).toEqual({ running: 7, withFailures: 2 })
    expect(data.truncated).toBeUndefined()
    expect(data.findings.map((finding) => finding.code)).toEqual([
      "BATCH_FAILURES",
      "BATCH_FAILURES",
    ])
    const sent = port.calls.filter((call) => call.operationId.startsWith("getBatchStatistics"))
    expect(sent).toEqual(BATCH_REQUESTS)
    expect(sent.map((call) => call.input.query)).toEqual([
      { maxResults: "100", withFailures: "true" },
      {},
      { withFailures: "true" },
    ])
  })

  it("names the cut where more batches hold failed jobs than the page loads", async () => {
    const data = await readStatus({ port: engine(batches(250, 300, 250)), now: () => NOW }, OPTIONS)
    expect(data.batches).toEqual({ running: 300, withFailures: 250 })
    expect(data.truncated).toEqual(["batches with failures: 100 of 250 loaded"])
    expect(data.findings.filter((finding) => finding.code === "BATCH_FAILURES")).toHaveLength(100)
    const full = await readStatus({ port: engine(batches(100, 100, 100)), now: () => NOW }, OPTIONS)
    expect(full.truncated).toBeUndefined()
  })

  it("names no cut where the page is not full, though a batch failed after it was read", async () => {
    // the page held every batch with failed jobs when it was read; the count, read beside it, one more
    const data = await readStatus({ port: engine(batches(3, 9, 4)), now: () => NOW }, OPTIONS)
    expect(data.batches).toEqual({ running: 9, withFailures: 4 })
    expect(data.truncated).toBeUndefined()
    expect(data.findings.filter((finding) => finding.code === "BATCH_FAILURES")).toHaveLength(3)
    expect(batchesCut(undefined)).toBeUndefined()
  })

  it("keeps the incidents of a failed batch's jobs out of the groups", async () => {
    const incident = {
      id: "i1",
      rootCauseIncidentId: "i1",
      incidentType: "failedJob",
      activityId: "x",
      jobDefinitionId: "jd-0",
      incidentTimestamp: "2026-01-01T11:00:00.000+0000",
    }
    const port = engine({ ...batches(1, 1, 1), getIncidents: () => [incident] })
    const data = await readStatus({ port, now: () => NOW }, OPTIONS)
    expect(data.incidents).toEqual([])
    expect(data.engine.version).toBeNull()
  })

  it("leaves out a listed batch without failed jobs, where an engine lists one", async () => {
    const listed = [
      { id: "b0", type: "instance-migration", failedJobs: 2 },
      { id: "b1", type: "instance-migration", failedJobs: 0, batchJobDefinitionId: "jd-1" },
    ]
    const incident = {
      id: "i1",
      rootCauseIncidentId: "i1",
      activityId: "x",
      jobDefinitionId: "jd-1",
    }
    const port = engine({ getBatchStatistics: () => listed, getIncidents: () => [incident] })
    const data = await readStatus({ port, now: () => NOW }, OPTIONS)
    const batchFindings = data.findings.filter((finding) => finding.code === "BATCH_FAILURES")
    expect(batchFindings.map((finding) => finding.message)).toEqual([
      "batch b0 (instance-migration): 2 failed jobs",
    ])
    // the incident of b1's job counts in the groups: b1 holds no failed job BATCH_FAILURES names
    expect(data.incidents.map((group) => group.count)).toEqual([1])
  })

  it("reads no batch for named keys: a batch belongs to no process", async () => {
    const port = engine(batches(1, 1, 1))
    const data = await readStatus({ port, now: () => NOW }, { ...OPTIONS, keys: ["order"] })
    expect(data.batches).toBeUndefined()
    expect(port.calls.some((call) => call.operationId.startsWith("getBatch"))).toBe(false)
  })

  it("reads a page that is no list as none", async () => {
    const read = await readBatches(engine({ getBatchStatistics: () => ({}) }))
    expect(read).toEqual({ failed: [], running: 0, withFailures: 0 })
  })

  it.each([
    ["no object", [], "batch statistics count is not an object"],
    ["no count", {}, "count is missing"],
    ["a count that is no number", { count: "4" }, "count is not a number"],
  ])(
    "fails a count answer with %s as the reason unexpected-answer",
    async (_kind, answer, problem) => {
      for (const withFailures of [false, true]) {
        const count = (input: { query: Readonly<Record<string, string | undefined>> }) =>
          (input.query.withFailures === "true") === withFailures ? answer : { count: 0 }
        const read = readStatus(
          { port: engine({ getBatchStatisticsCount: count }), now: () => NOW },
          OPTIONS,
        )
        await expect(read).rejects.toBeInstanceOf(WorkflowError)
        await expect(read).rejects.toMatchObject({
          reason: { kind: "unexpected-answer", operationId: "getBatchStatisticsCount", problem },
        })
      }
    },
  )
})
