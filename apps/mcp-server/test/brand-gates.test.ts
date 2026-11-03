import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { scanGlyphs } from "@miragon/pulse-ui/testing"

// The host bundle's own UI runs pulse-ui's glyph gate like every widget package: no glyph or emoji
// as an icon and no Lucide sparkle as the AI affordance (CI U4, CLAUDE.md invariant 6).
const UI_DIR = fileURLToPath(new URL("../src/ui", import.meta.url))

describe("the host bundle draws icons with Lucide, never glyphs, emoji or the AI sparkle", () => {
  it("no forbidden glyph, emoji, lone-symbol icon or sparkle import in src/ui", () => {
    expect(scanGlyphs(UI_DIR)).toEqual([])
  })
})
