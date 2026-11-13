/**
 * The golden helper of the CLI (test/support/golden.ts) on a scratch directory, so the real
 * goldens stay untouched even when a broken CI guard would let an update through: a missing
 * golden is refused and never created, an update in CI is refused and writes nothing, and a local
 * update writes the file a plain run then compares against.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { assertGolden, UPDATE_COMMAND } from "../../../test/support/golden.js"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pulse-cli-golden-"))
  vi.stubEnv("GOLDEN_UPDATE", "")
  vi.stubEnv("CI", "")
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe("the golden helper", () => {
  it("refuses a missing golden, names the one update path and creates nothing", () => {
    expect(() => {
      assertGolden("outputs", "probe", { a: 1 }, root)
    }).toThrow(UPDATE_COMMAND)
    expect(readdirSync(root)).toEqual([])
    expect(UPDATE_COMMAND).toBe("pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update")
  })

  it("refuses an update in CI and writes nothing", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    vi.stubEnv("CI", "true")
    expect(() => {
      assertGolden("outputs", "probe", { a: 1 }, root)
    }).toThrow(/forbidden in CI/)
    expect(readdirSync(root)).toEqual([])
  })

  it("writes a local update with sorted keys, and a plain run then compares against it", () => {
    vi.stubEnv("GOLDEN_UPDATE", "1")
    assertGolden("outputs", "probe", { b: 2, a: 1 }, root)
    expect(readFileSync(join(root, "outputs", "probe.json"), "utf8")).toBe(
      '{\n  "a": 1,\n  "b": 2\n}\n',
    )
    vi.stubEnv("GOLDEN_UPDATE", "")
    expect(() => {
      assertGolden("outputs", "probe", { a: 1, b: 2 }, root)
    }).not.toThrow()
    expect(() => {
      assertGolden("outputs", "probe", { a: 1, b: 3 }, root)
    }).toThrow(/never edit a golden by hand/)
  })
})
