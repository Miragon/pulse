import { afterEach, describe, expect, it, vi } from "vitest"
import { optionalTimestampOf, timestampOf } from "./timestamps.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("timestampOf", () => {
  it.each([
    ["the engine's UTC offset", "2026-10-21T18:44:04.587+0000", "2026-10-21T18:44:04.587Z"],
    ["an offset east of UTC", "2026-10-21T18:44:04.587+0200", "2026-10-21T16:44:04.587Z"],
    ["an offset west of UTC", "2026-10-21T18:44:04.587-0130", "2026-10-21T20:14:04.587Z"],
    ["an offset with its colon", "2026-10-21T18:44:04.587+02:00", "2026-10-21T16:44:04.587Z"],
    ["a time in UTC", "2026-10-21T18:44:04.587Z", "2026-10-21T18:44:04.587Z"],
  ])("reads %s as the contract's ISO-8601 in UTC", (_name, engine, contract) => {
    expect(timestampOf(engine)).toBe(contract)
  })

  it("hands the date parser the engine's offset with its colon, the form every parser reads", () => {
    const parse = vi.spyOn(Date, "parse")
    timestampOf("2026-10-21T18:44:04.587+0200")
    timestampOf("+002026-10-21T18:44:04.587-0130")
    timestampOf("2026-10-21T18:44:04.587Z")
    expect(parse.mock.calls).toStrictEqual([
      ["2026-10-21T18:44:04.587+02:00"],
      ["+002026-10-21T18:44:04.587-01:30"],
      ["2026-10-21T18:44:04.587Z"],
    ])
  })

  it("fails a text no date parser reads", () => {
    expect(() => timestampOf("yesterday")).toThrow(RangeError)
  })
})

describe("optionalTimestampOf", () => {
  it("reads a timestamp the engine named", () => {
    expect(optionalTimestampOf("2026-10-21T18:44:04.587+0100")).toBe("2026-10-21T17:44:04.587Z")
  })

  it("is undefined for one it did not name", () => {
    expect(optionalTimestampOf(undefined)).toBeUndefined()
  })
})
