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

describe("kit widget code draws icons at the CI sizes", () => {
  it("src/ui has no icon at a size other than 16 or 24 px", () => {
    expect(scanIconSizes(UI_DIR)).toEqual([])
  })
})

describe("kit widget code sets text on the type scale", () => {
  it("src/ui has no text size off the five steps and nothing below 13 px", () => {
    expect(scanTypeScale(UI_DIR)).toEqual([])
  })
})

describe("kit widget code colours through role names only", () => {
  it("src/ui has no palette class or raw colour", () => {
    expect(scanColors(UI_DIR)).toEqual([])
  })
})
