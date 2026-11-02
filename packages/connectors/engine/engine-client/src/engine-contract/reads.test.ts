import { beforeEach, describe, expect, it, vi } from "vitest"

// The generated SDK is replaced by spies: these tests pin the request OPTIONS
// each contract read adds (Accept/parseAs, deserializeValues, the batch
// fallback) and how failures map. That the options survive to the wire is
// asserted end to end against a recording fake engine in the engine
// connector (`src/tools/*.wire.test.ts`).
vi.mock("../generated/sdk.gen.js", () => ({
  getStacktrace: vi.fn(),
  getExternalTaskErrorDetails: vi.fn(),
  getProcessInstanceVariables: vi.fn(),
  getTaskVariables: vi.fn(),
  getBatchStatistics: vi.fn(),
  getHistoricBatch: vi.fn(),
}))

import * as sdk from "../generated/sdk.gen.js"
import type { Client } from "../generated/client/types.gen.js"
import { EngineRequestError } from "../engine-error.js"
import {
  RAW_VARIABLES,
  fetchExternalTaskErrorDetails,
  fetchJobStacktrace,
  readBatch,
  readProcessInstanceVariables,
  readTaskVariables,
} from "./reads.js"

const client = { fake: true } as unknown as Client
const TEXT_PLAIN = { parseAs: "text", headers: { Accept: "text/plain" } }

function httpError(status: number) {
  return new EngineRequestError(`[${status}] boom`, {
    kind: "http",
    httpStatus: status,
    engineMessage: "boom",
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("fetchJobStacktrace — a text/plain-only endpoint", () => {
  const mocked = vi.mocked(sdk.getStacktrace)

  it("asks for text/plain parsed as text (the default Accept is a 406)", async () => {
    mocked.mockResolvedValue("java.lang.IllegalStateException: boom")
    expect(await fetchJobStacktrace(client, "job-1")).toBe("java.lang.IllegalStateException: boom")
    expect(mocked).toHaveBeenCalledWith({ client, path: { id: "job-1" }, ...TEXT_PLAIN })
  })

  it("returns null for an empty body and for a job that no longer exists (404)", async () => {
    mocked.mockResolvedValueOnce("")
    expect(await fetchJobStacktrace(client, "job-1")).toBeNull()
    mocked.mockRejectedValueOnce(httpError(404))
    expect(await fetchJobStacktrace(client, "job-1")).toBeNull()
  })

  it("throws every other failure instead of reporting 'no stacktrace'", async () => {
    mocked.mockRejectedValueOnce(httpError(403))
    await expect(fetchJobStacktrace(client, "job-1")).rejects.toMatchObject({ httpStatus: 403 })
    mocked.mockRejectedValueOnce(new TypeError("fetch failed"))
    await expect(fetchJobStacktrace(client, "job-1")).rejects.toThrow("fetch failed")
  })
})

describe("fetchExternalTaskErrorDetails — a text/plain-only endpoint", () => {
  const mocked = vi.mocked(sdk.getExternalTaskErrorDetails)

  it("asks for text/plain parsed as text", async () => {
    mocked.mockResolvedValue("line1\nline2")
    expect(await fetchExternalTaskErrorDetails(client, "ext-1")).toBe("line1\nline2")
    expect(mocked).toHaveBeenCalledWith({ client, path: { id: "ext-1" }, ...TEXT_PLAIN })
  })

  it("returns null when the engine has none (204) or the task is gone (404)", async () => {
    mocked.mockResolvedValueOnce(undefined)
    expect(await fetchExternalTaskErrorDetails(client, "ext-1")).toBeNull()
    mocked.mockRejectedValueOnce(httpError(404))
    expect(await fetchExternalTaskErrorDetails(client, "ext-1")).toBeNull()
  })

  it("throws other failures", async () => {
    mocked.mockRejectedValueOnce(httpError(500))
    await expect(fetchExternalTaskErrorDetails(client, "ext-1")).rejects.toMatchObject({
      httpStatus: 500,
    })
  })
})

describe("variable reads never let the engine deserialize", () => {
  const VARS = { payload: { type: "Json", value: '{"a":1}', valueInfo: {} } }

  it("is the one query flag every variable read sends", () => {
    expect(RAW_VARIABLES).toEqual({ deserializeValues: false })
  })

  it("reads process-instance variables with deserializeValues=false", async () => {
    vi.mocked(sdk.getProcessInstanceVariables).mockResolvedValue(VARS)
    expect(await readProcessInstanceVariables(client, "pi-1")).toEqual(VARS)
    expect(sdk.getProcessInstanceVariables).toHaveBeenCalledWith({
      client,
      path: { id: "pi-1" },
      query: { deserializeValues: false },
    })
  })

  it("reads task variables with deserializeValues=false", async () => {
    vi.mocked(sdk.getTaskVariables).mockResolvedValue(VARS)
    expect(await readTaskVariables(client, "t-1")).toEqual(VARS)
    expect(sdk.getTaskVariables).toHaveBeenCalledWith({
      client,
      path: { id: "t-1" },
      query: { deserializeValues: false },
    })
  })
})

describe("readBatch", () => {
  const stats = vi.mocked(sdk.getBatchStatistics)
  const history = vi.mocked(sdk.getHistoricBatch)

  it("reports a running batch from its statistics without asking the history", async () => {
    stats.mockResolvedValue([{ id: "b-1", totalJobs: 2, remainingJobs: 1, failedJobs: 1 }] as never)
    expect(await readBatch(client, "b-1")).toMatchObject({ batchId: "b-1", status: "failing" })
    expect(stats).toHaveBeenCalledWith({ client, query: { batchId: "b-1" } })
    expect(history).not.toHaveBeenCalled()
  })

  it("falls back to the history once the runtime no longer holds the batch", async () => {
    stats.mockResolvedValue([] as never)
    history.mockResolvedValue({ id: "b-1", endTime: "2026-10-09T09:30:45.684+0000" })
    expect(await readBatch(client, "b-1")).toMatchObject({ status: "completed" })
    expect(history).toHaveBeenCalledWith({ client, path: { id: "b-1" } })
  })

  it("treats a non-array statistics answer as no running batch", async () => {
    stats.mockResolvedValue({} as never)
    history.mockResolvedValue({ id: "b-1" })
    expect(await readBatch(client, "b-1")).toMatchObject({ status: "running", endTime: null })
  })

  it("says so when neither the runtime nor the history knows the batch", async () => {
    stats.mockResolvedValue([] as never)
    history.mockRejectedValue(httpError(404))
    await expect(readBatch(client, "nope")).rejects.toThrow(
      "Batch nope not found: no running batch has this id and the engine history holds no record of it",
    )
  })

  it("propagates other history failures unchanged", async () => {
    stats.mockResolvedValue([] as never)
    history.mockRejectedValue(httpError(403))
    await expect(readBatch(client, "b-1")).rejects.toMatchObject({ httpStatus: 403 })
  })
})
