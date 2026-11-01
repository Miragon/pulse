// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { BreakableId, idBreakSegments } from "./id-breaks.js"

afterEach(() => cleanup())

describe("idBreakSegments: where a long id may wrap", () => {
  it("after a separator", () => {
    expect(idBreakSegments("Activity_CheckBlacklist")).toEqual(["Activity_", "Check", "Blacklist"])
    expect(idBreakSegments("73059b49-c64b-11f1")).toEqual(["73059b49-", "c64b-", "11f1"])
    expect(idBreakSegments("order:3:d2")).toEqual(["order:", "3:", "d2"])
    expect(idBreakSegments("a.b/c")).toEqual(["a.", "b/", "c"])
  })

  it("between a lower- and an upper-case letter, also beyond ASCII", () => {
    expect(idBreakSegments("assessCreditworthiness")).toEqual(["assess", "Creditworthiness"])
    expect(idBreakSegments("prüfungÄnderung")).toEqual(["prüfung", "Änderung"])
  })

  it("never inside a word, a run of capitals or digits", () => {
    expect(idBreakSegments("invoice")).toEqual(["invoice"])
    expect(idBreakSegments("HTTPServer")).toEqual(["HTTPServer"])
    expect(idBreakSegments("v2Order")).toEqual(["v2Order"])
    expect(idBreakSegments("")).toEqual([""])
  })

  it("gives the id back unchanged when joined", () => {
    for (const id of ["Activity_CheckBlacklist", "miraveloLeasing", "a--b__c", "-x_"]) {
      expect(idBreakSegments(id).join("")).toBe(id)
    }
  })
})

describe("BreakableId", () => {
  it("keeps the id as its text and marks the breaks with <wbr>", () => {
    const { container } = render(<BreakableId id="Activity_CheckBlacklist" />)
    expect(container.textContent).toBe("Activity_CheckBlacklist")
    expect(container.innerHTML).toBe("Activity_<wbr>Check<wbr>Blacklist")
  })
})
