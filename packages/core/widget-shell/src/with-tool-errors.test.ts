import { describe, expect, it } from "vitest"
import { withToolErrors } from "./server.js"

class CodedError extends Error {
  readonly code = "ENGINE_NOT_SELECTED"
}

describe("withToolErrors", () => {
  it("passes successful results through untouched", async () => {
    const result = { content: [{ type: "text" as const, text: "ok" }] }
    const wrapped = withToolErrors(() => Promise.resolve(result))
    await expect(wrapped()).resolves.toBe(result)
  })

  it("forwards the handler arguments", async () => {
    const wrapped = withToolErrors((args: { a: number }) => Promise.resolve(args.a * 2))
    await expect(wrapped({ a: 21 })).resolves.toBe(42)
  })

  it("converts a coded exception to the registrar's `[code] message` error result", async () => {
    const wrapped = withToolErrors(() =>
      Promise.reject(new CodedError("No engine selected for this session.")),
    )
    const result = (await wrapped()) as { isError?: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(
      "[ENGINE_NOT_SELECTED] No engine selected for this session.",
    )
  })

  it("prefers an HTTP-ish `status` over `code`, matching the toolkit registrar", async () => {
    const e = Object.assign(new Error("boom"), { status: 404, code: "IGNORED" })
    const wrapped = withToolErrors(() => Promise.reject(e))
    const result = (await wrapped()) as { content: { text: string }[] }
    expect(result.content[0].text).toBe("[404] boom")
  })

  it("handles plain errors and non-Error throwables without a code prefix", async () => {
    const plain = withToolErrors(() => Promise.reject(new Error("plain failure")))
    // Non-Error on purpose: the wrapper must stringify whatever a handler throws.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const thrownString = withToolErrors(() => Promise.reject("string failure"))
    expect(((await plain()) as { content: { text: string }[] }).content[0].text).toBe(
      "plain failure",
    )
    expect(((await thrownString()) as { content: { text: string }[] }).content[0].text).toBe(
      "string failure",
    )
  })
})
