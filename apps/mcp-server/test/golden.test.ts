import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  GOLDEN_HINT,
  assertCharBudget,
  assertGolden,
  isModelVisible,
  modelVisibleChars,
  repeatedParamDescriptions,
  stableSort,
} from "./golden.js"

/**
 * Self-test of the golden mechanism itself: every path that could let a
 * drifted surface through (auto-create, update in CI, silent budget growth)
 * must be red. Uses a scratch directory, so the real goldens stay untouched
 * even during a `GOLDEN_UPDATE=1` run.
 */

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-selftest-"))
  vi.stubEnv("GOLDEN_UPDATE", "")
  vi.stubEnv("CI", "")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const update = (fn: () => void) => {
  vi.stubEnv("GOLDEN_UPDATE", "1")
  try {
    fn()
  } finally {
    vi.stubEnv("GOLDEN_UPDATE", "")
  }
}

describe("assertGolden", () => {
  it("stableSort sorts keys recursively and keeps array order", () => {
    expect(JSON.stringify(stableSort({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }, 3] } }))).toBe(
      '{"a":{"c":[{"y":2,"z":1},3],"d":2},"b":1}',
    )
  })

  it("a missing golden fails with the update instruction and is never auto-created", () => {
    expect(() => assertGolden("probe", { a: 1 }, dir)).toThrow(/GOLDEN_UPDATE=1/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("GOLDEN_UPDATE writes locally, and a plain run then compares against it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    update(() => assertGolden("probe", { b: 2, a: 1 }, dir))
    expect(() => assertGolden("probe", { a: 1, b: 2 }, dir)).not.toThrow()
    expect(() => assertGolden("probe", { a: 1, b: 3 }, dir)).toThrow()
  })

  it("GOLDEN_UPDATE is refused in CI", () => {
    vi.stubEnv("CI", "true")
    update(() => expect(() => assertGolden("probe", { a: 1 }, dir)).toThrow(/forbidden in CI/))
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it("the hint names the one legitimate path", () => {
    expect(GOLDEN_HINT).toContain("GOLDEN_UPDATE=1")
    expect(GOLDEN_HINT).toContain("NEVER edit a golden by hand")
  })
})

describe("assertCharBudget", () => {
  it("fails without a budget, on growth and on unclaimed slack", () => {
    expect(() => assertCharBudget("probe", 100, dir)).toThrow(/No character budget/)
    update(() => assertCharBudget("probe", 100, dir))
    expect(() => assertCharBudget("probe", 100, dir)).not.toThrow()
    expect(() => assertCharBudget("probe", 101, dir)).toThrow(/grew from 100 to 101.*shrink-only/)
    expect(() => assertCharBudget("probe", 99, dir)).toThrow(/tighten the budget/)
  })

  it("GOLDEN_UPDATE rewrites the budget (a raise is announced; pnpm lint gates it)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    update(() => assertCharBudget("probe", 100, dir))
    update(() => assertCharBudget("probe", 120, dir))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ratchet-Exception"))
    expect(JSON.parse(fs.readFileSync(path.join(dir, "char-budgets.json"), "utf8"))).toEqual({
      probe: 120,
    })
  })

  it("is refused in CI too", () => {
    vi.stubEnv("CI", "true")
    update(() => expect(() => assertCharBudget("probe", 1, dir)).toThrow(/forbidden in CI/))
  })
})

describe("modelVisibleChars", () => {
  const visible = { name: "a_tool", description: "Does x.", inputSchema: { type: "object" } }
  const appOnly = {
    name: "a_data",
    description: "feed",
    inputSchema: { type: "object" },
    _meta: { ui: { visibility: ["app"] } },
  }

  it("counts name, title, description and inputSchema of model-visible tools only", () => {
    expect(isModelVisible(visible)).toBe(true)
    expect(isModelVisible(appOnly)).toBe(false)
    expect(isModelVisible({ ...appOnly, _meta: { ui: { visibility: ["model", "app"] } } })).toBe(
      true,
    )
    const base = "a_tool".length + "Does x.".length + '{"type":"object"}'.length
    expect(modelVisibleChars([visible, appOnly], "")).toBe(base)
    expect(modelVisibleChars([{ ...visible, title: "T" }], "")).toBe(base + 1)
  })

  it("adds the server instructions a client receives at initialize", () => {
    const base = "a_tool".length + "Does x.".length + '{"type":"object"}'.length
    expect(modelVisibleChars([visible], "Use x.")).toBe(base + 6)
    expect(modelVisibleChars([], "Use x.")).toBe(6)
  })
})

describe("repeatedParamDescriptions", () => {
  const withParams = (name: string, properties: Record<string, unknown>) => ({
    name,
    inputSchema: { type: "object", properties },
  })
  const engine = { type: "string", description: "Engine id" }

  it("reports a description on more than two model-visible tools, never one on two", () => {
    const three = ["a", "b", "c"].map((name) => withParams(name, { engine }))
    expect(repeatedParamDescriptions(three)).toEqual([
      { description: "Engine id", params: ["engine"], tools: ["a", "b", "c"] },
    ])
    expect(repeatedParamDescriptions(three.slice(0, 2))).toEqual([])
    expect(repeatedParamDescriptions(three, 3)).toEqual([])
  })

  it("never counts an app-only tool, and counts a tool once however often it repeats a text", () => {
    const appOnly = { ...withParams("d_data", { engine }), _meta: { ui: { visibility: ["app"] } } }
    // b carries the text twice: top level and inside a nested object.
    const twice = withParams("b", {
      engine,
      nested: { type: "object", properties: { engine } },
    })
    const tools = [withParams("a", { engine }), twice, appOnly]
    expect(repeatedParamDescriptions(tools)).toEqual([])
    expect(repeatedParamDescriptions([...tools, withParams("c", { engine })])).toEqual([
      { description: "Engine id", params: ["engine"], tools: ["a", "b", "c"] },
    ])
  })

  it("keys on the text alone: one text under several names repeats just the same", () => {
    const ms = { type: "number", description: "In milliseconds" }
    const tools = [
      withParams("a", { lockDuration: ms }),
      withParams("b", { retryTimeout: ms }),
      withParams("c", { lockDuration: ms }),
    ]
    expect(repeatedParamDescriptions(tools)).toEqual([
      {
        description: "In milliseconds",
        params: ["lockDuration", "retryTimeout"],
        tools: ["a", "b", "c"],
      },
    ])
  })

  it("walks every depth: nested objects, array items, map values and union branches", () => {
    const value = { description: "The value" }
    const tools = [
      withParams("a", { list: { type: "array", items: { properties: { value } } } }),
      withParams("b", { map: { type: "object", additionalProperties: { properties: { value } } } }),
      withParams("c", { either: { anyOf: [{ type: "null" }, { properties: { value } }] } }),
      withParams("d", {
        outer: { type: "object", properties: { inner: { properties: { value } } } },
      }),
      withParams("e", { value, other: { type: "string" }, flag: true }),
      { name: "f" },
      { name: "g", inputSchema: { type: "object", properties: "none" } },
    ]
    expect(repeatedParamDescriptions(tools, 4)).toEqual([
      { description: "The value", params: ["value"], tools: ["a", "b", "c", "d", "e"] },
    ])
  })
})
