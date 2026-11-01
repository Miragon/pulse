import { afterEach, describe, expect, it, vi } from "vitest"
import { createToolsetVocabulary } from "./toolsets.js"

const NAMES = ["read-only", "operations", "admin"] as const

const vocab = () =>
  createToolsetVocabulary("mymodule", NAMES, "read-only", { authenticatedDefault: "operations" })

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createToolsetVocabulary", () => {
  it("recognizes declared names and exposes the policy", () => {
    const v = vocab()
    expect(v.module).toBe("mymodule")
    expect(v.names).toEqual(NAMES)
    expect(v.fallback).toBe("read-only")
    expect(v.authenticatedDefault).toBe("operations")
    expect(v.isKnown("read-only")).toBe(true)
    expect(v.isKnown("nope")).toBe(false)
    expect(v.resolve("operations")).toBe("operations")
  })

  it("defaults the authenticated default to the fallback", () => {
    const v = createToolsetVocabulary("solo", ["read-only"] as const, "read-only")
    expect(v.authenticatedDefault).toBe("read-only")
    expect(v.effective(undefined, { authenticated: true })).toEqual({
      toolset: "read-only",
      source: "default",
    })
  })

  describe("resolve (module side)", () => {
    it("resolves a missing toolset to the floor, silently — never to everything", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(vocab().resolve(undefined)).toBe("read-only")
      expect(warn).not.toHaveBeenCalled()
    })

    it("fails CLOSED on unknown names — degrades to the fallback toolset, loudly", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(vocab().resolve("does-not-exist")).toBe("read-only")
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[mymodule] Unknown toolset "does-not-exist" — falling back to "read-only". ' +
          "Known toolsets: read-only, operations, admin",
      )
    })
  })

  describe("effective (composition side)", () => {
    it("applies the auth-dependent default when there is no suffix — never admin", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      expect(vocab().effective(undefined, { authenticated: false })).toEqual({
        toolset: "read-only",
        source: "default",
      })
      expect(vocab().effective(undefined, { authenticated: true })).toEqual({
        toolset: "operations",
        source: "default",
      })
      expect(warn).not.toHaveBeenCalled()
    })

    it("honors a known suffix (trimmed) in both auth modes", () => {
      for (const authenticated of [false, true]) {
        expect(vocab().effective(" admin ", { authenticated })).toEqual({
          toolset: "admin",
          source: "suffix",
        })
      }
    })

    it.each([
      ["", "Empty toolset suffix"],
      ["   ", "Empty toolset suffix"],
      ["typo", 'Unknown toolset "typo"'],
      ["admin:read-only", 'Unknown toolset "admin:read-only"'],
    ])(
      "fails closed on suffix %j — the floor even under OAuth, with one warning",
      (suffix, why) => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        for (const authenticated of [false, true]) {
          expect(vocab().effective(suffix, { authenticated })).toEqual({
            toolset: "read-only",
            source: "fallback",
          })
        }
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenCalledWith(
          `[mymodule] ${why} — falling back to "read-only". Known toolsets: read-only, operations, admin`,
        )
      },
    )
  })
})
