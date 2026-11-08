import { describe, expect, it } from "vitest"
import { countOf, optional, rowsOf } from "./engine-reads.js"

// The reads every builder goes through; which of them is primary is `honest-numbers.test.ts`.

describe("engine-reads", () => {
  it("a count reply without a count is an engine-contract breach, not a 0", () => {
    expect(countOf({ count: 0 })).toBe(0)
    expect(() => countOf({})).toThrow(/without a count/)
    expect(() => countOf(null)).toThrow(/without a count/)
  })

  it("a list reply that is no list is an engine-contract breach, not 'no rows'", () => {
    expect(rowsOf([1])).toEqual([1])
    expect(() => rowsOf({})).toThrow(/without a list/)
    expect(() => rowsOf(undefined)).toThrow(/without a list/)
  })

  it("an enrichment read degrades to null", async () => {
    await expect(optional(Promise.reject(new Error("boom")))).resolves.toBeNull()
    await expect(optional(Promise.resolve("x"))).resolves.toBe("x")
  })
})
