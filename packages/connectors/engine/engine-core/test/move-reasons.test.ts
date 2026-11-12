import { describe, expect, test } from "vitest"
import { MoveReasons } from "../src/index.js"

const ONE_LINE = "Write the reason on one line, without control characters."

describe("MoveReasons.whyInvalid", () => {
  test("asks for a reason when there is none", () => {
    expect(MoveReasons.whyInvalid("")).toBe("Give a reason for the move.")
    expect(MoveReasons.whyInvalid(" \t\n ")).toBe("Give a reason for the move.")
  })

  test("takes up to 500 characters, counted after the trim", () => {
    expect(MoveReasons.whyInvalid("x".repeat(500))).toBeUndefined()
    expect(MoveReasons.whyInvalid(`  ${"x".repeat(500)}\n`)).toBeUndefined()
    expect(MoveReasons.whyInvalid("x".repeat(501))).toBe("Keep the reason within 500 characters.")
    expect(MoveReasons.whyInvalid(`${"x".repeat(500)}\ty`)).toBe(
      "Keep the reason within 500 characters.",
    )
  })

  test("takes one line of printable text", () => {
    expect(MoveReasons.whyInvalid("  Customer asked to skip the review  ")).toBeUndefined()
    expect(MoveReasons.whyInvalid("Prüfung übersprungen, Ticket 42 (Kunde)")).toBeUndefined()
  })

  test.each([
    ["a line feed", "line\nbreak"],
    ["a tab", "tab\there"],
    ["a bell", "bell\u0007"],
    ["a next line (U+0085)", "next\u0085line"],
    ["a zero-width space (U+200B)", "zero\u200bwidth"],
    ["a line separator (U+2028)", "line\u2028separator"],
    ["a paragraph separator (U+2029)", "para\u2029graph"],
  ])("refuses %s inside the reason", (_, reason) => {
    expect(MoveReasons.whyInvalid(reason)).toBe(ONE_LINE)
  })
})
