import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
} from "@miragon/pulse-ui/testing"
import { describe, expect, it } from "vitest"

const SRC = fileURLToPath(new URL(".", import.meta.url))

/** The brand gates every Pulse UI runs over its own sources (CLAUDE.md invariant 6). */
describe("the building blocks keep the brand", () => {
  it("draw function icons with Lucide, never a glyph, an emoji or a sparkle", () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })

  it("draw icons at the CI sizes, 16 and 24 px, and no 12 px icon", () => {
    expect(scanIconSizes(join(SRC, "board"))).toEqual([])
  })

  it("colour through role names only, never a palette class or a raw colour", () => {
    expect(scanColors(join(SRC, "board"))).toEqual([])
  })

  it("write outline-hidden only under a focus state", () => {
    expect(scanOutlines(join(SRC, "board"))).toEqual([])
  })

  it("set text on the type scale: five steps, 13 px at least, weights 400, 600 and 700", () => {
    expect(scanTypeScale(join(SRC, "board"))).toEqual([])
  })
})
