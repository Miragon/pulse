import { describe, expect, it } from "vitest"
import { countOf } from "../src/messages.ts"

describe("the page's plural rule", () => {
  it("puts a count's noun in the singular for exactly 1, read on the formatted count", () => {
    expect(countOf("1", "incident", "incidents")).toBe("1 incident")
    for (const count of ["0", "2", "1,000", "1.000"]) {
      expect(countOf(count, "incident", "incidents")).toBe(`${count} incidents`)
    }
  })
})
