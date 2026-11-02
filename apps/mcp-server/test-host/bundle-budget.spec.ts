import { readFileSync } from "node:fs"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { expect, test } from "@playwright/test"

/**
 * The widget bundle every view resource inlines (#344 K39): each view a host
 * reads carries all of it, so its size is the cost of every widget render.
 * The ceilings live in `test/__golden__/bundle-budget.json` and only shrink
 * (`scripts/check-ratchets.mjs`): a bundle that outgrows one needs a
 * reviewed `Ratchet-Exception`, and one that shrank well below its ceiling
 * lowers it, so the headroom never silently piles up.
 */

const APP = path.resolve(import.meta.dirname, "..")
const BUDGET = JSON.parse(
  readFileSync(path.join(APP, "test", "__golden__", "bundle-budget.json"), "utf8"),
) as Record<string, number | string>
/** Below this share of its ceiling a bundle lowers the ceiling. */
const TIGHT = 0.9

const budgets = Object.entries(BUDGET).filter(
  (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
)

test.describe("the widget bundle stays within its budget", () => {
  test("names the bundle's files", () => {
    expect(budgets.map(([file]) => file).sort()).toEqual(["mcp-app.css", "mcp-app.js"])
  })

  for (const [file, ceiling] of budgets) {
    test(`${file}: gzip at most ${ceiling} bytes, and close to it`, () => {
      const gzip = gzipSync(readFileSync(path.join(APP, "dist", file))).length
      expect(
        gzip,
        `${file} is ${gzip} bytes gzip, over its ceiling of ${ceiling}: shrink it, or raise the ceiling in test/__golden__/bundle-budget.json with a Ratchet-Exception trailer that says why`,
      ).toBeLessThanOrEqual(ceiling)
      expect(
        gzip,
        `${file} is ${gzip} bytes gzip, well below its ceiling of ${ceiling}: lower the ceiling to about ${Math.ceil((gzip * 1.03) / 100) * 100}`,
      ).toBeGreaterThanOrEqual(Math.floor(ceiling * TIGHT))
    })
  }
})
