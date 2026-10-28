import { afterEach, describe, expect, it, vi } from "vitest"
import {
  allowsDurableWrites,
  ANALYTICS_TOOLSETS,
  analyticsToolsets,
  isAnalyticsToolset,
} from "./toolsets.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("analyticsToolsets (the vocabulary the module declares)", () => {
  it("declares exactly read-only and standard — analytics has no admin tier", () => {
    expect(ANALYTICS_TOOLSETS).toEqual(["read-only", "standard"])
    expect(analyticsToolsets.module).toBe("analytics")
    expect(analyticsToolsets.names).toEqual(["read-only", "standard"])
  })

  it("floors at read-only and defaults to standard under OAuth", () => {
    expect(analyticsToolsets.fallback).toBe("read-only")
    expect(analyticsToolsets.authenticatedDefault).toBe("standard")
  })

  it("no suffix: read-only without OAuth, standard with it — never 'everything'", () => {
    expect(analyticsToolsets.effective(undefined, { authenticated: false })).toEqual({
      toolset: "read-only",
      source: "default",
    })
    expect(analyticsToolsets.effective(undefined, { authenticated: true })).toEqual({
      toolset: "standard",
      source: "default",
    })
  })

  it("a named suffix wins over the auth-dependent default, in both directions", () => {
    expect(analyticsToolsets.effective("standard", { authenticated: false })).toEqual({
      toolset: "standard",
      source: "suffix",
    })
    expect(analyticsToolsets.effective("read-only", { authenticated: true })).toEqual({
      toolset: "read-only",
      source: "suffix",
    })
  })

  it("an empty or unknown suffix (incl. camunda7's 'admin') falls back to the floor, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const suffix of ["", "admin"]) {
      expect(analyticsToolsets.effective(suffix, { authenticated: true })).toEqual({
        toolset: "read-only",
        source: "fallback",
      })
    }
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[analytics]"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "admin"'))
  })
})

describe("isAnalyticsToolset", () => {
  it("accepts every declared name and nothing else", () => {
    for (const toolset of ANALYTICS_TOOLSETS) {
      expect(isAnalyticsToolset(toolset)).toBe(true)
    }
    expect(isAnalyticsToolset("admin")).toBe(false)
    expect(isAnalyticsToolset("")).toBe(false)
  })
})

describe("allowsDurableWrites", () => {
  it("forbids writes when no toolset is configured — a missing toolset is the read-only floor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(allowsDurableWrites(undefined)).toBe(false)
    expect(allowsDurableWrites()).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it("forbids writes in the module's read-only toolset", () => {
    expect(allowsDurableWrites("read-only")).toBe(false)
  })

  it("permits writes in the standard toolset (the user's own settings save)", () => {
    expect(allowsDurableWrites("standard")).toBe(true)
  })

  it("fails CLOSED on an unknown toolset name, with a warning", () => {
    // A typo'd `analytics:standrad`, or camunda7's `operations`, must not
    // grant the one write — unknown names degrade to `read-only`.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(allowsDurableWrites("operations")).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown toolset "operations"'))
  })

  it("decides by declared name, not by an ad-hoc string compare", () => {
    // Guards against `toolset === "read-only"`, which fails open for every other name.
    expect(ANALYTICS_TOOLSETS.map((toolset) => [toolset, allowsDurableWrites(toolset)])).toEqual([
      ["read-only", false],
      ["standard", true],
    ])
  })
})
