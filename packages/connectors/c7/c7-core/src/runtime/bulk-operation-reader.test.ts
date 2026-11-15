import { BulkOperationId, RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { BulkOperationReader } from "./bulk-operation-reader.js"

const BATCH = BulkOperationId("c7736a0b-cf02-11f1-b08e-3a9a38134a51")
const FIELDS = {
  id: BATCH,
  type: "instance-deletion",
  totalJobs: 3,
  invocationsPerBatchJob: 1,
  startTime: "2026-10-23T16:57:06.830+0000",
}
const MIGRATION = {
  ...FIELDS,
  type: "instance-migration",
  totalJobs: 5,
  batchJobDefinitionId: "aa8534a9-cf22-11f1-abf2-ce3814910ef6",
}

function running(fields: Record<string, unknown>): Route {
  return () => [{ ...FIELDS, suspended: false, completedJobs: 0, failedJobs: 0, ...fields }]
}

function readerOver(routes: Readonly<Record<string, Route>>) {
  const port = fakePort(routes)
  return { port, reader: new BulkOperationReader(port) }
}

describe("BulkOperationReader.read", () => {
  it("reads a running batch from its statistics, counting items, not jobs", async () => {
    const { reader } = readerOver({
      getBatchStatistics: running({
        invocationsPerBatchJob: 2,
        totalJobs: 2,
        completedJobs: 1,
        failedJobs: 1,
      }),
    })

    expect(await reader.read(BATCH)).toStrictEqual({
      id: BATCH,
      kind: "cancelInstances",
      total: 4,
      startedAt: "2026-10-23T16:57:06.830Z",
      state: "running",
      completed: 2,
      failed: 2,
    })
  })

  it("caps the items done and failed at the total, since the last job may hold fewer", async () => {
    const { reader } = readerOver({
      getBatchStatistics: running({
        invocationsPerBatchJob: 4,
        totalJobs: 1,
        completedJobs: 2,
        failedJobs: 3,
      }),
    })

    expect(await reader.read(BATCH)).toMatchObject({ total: 4, completed: 4, failed: 4 })
  })

  it("reads a suspended batch as suspended and one without a start without startedAt", async () => {
    const { reader } = readerOver({
      getBatchStatistics: () => [
        { ...FIELDS, startTime: null, suspended: true, completedJobs: 0, failedJobs: 0 },
      ],
    })

    expect(await reader.read(BATCH)).toStrictEqual({
      id: BATCH,
      kind: "cancelInstances",
      total: 3,
      state: "suspended",
      completed: 0,
      failed: 0,
    })
  })

  it("reads a migration batch as a migration", async () => {
    const { reader } = readerOver({
      getBatchStatistics: () => [
        { ...MIGRATION, suspended: false, completedJobs: 1, failedJobs: 4 },
      ],
    })

    expect(await reader.read(BATCH)).toMatchObject({
      kind: "migrateInstances",
      state: "running",
      total: 5,
      completed: 1,
      failed: 4,
    })
  })

  it("reads a batch that left the runtime from its history, without counts", async () => {
    const { port, reader } = readerOver({
      getBatchStatistics: () => [],
      getHistoricBatch: () => ({ ...FIELDS, endTime: "2026-10-23T16:57:06.894+0000" }),
    })

    expect(await reader.read(BATCH)).toStrictEqual({
      id: BATCH,
      kind: "cancelInstances",
      total: 3,
      startedAt: "2026-10-23T16:57:06.830Z",
      state: "ended",
      endedAt: "2026-10-23T16:57:06.894Z",
    })
    expect(port.calls.map((call) => call.operationId)).toStrictEqual([
      "getBatchStatistics",
      "getHistoricBatch",
    ])
    expect(port.calls[1]?.input.pathArgs).toStrictEqual([BATCH])
  })

  it("reads a batch of the history without an end as ended, without endedAt", async () => {
    const { reader } = readerOver({ getBatchStatistics: () => [], getHistoricBatch: () => FIELDS })

    expect(await reader.read(BATCH)).toStrictEqual({
      id: BATCH,
      kind: "cancelInstances",
      total: 3,
      startedAt: "2026-10-23T16:57:06.830Z",
      state: "ended",
    })
  })

  it("knows no batch that is neither running nor in the history", async () => {
    const { reader } = readerOver({
      getBatchStatistics: () => [],
      getHistoricBatch: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
    })

    expect(await reader.read(BATCH)).toBeUndefined()
  })

  it("knows no batch of another type, running or in the history", async () => {
    const other = readerOver({ getBatchStatistics: running({ type: "set-job-retries" }) })
    const ended = readerOver({
      getBatchStatistics: () => [],
      getHistoricBatch: () => ({ ...FIELDS, type: "set-job-retries" }),
    })

    expect(await other.reader.read(BATCH)).toBeUndefined()
    expect(await ended.reader.read(BATCH)).toBeUndefined()
  })

  it("refuses an id no engine assigns as misconfigured, before a request leaves", async () => {
    const { port, reader } = readerOver({})

    const error = await reader.read(BulkOperationId("b 1")).catch((caught: unknown) => caught)

    expect(RuntimeError.is(error) && error.failure).toBe("misconfigured")
    expect(port.calls).toStrictEqual([])
  })
})

describe("BulkOperationReader.failures", () => {
  it("names the failed instances and why, on one line and cut to 300 characters", async () => {
    const long = `ENGINE-23003 Process instance 'nope-9' cannot be migrated. ${"x".repeat(400)}`
    const { port, reader } = readerOver({
      getBatchStatistics: () => [
        { ...MIGRATION, suspended: false, completedJobs: 1, failedJobs: 3 },
      ],
      getJobs: () => [
        {
          id: "job-1",
          exceptionMessage:
            "ENGINE-23004 Cannot migrate process instance '98d32cdf-1':\n\tCannot migrate activity instance 'Activity_ReviewOrder:98d353f6':\n\t\tThere is no migration instruction for this instance's activity\n",
        },
        { id: "job-2", exceptionMessage: long },
        { id: "job-3" },
      ],
    })

    const failures = await reader.failures(BATCH)

    expect(failures[0]).toStrictEqual({
      reason:
        "ENGINE-23004 Cannot migrate process instance '98d32cdf-1': Cannot migrate activity instance 'Activity_ReviewOrder:98d353f6': There is no migration instruction for this instance's activity",
      instanceId: "98d32cdf-1",
    })
    expect(failures[1]?.instanceId).toBe("nope-9")
    expect(failures[1]?.reason).toBe(`${long.slice(0, 299)}…`)
    expect(failures[2]).toStrictEqual({ reason: "Job job-3 failed without a message." })
    expect(port.calls[1]).toStrictEqual({
      operationId: "getJobs",
      input: {
        pathArgs: [],
        query: {
          jobDefinitionId: MIGRATION.batchJobDefinitionId,
          withException: "true",
          noRetriesLeft: "true",
          maxResults: "100",
        },
      },
    })
  })

  it("keeps a reason of exactly 300 characters whole", async () => {
    const reason = "y".repeat(300)
    const { reader } = readerOver({
      getBatchStatistics: () => [
        { ...MIGRATION, suspended: false, completedJobs: 0, failedJobs: 1 },
      ],
      getJobs: () => [{ id: "job-1", exceptionMessage: reason }],
    })

    expect(await reader.failures(BATCH)).toStrictEqual([{ reason }])
  })

  it("joins every run of blanks, control, format and separator characters into one space", async () => {
    const { reader } = readerOver({
      getBatchStatistics: () => [
        { ...MIGRATION, suspended: false, completedJobs: 0, failedJobs: 1 },
      ],
      getJobs: () => [
        { id: "job-1", exceptionMessage: " a\u0000​ b  c  d\r\n " },
        { id: "job-2", exceptionMessage: "Process Instance 'p-2' failed" },
      ],
    })

    expect(await reader.failures(BATCH)).toStrictEqual([
      { reason: "a b c d" },
      { reason: "Process Instance 'p-2' failed", instanceId: "p-2" },
    ])
  })

  it.each([
    ["has left the runtime", () => []],
    ["has no failed job", running({ ...MIGRATION, failedJobs: 0 })],
    ["names no job definition", running({ failedJobs: 2 })],
  ])("reads no job of a batch that %s", async (_name, statistics) => {
    const { port, reader } = readerOver({ getBatchStatistics: statistics })

    expect(await reader.failures(BATCH)).toStrictEqual([])
    expect(port.calls.map((call) => call.operationId)).toStrictEqual(["getBatchStatistics"])
  })
})
