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

/** The folders of the blocks: a board's tiles and the screens' blocks. */
const BLOCKS = ["board", "screens"].map((folder) => join(SRC, folder))

/**
 * Each scan reads every source of the package from disk: 0.15 s alone, up to 2.3 s on the CI
 * runner, where `pnpm test` runs every package's suite at once on four cores.
 */
const SCAN = { timeout: 30_000 }

/** The brand gates every Pulse UI runs over its own sources (CLAUDE.md invariant 6). */
describe("the building blocks keep the brand", SCAN, () => {
  it("draw function icons with Lucide, never a glyph, an emoji or a sparkle", () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })

  it("draw icons at the CI sizes, 16 and 24 px, and no 12 px icon", () => {
    expect(BLOCKS.flatMap((folder) => scanIconSizes(folder))).toEqual([])
  })

  it("colour through role names only, never a palette class or a raw colour", () => {
    expect(BLOCKS.flatMap((folder) => scanColors(folder))).toEqual([])
  })

  it("write outline-hidden only under a focus state", () => {
    expect(BLOCKS.flatMap((folder) => scanOutlines(folder))).toEqual([])
  })

  it("set text on the type scale: five steps, 13 px at least, weights 400, 600 and 700", () => {
    expect(BLOCKS.flatMap((folder) => scanTypeScale(folder))).toEqual([])
  })
})
