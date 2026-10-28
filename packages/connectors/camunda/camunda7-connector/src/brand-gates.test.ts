import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanTypeScale,
} from "@miragon/pulse-widget-shell/testing"

// Outside `src/widgets`: it reads sources from disk (the widget tsconfig is browser-only).
const SRC = fileURLToPath(new URL(".", import.meta.url))

describe("camunda7 draws function icons with Lucide, never glyphs or emoji", () => {
  // Widget code, message catalogs and the server's summaries alike: a glyph
  // in a catalog string renders in the host's font, colour emoji included.
  it("no forbidden glyph, emoji, lone-symbol icon or sparkle import anywhere in src", () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })
})

describe("camunda7 draws icons at the CI sizes", () => {
  // Chrome icons take the kit Icon's 16 px default (`dense` for tight rows);
  // a 14 or 20 px icon beside them is a third size in the same view.
  it("no icon at a size other than 16 or 24 px", () => {
    expect(scanIconSizes(join(SRC, "widgets"))).toEqual([])
  })
})

describe("camunda7 widget code colours through role names only", () => {
  it("no palette class or raw colour outside the reasoned allowances", () => {
    // Shrink-only: the colour pass (M5) moves these onto the role tokens, and
    // a file that loses its raw colours fails here until its entry goes.
    expect(scanColors(join(SRC, "widgets"))).toEqual([])
  })
})

describe("camunda7 widget code sets text on the type scale", () => {
  // CI §4 as the toolkit's TYPE_SCALE (#322 M6): title 28, section 21, body
  // 16, dense 14 (tables, controls), small 13 — the floor. No Tailwind sizes.
  it("no text size off the five steps and nothing below 13 px", () => {
    expect(scanTypeScale(join(SRC, "widgets"))).toEqual([])
  })
})
