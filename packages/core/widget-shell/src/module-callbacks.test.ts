import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/server"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { guardedCallback, holdsArray } from "./module-callbacks.js"

const SUBJECT = 'Resource "Board" of "acme"'

let failed: MockInstance<(...data: unknown[]) => void>

beforeEach(() => {
  failed = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Typed as an error to reach the callback: a module may throw anything. */
const rejecting = (reason: Error) => Promise.reject(reason)

/** What a client gets of a throw: the SDK reads `code`, `message` and `data` off the error. */
async function thrownBy(callback: () => unknown): Promise<unknown> {
  try {
    await guardedCallback(SUBJECT, callback)()
  } catch (error) {
    return error
  }
  throw new Error("the guard let it through")
}

describe("guardedCallback", () => {
  it("hands the arguments on and the result back", async () => {
    const callback = vi.fn((a: string, b: number) => `${a}${b}`)
    await expect(guardedCallback(SUBJECT, callback)("x", 1)).resolves.toBe("x1")
    expect(callback).toHaveBeenCalledWith("x", 1)
    expect(failed).not.toHaveBeenCalled()
  })

  it("keeps the message of a failure and drops what else it carries, logging it whole", async () => {
    const failure = Object.assign(new Error("read failed"), {
      code: -32000,
      data: { password: "hunter2" },
    })
    const error = await thrownBy(() => Promise.reject(failure))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("read failed")
    expect(error).not.toHaveProperty("code")
    expect(error).not.toHaveProperty("data")
    expect(failed).toHaveBeenCalledExactlyOnceWith(`${SUBJECT} failed:`, failure)
  })

  // Each of these leaves the request unanswered behind the SDK: `error.code` throws on the first
  // two, a message that is no string fails to encode.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "nope"],
    ["an object whose message is no string", { message: { deep: true } }],
    ["an error without a message", new Error("")],
  ])("turns a thrown %s into an error that names the module", async (_name, thrown) => {
    const error = await thrownBy(() => rejecting(thrown as Error))
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`${SUBJECT} failed.`)
    expect(failed).toHaveBeenCalledExactlyOnceWith(`${SUBJECT} failed:`, thrown)
  })

  it("leaves a module's deliberate protocol answer as it is, out of the log's errors", async () => {
    const deliberate = new ProtocolError(ProtocolErrorCode.InvalidParams, "No such board", {
      board: 7,
    })
    expect(await thrownBy(() => Promise.reject(deliberate))).toBe(deliberate)
    expect(failed).not.toHaveBeenCalled()
  })

  it("fails a result its check refuses, naming the module", async () => {
    const refused = guardedCallback(SUBJECT, () => 1, holdsArray("contents"))
    await expect(refused()).rejects.toThrow(`${SUBJECT} returned no contents array.`)
  })
})

describe("holdsArray", () => {
  it.each([undefined, null, {}, { contents: "x" }, { messages: [] }, 7])("refuses %j", (result) => {
    expect(holdsArray("contents")(result)).toBe("returned no contents array")
  })

  it("takes the array, whatever it holds", () => {
    expect(holdsArray("contents")({ contents: [] })).toBeUndefined()
    expect(holdsArray("messages")({ messages: [{}] })).toBeUndefined()
  })

  it("takes an input-required result, which holds none", () => {
    const asked = { resultType: "input_required", inputRequests: {} }
    expect(holdsArray("contents")(asked)).toBeUndefined()
    expect(holdsArray("messages")(asked)).toBeUndefined()
  })
})
