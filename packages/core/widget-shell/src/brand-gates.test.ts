import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { scanColors, scanGlyphs, scanIconSizes, scanTypeScale } from "@miragon/pulse-ui/testing"

// The scans of the kit's widget code. Outside src/ui: they read sources from disk, and
// tsconfig.widgets.json is browser-only. The catalog text and glossary checks of the kit's
// words are src/ui/kit-words.test.ts.
const UI_DIR = fileURLToPath(new URL("./ui/", import.meta.url))

describe("kit widget code draws icons with Lucide, never glyphs or emoji", () => {
  it("src/ui has no forbidden glyph in JSX or strings", () => {
    expect(scanGlyphs(UI_DIR)).toEqual([])
  })
})

/**
 * The density section's named deviation (root CLAUDE.md): 12 px icons beside dense text and on
 * 20 px badges, per file with its reason. Shrink-only: a listed file that draws no 12 px icon
 * fails as an unused allowance.
 */
const DENSE_ICONS_ALLOWED: Readonly<Record<string, string>> = {
  "id-text.tsx": "the copy button beside an id is 24 px (the xs control), so its icon is 12 px",
}

describe("kit widget code draws icons at the CI sizes", () => {
  it("src/ui has no icon at a size other than 16 or 24 px, at 12 px only in the files the dense deviation names", () => {
    expect(scanIconSizes(UI_DIR, { allowDense: DENSE_ICONS_ALLOWED })).toEqual([])
  })
})

describe("kit widget code sets text on the type scale", () => {
  it("src/ui has no text size off the five steps, nothing below 13 px, no weight but 400, 600 and 700", () => {
    expect(scanTypeScale(UI_DIR)).toEqual([])
  })
})

/**
 * Tailwind's `outline-hidden` keeps a transparent 2 px outline under forced colours, which the
 * browser paints: without a variant it frames a control at rest. Only `focus-visible:outline-hidden`
 * (pulse-ui's FOCUS_RING) or `outline-none` on a focus holder.
 */
describe("kit widget code draws no outline at rest under forced colours", () => {
  it("src/ui writes outline-hidden only under focus-visible", () => {
    const bare = readdirSync(UI_DIR, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) =>
        /(?:^|[\s"'`])outline-hidden(?=[\s"'`]|$)/m.test(readFileSync(`${UI_DIR}${file}`, "utf8")),
      )
    expect(bare).toEqual([])
  })
})

describe("kit widget code colours through role names only", () => {
  it("src/ui has no palette class or raw colour", () => {
    expect(scanColors(UI_DIR)).toEqual([])
  })
})
