import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"
import { FOCUS_RING, FOCUS_RING_INSET } from "./focus-ring.js"

/**
 * Forced colours (Windows contrast themes) drop the ring, a box-shadow, so the outline carries
 * focus there. Tailwind's `outline-hidden` keeps a transparent 2 px outline under forced colours,
 * which the browser paints in a system colour: written without a variant it frames every control
 * at rest and focus adds nothing visible. The kit writes it only under `focus-visible:`.
 */

const SRC = fileURLToPath(new URL("../", import.meta.url))

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

/** A class token `outline-hidden` without a variant. */
const BARE_OUTLINE_HIDDEN = /(?:^|[\s"'`])outline-hidden(?=[\s"'`]|$)/

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

  it("no kit source writes outline-hidden without a variant", () => {
    const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.tsx?$/.test(file) && !/\.test(?:-support)?\.tsx?$/.test(file),
    )
    const bare = sources.filter((file) =>
      readFileSync(`${SRC}${file}`, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(?:\*|\/\/|\/\*)/.test(line))
        .some((line) => BARE_OUTLINE_HIDDEN.test(line)),
    )
    expect(sources.length).toBeGreaterThan(50)
    expect(bare).toEqual([])
  })
})
