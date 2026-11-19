import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { scanGlyphs, scanOutlines } from "@miragon/pulse-ui/testing"

// The host bundle's own UI runs pulse-ui's glyph and outline gates like every widget package: no
// glyph or emoji as an icon, no Lucide sparkle as the AI affordance (CI U4, CLAUDE.md invariant 6)
// and no outline at rest under forced colours.
const UI_DIR = fileURLToPath(new URL("../src/ui", import.meta.url))

describe("the host bundle draws icons with Lucide, never glyphs, emoji or the AI sparkle", () => {
  it("no forbidden glyph, emoji, lone-symbol icon or sparkle import in src/ui", () => {
    expect(scanGlyphs(UI_DIR)).toEqual([])
  })
})

describe("the host bundle draws no outline at rest under forced colours", () => {
  it("src/ui writes outline-hidden only under a focus state, never at rest", () => {
    expect(scanOutlines(UI_DIR)).toEqual([])
  })
})
