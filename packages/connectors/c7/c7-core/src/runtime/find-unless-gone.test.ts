import { describe, expect, it, vi } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { findUnlessGone } from "./find-unless-gone.js"

const INPUT = { pathArgs: ["b1"], query: {} }

function failingWith(error: unknown) {
  return fakePort({
    getHistoricBatch: () => {
      throw error
    },
  })
}

describe("findUnlessGone", () => {
  it("reads the answer through read", async () => {
    const port = fakePort({ getHistoricBatch: () => ({ id: "b1" }) })
    const read = vi.fn((answer: unknown) => ({ answer }))
    expect(await findUnlessGone(port, "getHistoricBatch", INPUT, read)).toEqual({
      answer: { id: "b1" },
    })
    expect(read).toHaveBeenCalledOnce()
    expect(port.calls).toEqual([{ operationId: "getHistoricBatch", input: INPUT }])
  })

  it("hands read an empty answer too, so an unusable one fails there", async () => {
    const read = vi.fn(() => "read")
    const port = fakePort({ getHistoricBatch: () => undefined })
    expect(await findUnlessGone(port, "getHistoricBatch", INPUT, read)).toBe("read")
    expect(read).toHaveBeenCalledWith(undefined)
  })

  it.each([
    ["missing", fakeFailure(404, "InvalidRequestException")],
    ["ended meanwhile", fakeFailure(500, "NullValueException")],
  ])("is undefined for a resource that is %s, never read", async (_kind, failure) => {
    const read = vi.fn()
    expect(await findUnlessGone(failingWith(failure), "getHistoricBatch", INPUT, read)).toBe(
      undefined,
    )
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    ["a wrong REST root", fakeFailure(404, "NotFoundException")],
    ["a 404 without an engine answer", fakeFailure(404)],
    ["an engine failure", fakeFailure(500, "ProcessEngineException")],
    ["no engine answer at all", new Error("connection refused")],
  ])("rejects %s as it is", async (_kind, failure) => {
    const read = vi.fn()
    await expect(
      findUnlessGone(failingWith(failure), "getHistoricBatch", INPUT, read),
    ).rejects.toBe(failure)
    expect(read).not.toHaveBeenCalled()
  })
})
