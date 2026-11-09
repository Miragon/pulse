import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { assertGolden, UPDATE_COMMAND } from "./golden.js"

let scratch = ""

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pulse-engine-adapter-golden-"))
  vi.stubEnv("GOLDEN_UPDATE", "")
  vi.stubEnv("CI", "")
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("the golden helper on a scratch directory, never the real goldens", () => {
  test("a missing golden is refused with the one update path and never created", () => {
    expect(() => {
      assertGolden("probe", { a: 1 }, scratch)
    }).toThrow(UPDATE_COMMAND)
    expect(readdirSync(scratch)).toEqual([])
    expect(UPDATE_COMMAND).toBe(
      "pnpm --fail-if-no-match --filter @miragon/pulse-engine-adapter golden:update",
    )
  })

  test("an update in CI is refused and writes nothing", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    vi.stubEnv("CI", "true")
    expect(() => {
      assertGolden("probe", { a: 1 }, scratch)
    }).toThrow(/forbidden in CI/)
    expect(readdirSync(scratch)).toEqual([])
  })

  test("a local update writes sorted keys, and a plain run then compares against it", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    assertGolden("probe", { b: 2, a: 1 }, scratch)
    expect(readFileSync(join(scratch, "probe.json"), "utf8")).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
    vi.stubEnv("GOLDEN_UPDATE", "")
    expect(() => {
      assertGolden("probe", { a: 1, b: 2 }, scratch)
    }).not.toThrow()
    expect(() => {
      assertGolden("probe", { a: 1, b: 3 }, scratch)
    }).toThrow(/never edit a golden by hand/)
  })
})
