import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import { DATE_TIME_HINT, normalizeDateTime } from "./dates.js"

// The reading itself is c7-core's UTC_WITHOUT_OFFSET, tested there (examples and properties).

function expectUsageError(raw: string): void {
  try {
    normalizeDateTime(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(PulseCliError)
    expect((error as PulseCliError).code).toBe("USAGE")
    expect((error as PulseCliError).message).toBe(`Invalid date-time "${raw}"`)
    expect((error as PulseCliError).details.hint).toBe(DATE_TIME_HINT)
    return
  }
  throw new Error(`expected "${raw}" to be rejected`)
}

describe("normalizeDateTime", () => {
  it.each([
    ["2024-05-01T10:00:00.000+0200", "2024-05-01T10:00:00.000+0200"],
    ["2024-05-01T10:00:00.5Z", "2024-05-01T10:00:00.500+0000"],
    ["2024-05-01T10:00", "2024-05-01T10:00:00.000+0000"],
    ["2024-05-01", "2024-05-01T00:00:00.000+0000"],
  ])("normalizes %s like c7-core", (raw, expected) => {
    expect(normalizeDateTime(raw)).toBe(expected)
  })

  it.each(["", "yesterday", "2024-05-01 10:00:00", "2023-02-29", "2024-05-01T10:00:00+02"])(
    "rejects %j as a usage error with the hint",
    (raw) => {
      expectUsageError(raw)
    },
  )

  it("lists every accepted form in the hint", () => {
    expect(DATE_TIME_HINT).toContain("2024-05-01,")
    expect(DATE_TIME_HINT).toContain("2024-05-01T10:00:00.000+0200")
    expect(DATE_TIME_HINT).toContain("without an offset are UTC")
  })
})
