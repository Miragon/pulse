/**
 * The value rules a reader also applies to what replaces a profile's value (the CLI's flags and
 * environment), at their edges.
 */

import { describe, expect, it } from "vitest"
import { isRedirectPort } from "./auth.js"
import { isEngineName, isTimeout, MAX_TIMEOUT_MS } from "./profile.js"

describe("isEngineName", () => {
  it('takes a name, blanks around it trimmed, but no blank, "." or ".."', () => {
    for (const name of ["default", " shop ", ".x"]) expect(isEngineName(name), name).toBe(true)
    for (const name of ["", "  ", ".", " . ", "..", "\t..\n", 1, null]) {
      expect(isEngineName(name), String(name)).toBe(false)
    }
  })
})

describe("isTimeout", () => {
  it("takes a whole number of milliseconds from 1 to the longest a Node.js timer holds", () => {
    expect(MAX_TIMEOUT_MS).toBe(2 ** 31 - 1)
    for (const ms of [1, 30_000, MAX_TIMEOUT_MS]) expect(isTimeout(ms), String(ms)).toBe(true)
    for (const ms of [0, -1, 1.5, MAX_TIMEOUT_MS + 1, Number.NaN, Infinity, "5000", null]) {
      expect(isTimeout(ms), String(ms)).toBe(false)
    }
  })
})

describe("isRedirectPort", () => {
  it("takes a port from 0 (any free one) to 65535", () => {
    for (const port of [0, 8080, 65_535]) expect(isRedirectPort(port), String(port)).toBe(true)
    for (const port of [-1, 65_536, 80.5, "8080", null]) {
      expect(isRedirectPort(port), String(port)).toBe(false)
    }
  })
})
