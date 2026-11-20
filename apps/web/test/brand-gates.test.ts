import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
  stylesheetRules,
  stylesheetShapeFindings,
} from "@miragon/pulse-ui/testing"

/**
 * The page's own UI runs pulse-ui's brand gates like every widget package (CLAUDE.md invariant 6):
 * Lucide icons at the CI sizes, never a glyph, emoji or the AI sparkle; role names, never a raw
 * colour; no outline at rest under forced colours; text on the type scale. Its stylesheet builds
 * on pulse-ui's theme after Tailwind and keeps the view's shape.
 */
const SRC = fileURLToPath(new URL("../src", import.meta.url))

/**
 * The files that may draw the dense 12 px icon, each with its reason (the density deviation of
 * CLAUDE.md's design section: the icons on the diagram's 20 px overlays).
 */
const DENSE_ICONS_ALLOWED: Readonly<Record<string, string>> = {
  "screens/process/canvas-badge.tsx":
    "the incident's icon beside the count of incidents in called instances, a 22 px badge on the process diagram",
}
const STYLES = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8")

describe("the page's sources", () => {
  it("draw icons with Lucide, never glyphs, emoji or the sparkle", () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })

  it("draw icons at 16 and 24 px, the dense 12 px only on the diagram's overlays", () => {
    expect(scanIconSizes(SRC, { allowDense: DENSE_ICONS_ALLOWED })).toEqual([])
  })

  it("colour through role names only", () => {
    expect(scanColors(SRC)).toEqual([])
  })

  it("write outline-hidden only under a focus state", () => {
    expect(scanOutlines(SRC)).toEqual([])
  })

  it("set text on the type scale, weights 400, 600 and 700 only", () => {
    expect(scanTypeScale(SRC)).toEqual([])
  })
})

describe("the page's stylesheet", () => {
  it("keeps the view's shape: no height floor, no forced or inlined font, no raw colour", () => {
    expect(stylesheetShapeFindings(STYLES, "styles.css")).toEqual([])
  })

  it("builds on pulse-ui's theme after Tailwind, never its globals.css or fonts.css", () => {
    const rules = stylesheetRules(STYLES)
    const tailwind = rules.indexOf('@import "tailwindcss"')
    expect(tailwind).toBe(0)
    expect(rules.indexOf('@import "@miragon/pulse-ui/theme.css"')).toBeGreaterThan(tailwind)
    expect(rules).not.toMatch(/@miragon\/pulse-ui\/(?:globals|fonts)\.css/)
    // What the page renders, the brand gates' fixtures and the building blocks' tests left out.
    expect(rules).toMatch(/@source not "[^"]*packages\/core\/ui\/src\/testing"/)
    expect(rules).toMatch(/@source "[^"]*packages\/connectors\/engine\/engine-connector\/src"/)
    expect(rules).toMatch(/@source "[^"]*packages\/core\/blocks\/src"/)
  })

  it("lays every page on one ground, the app's ground, after the theme", () => {
    const rules = stylesheetRules(STYLES)
    const ground = rules.search(
      /@layer base\s*\{\s*html,\s*body\s*\{\s*@apply bg-background;\s*\}\s*\}/,
    )
    expect(ground).toBeGreaterThan(rules.indexOf('@import "@miragon/pulse-ui/theme.css"'))
  })
})
