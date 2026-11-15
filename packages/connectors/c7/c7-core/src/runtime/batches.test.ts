import { RuntimeError } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
import { findHistoricBatch, readBatchStatistics, readFailedJobs } from "./batches.js"

const BATCH = {
  id: "b1",
  type: "instance-migration",
  totalJobs: 5,
  invocationsPerBatchJob: 2,
  batchJobDefinitionId: "jd1",
  startTime: "2026-10-23T20:45:22.182+0000",
}

function failing(error: Error): Route {
  return () => {
    throw error
  }
}

async function rejectionOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe("readBatchStatistics", () => {
  it("reads the first batch the statistics list, by its id in the query", async () => {
    const port = fakePort({
      getBatchStatistics: () => [
        { ...BATCH, suspended: true, completedJobs: 1, failedJobs: 2 },
        { ...BATCH, id: "b2", suspended: false, completedJobs: 0, failedJobs: 0 },
      ],
    })

    expect(await readBatchStatistics(port, "b1")).toStrictEqual({
      ...BATCH,
      suspended: true,
      completedJobs: 1,
      failedJobs: 2,
    })
    expect(port.calls).toStrictEqual([
      { operationId: "getBatchStatistics", input: { pathArgs: [], query: { batchId: "b1" } } },
    ])
  })

  it("reads a batch without the optional fields with one item per job, not suspended", async () => {
    const port = fakePort({
      getBatchStatistics: () => [
        { id: "b1", type: "instance-deletion", totalJobs: 3, completedJobs: 0, failedJobs: 0 },
      ],
    })

    expect(await readBatchStatistics(port, "b1")).toStrictEqual({
      id: "b1",
      type: "instance-deletion",
      totalJobs: 3,
      invocationsPerBatchJob: 1,
      suspended: false,
      completedJobs: 0,
      failedJobs: 0,
    })
  })

  it.each([
    ["false", false],
    ["a text", "true"],
    ["null", null],
  ])("reads a suspended flag of %s as not suspended", async (_name, suspended) => {
    const port = fakePort({
      getBatchStatistics: () => [{ ...BATCH, suspended, completedJobs: 0, failedJobs: 0 }],
    })

    expect((await readBatchStatistics(port, "b1"))?.suspended).toBe(false)
  })

  it("reads a batch the runtime no longer holds as none", async () => {
    const port = fakePort({ getBatchStatistics: () => [] })

    expect(await readBatchStatistics(port, "b1")).toBeUndefined()
  })

  it.each([
    ["no list", { id: "b1" }, "batch statistics is not a list"],
    ["a row that is no object", [{ ...BATCH }, 1], "batch statistics[1] is not an object"],
    ["a batch without its type", [{ id: "b1" }], "type is missing"],
    ["a batch without its jobs", [{ id: "b1", type: "t" }], "totalJobs is missing"],
    ["no completed jobs", [{ ...BATCH, failedJobs: 0 }], "completedJobs is missing"],
    ["no failed jobs", [{ ...BATCH, completedJobs: 0 }], "failedJobs is missing"],
  ])("fails an answer with %s as unexpected", async (_name, answer, message) => {
    const port = fakePort({ getBatchStatistics: () => answer })

    const error = await rejectionOf(readBatchStatistics(port, "b1"))

    expect(error).toBeInstanceOf(RuntimeError)
    expect(error).toMatchObject({ failure: "unexpectedResponse", message })
  })

  it("refuses an id no engine assigns before a request leaves", async () => {
    const port = fakePort({})

    const error = await rejectionOf(readBatchStatistics(port, "b1,b2"))

    expect(error).toMatchObject({
      failure: "misconfigured",
      message: '"b1,b2" as an identifier is not accepted',
    })
    expect(port.calls).toStrictEqual([])
  })
})

describe("findHistoricBatch", () => {
  it("reads the batch the history holds by its id in the path, with its end", async () => {
    const port = fakePort({
      getHistoricBatch: () => ({ ...BATCH, endTime: "2026-10-23T20:45:30.000+0000" }),
    })

    expect(await findHistoricBatch(port, "b1")).toStrictEqual({
      ...BATCH,
      endTime: "2026-10-23T20:45:30.000+0000",
    })
    expect(port.calls).toStrictEqual([
      { operationId: "getHistoricBatch", input: { pathArgs: ["b1"], query: {} } },
    ])
  })

  it("reads a batch of the history without an end or a start", async () => {
    const port = fakePort({
      getHistoricBatch: () => ({ id: "b1", type: "instance-deletion", totalJobs: 1 }),
    })

    expect(await findHistoricBatch(port, "b1")).toStrictEqual({
      id: "b1",
      type: "instance-deletion",
      totalJobs: 1,
      invocationsPerBatchJob: 1,
    })
  })

  it.each([
    ["missing", fakeFailure(404, "InvalidRequestException")],
    ["gone meanwhile", fakeFailure(500, "NullValueException")],
  ])("reads a batch the history does not hold, %s, as none", async (_name, failure) => {
    const port = fakePort({ getHistoricBatch: failing(failure) })

    expect(await findHistoricBatch(port, "b1")).toBeUndefined()
  })

  it("fails a 404 of a wrong REST root instead of reading it as none", async () => {
    const failure = fakeFailure(404, "NotFoundException")
    const port = fakePort({ getHistoricBatch: failing(failure) })

    expect(await rejectionOf(findHistoricBatch(port, "b1"))).toBe(failure)
  })

  it("fails an answer that is no object as unexpected", async () => {
    const port = fakePort({ getHistoricBatch: () => [] })

    expect(await rejectionOf(findHistoricBatch(port, "b1"))).toMatchObject({
      failure: "unexpectedResponse",
      message: "historic batch is not an object",
    })
  })

  it("refuses an id no engine assigns before a request leaves", async () => {
    const port = fakePort({})

    expect(await rejectionOf(findHistoricBatch(port, "../b1"))).toMatchObject({
      failure: "misconfigured",
    })
    expect(port.calls).toStrictEqual([])
  })
})

describe("readFailedJobs", () => {
  it("reads at most 100 jobs of the definition that failed with no retries left", async () => {
    const port = fakePort({
      getJobs: () => [
        { id: "j1", exceptionMessage: "boom" },
        { id: "j2", exceptionMessage: null },
      ],
    })

    expect(await readFailedJobs(port, "jd1")).toStrictEqual([
      { id: "j1", exceptionMessage: "boom" },
      { id: "j2" },
    ])
    expect(port.calls).toStrictEqual([
      {
        operationId: "getJobs",
        input: {
          pathArgs: [],
          query: {
            jobDefinitionId: "jd1",
            withException: "true",
            noRetriesLeft: "true",
            maxResults: "100",
          },
        },
      },
    ])
    expect(Object.keys(port.calls[0]!.input.query)).toStrictEqual([
      "jobDefinitionId",
      "withException",
      "noRetriesLeft",
      "maxResults",
    ])
  })

  it.each([
    ["no list", {}, "failed jobs is not a list"],
    ["a job without its id", [{ exceptionMessage: "boom" }], "id is missing"],
  ])("fails an answer with %s as unexpected", async (_name, answer, message) => {
    const port = fakePort({ getJobs: () => answer })

    expect(await rejectionOf(readFailedJobs(port, "jd1"))).toMatchObject({
      failure: "unexpectedResponse",
      message,
    })
  })

  it("refuses a job definition id no engine assigns before a request leaves", async () => {
    const port = fakePort({})

    expect(await rejectionOf(readFailedJobs(port, "jd 1"))).toMatchObject({
      failure: "misconfigured",
      message: '"jd 1" as an identifier is not accepted',
    })
    expect(port.calls).toStrictEqual([])
  })
})
