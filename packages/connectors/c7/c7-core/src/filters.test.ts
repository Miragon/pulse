import { describe, expect, it } from "vitest"
import {
  complementaryFlags,
  engineKeyList,
  engineLike,
  tenantBody,
  tenantQuery,
  trueOnly,
} from "./filters.js"

describe("trueOnly: the engine ignores a false flag, so it is never sent", () => {
  it("keeps true and drops false and absent", () => {
    expect(trueOnly(true)).toBe(true)
    expect(trueOnly(false)).toBeUndefined()
    expect(trueOnly(undefined)).toBeUndefined()
  })
})

describe("complementaryFlags: false is sent as true on the complement", () => {
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
  // what the caller asked for. The contradiction is refused instead.
  it("refuses a pair that asks for both states or neither", () => {
    expect(() => pair({ active: false, suspended: false })).toThrow(RangeError)
    expect(() => pair({ active: true, suspended: true })).toThrow(RangeError)
    expect(() => pair({ active: false, suspended: false })).toThrow(
      /active: false and suspended: false contradict each other/,
    )
  })
})

describe("engineLike: a LIKE value without a wildcard would match exactly", () => {
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

describe("engineKeyList: single and list inputs become one comma list", () => {
  it("joins and de-duplicates", () => {
    expect(engineKeyList("a", ["b", "a", "c"])).toBe("a,b,c")
  })

  it("skips empty parts and sends nothing when all are empty", () => {
    expect(engineKeyList(undefined, ["", "b"])).toBe("b")
    expect(engineKeyList(undefined, [])).toBeUndefined()
    expect(engineKeyList()).toBeUndefined()
  })
})

describe("tenantQuery and tenantBody: one tenant's runs, none for the runs of no tenant", () => {
  it("names the tenant in tenantIdIn, a list in a body", () => {
    expect(tenantQuery("north")).toEqual({ tenantIdIn: "north" })
    expect(tenantBody("north")).toEqual({ tenantIdIn: ["north"] })
  })

  it("asks for the runs without a tenant, never an empty tenantIdIn", () => {
    expect(tenantQuery(null)).toEqual({ withoutTenantId: true })
    expect(tenantBody(null)).toEqual({ withoutTenantId: true })
  })
})
