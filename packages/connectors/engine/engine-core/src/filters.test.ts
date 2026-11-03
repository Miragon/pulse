import { describe, expect, it } from "vitest"
import {
  complementaryFlags,
  engineInstanceSearch,
  engineKeyList,
  engineLike,
  trueOnly,
} from "./filters.js"

describe("trueOnly — the engine ignores a false flag, so it is never sent", () => {
  it("keeps true and drops false and absent", () => {
    expect(trueOnly(true)).toBe(true)
    expect(trueOnly(false)).toBeUndefined()
    expect(trueOnly(undefined)).toBeUndefined()
  })
})

describe("complementaryFlags — false is sent as true on the complement", () => {
  const pair = (flags: { active?: boolean; suspended?: boolean }) =>
    complementaryFlags(flags, "active", "suspended")

  it("sends a true flag as is", () => {
    expect(pair({ active: true })).toEqual({ active: true })
    expect(pair({ suspended: true })).toEqual({ suspended: true })
  })

  it("maps false onto the complement instead of forwarding it", () => {
    expect(pair({ suspended: false })).toEqual({ active: true })
    expect(pair({ active: false })).toEqual({ suspended: true })
  })

  it("sends nothing without flags and agrees with itself", () => {
    expect(pair({})).toEqual({})
    expect(pair({ active: true, suspended: false })).toEqual({ active: true })
  })

  // On active/suspended (process instances, jobs) and withRetriesLeft/
  // noRetriesLeft (external tasks) both flags set ONE engine field, so the
  // engine keeps whichever it applies last and answers one state as if it
  // were the filtered result; the other pairs answer nothing. Neither is
  // what the caller asked for — the contradiction is refused instead.
  it("refuses a pair that asks for both states or neither", () => {
    expect(() => pair({ active: false, suspended: false })).toThrow(RangeError)
    expect(() => pair({ active: true, suspended: true })).toThrow(RangeError)
    expect(() => pair({ active: false, suspended: false })).toThrow(
      /active: false and suspended: false contradict each other/,
    )
  })
})

describe("engineLike — a LIKE value without a wildcard would match exactly", () => {
  it("wraps a plain value into a substring match", () => {
    expect(engineLike("invoice")).toBe("%invoice%")
  })

  it("keeps a value that already carries a wildcard", () => {
    expect(engineLike("inv%")).toBe("inv%")
    expect(engineLike("%")).toBe("%")
  })

  it("sends nothing for an empty or absent value", () => {
    expect(engineLike("")).toBeUndefined()
    expect(engineLike(undefined)).toBeUndefined()
  })
})

describe("engineKeyList — single and list inputs become one comma list", () => {
  it("joins and de-duplicates", () => {
    expect(engineKeyList("a", ["b", "a", "c"])).toBe("a,b,c")
  })

  it("skips empty parts and sends nothing when all are empty", () => {
    expect(engineKeyList(undefined, ["", "b"])).toBe("b")
    expect(engineKeyList(undefined, [])).toBeUndefined()
    expect(engineKeyList()).toBeUndefined()
  })
})

describe("engineInstanceSearch — a business key fragment OR a whole instance id", () => {
  it("ORs the business key as a substring with the term as an id", () => {
    expect(engineInstanceSearch("CUST-1")).toEqual({
      orQueries: [{ businessKeyLike: "%CUST-1%", processInstanceIds: ["CUST-1"] }],
    })
  })

  it("trims a pasted id, so a trailing space still finds it", () => {
    expect(engineInstanceSearch("  73059b49-c64b-11f1 \n")).toEqual({
      orQueries: [
        { businessKeyLike: "%73059b49-c64b-11f1%", processInstanceIds: ["73059b49-c64b-11f1"] },
      ],
    })
  })

  it("keeps a wildcard the caller placed in the business key half", () => {
    expect(engineInstanceSearch("ORD-%-2026").orQueries?.[0]?.businessKeyLike).toBe("ORD-%-2026")
  })

  it("sends nothing for a blank or absent term", () => {
    expect(engineInstanceSearch("")).toEqual({})
    expect(engineInstanceSearch("   ")).toEqual({})
    expect(engineInstanceSearch(undefined)).toEqual({})
  })
})
