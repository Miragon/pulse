import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"
import { FOCUS_RING, FOCUS_RING_INSET } from "./focus-ring.js"

/**
 * Forced colours (Windows contrast themes) drop the ring, a box-shadow, so the outline carries
 * focus there. Tailwind's `outline-hidden` keeps a transparent 2 px outline under forced colours,
 * which the browser paints in a system colour: written without a variant it frames every control
 * at rest and focus adds nothing visible. The kit writes it only under `focus-visible:`; the brand
 * gate `scanOutlines` of `@miragon/pulse-ui/testing` holds every source to it.
 */

/** The CSS Tailwind writes for `classes`, whitespace folded. */
async function css(classes: readonly string[]) {
  const theme = readFileSync(
    createRequire(import.meta.url).resolve("tailwindcss/theme.css"),
    "utf8",
  )
  const tailwind = await compile(`${theme}\n@tailwind utilities;`)
  return tailwind.build([...classes]).replace(/\s+/g, " ")
}

const classesOf = (ring: string) => ring.split(/\s+/)

describe("the kit's focus outline under forced colours", () => {
  it.each([
    ["FOCUS_RING", FOCUS_RING],
    ["FOCUS_RING_INSET", FOCUS_RING_INSET],
  ])("%s draws an outline there only while focus is visible", async (_, ring) => {
    expect(classesOf(ring)).not.toContain("outline-hidden")
    for (const name of classesOf(ring)) {
      const rule = await css([name])
      if (/@media \(forced-colors: active\)[^}]*outline/.test(rule)) {
        expect(rule, name).toMatch(/:focus-visible \{/)
      }
    }
  })

  it("FOCUS_RING keeps a 2 px outline there while focus is visible, which the system colours", async () => {
    expect(await css(classesOf(FOCUS_RING))).toMatch(
      /\.focus-visible\\:outline-hidden:focus-visible \{[^}]*@media \(forced-colors: active\) \{ outline: 2px solid transparent; outline-offset: 2px;/,
    )
  })

  it("FOCUS_RING_INSET draws that outline inside the element: its offset comes later at the same specificity", async () => {
    const rules = await css(classesOf(FOCUS_RING_INSET))
    const outline = rules.indexOf(".focus-visible\\:outline-hidden:focus-visible {")
    const inside = rules.indexOf(
      "@media (forced-colors: active) { .forced-colors\\:focus-visible\\:-outline-offset-2:focus-visible { outline-offset: calc(2px * -1); } }",
    )
    expect(outline).toBeGreaterThan(-1)
    expect(inside).toBeGreaterThan(outline)
  })
})
