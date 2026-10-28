import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  catalogTextFindings,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanTypeScale,
} from "@miragon/pulse-widget-shell/testing"
import { deAskAi } from "./messages/de.ask-ai.js"
import { deBuilder } from "./messages/de.builder.js"
import { deServer } from "./messages/de.server.js"
import { deSweep } from "./messages/de.sweep.js"
import { enAskAi } from "./messages/en.ask-ai.js"
import { enBuilder } from "./messages/en.builder.js"
import { enServer } from "./messages/en.server.js"
import { enSweep } from "./messages/en.sweep.js"

/** brand-lint reads Markdown only, so these gate the strings in `.ts`/`.tsx`. */
describe("analytics copy follows the voice rules", () => {
  it.each([
    ["widget texts (de)", deSweep, "de"],
    ["widget texts (en)", enSweep, "en"],
    ["Ask-AI intents (de)", deAskAi, "de"],
    ["Ask-AI intents (en)", enAskAi, "en"],
    ["model summaries (de)", deServer, "de"],
    ["model summaries (en)", enServer, "en"],
    ["view builder names (de)", deBuilder, "de"],
    ["view builder names (en)", enBuilder, "en"],
  ] as const)("%s", (_, catalog, language) => {
    expect(catalogTextFindings(catalog, { language })).toEqual([])
  })
})

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))

describe("analytics widgets draw icons with Lucide, never glyphs or emoji", () => {
  it.each(["./widgets", "./messages"])("%s has no forbidden glyph in JSX or strings", (rel) => {
    expect(scanGlyphs(dir(rel))).toEqual([])
  })
})

describe("analytics widgets draw icons at the CI sizes", () => {
  // A 12 or 14 px icon would be a third size in the same view.
  it("src/widgets has no icon at a size other than 16 or 24 px", () => {
    expect(scanIconSizes(dir("./widgets"))).toEqual([])
  })
})

describe("analytics widgets colour through role names only", () => {
  it("src/widgets has no palette class or raw colour", () => {
    expect(scanColors(dir("./widgets"))).toEqual([])
  })
})

describe("analytics widgets set their text on the CI type scale", () => {
  // No Tailwind size and nothing below the 13 px floor (text-xs).
  it("src/widgets uses only the type-scale steps", () => {
    expect(scanTypeScale(dir("./widgets"))).toEqual([])
  })
})
