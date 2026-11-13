import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
} from "@miragon/pulse-ui/testing"

// Outside `src/widgets`: it reads sources from disk (the widget tsconfig is browser-only).
const SRC = fileURLToPath(new URL(".", import.meta.url))

describe("engine draws function icons with Lucide, never glyphs or emoji", () => {
  // Widget code, message catalogs and the server's summaries alike: a glyph
  // in a catalog string renders in the host's font, colour emoji included.
  it("no forbidden glyph, emoji, lone-symbol icon or sparkle import anywhere in src", () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })
})

/**
 * The density section's named deviation (root CLAUDE.md): 12 px icons (`Icon dense`) beside
 * dense text and on 20 px badges, per file with its reason. Shrink-only: a listed file that
 * draws no 12 px icon fails as an unused allowance.
 */
const DENSE_ICONS_ALLOWED: Readonly<Record<string, string>> = {
  "cockpit-app/breadcrumb.tsx": "the chevron between the trail's 13 px entries",
  "cockpit-app/fleet-landscape.tsx": "the info icon leading a 13 px note",
  "cockpit-app/fleet-view.tsx": "the arrow after an engine card's 13 px way in",
  "cockpit-app/landing.tsx": "the arrow closing an engine's row of 13 px text",
}

describe("engine draws icons at the CI sizes", () => {
  // Chrome icons take the kit Icon's 16 px default; a 14 or 20 px icon beside them is a third
  // size in the same view.
  it("no icon at a size other than 16 or 24 px, at 12 px only in the files the dense deviation names", () => {
    expect(scanIconSizes(join(SRC, "widgets"), { allowDense: DENSE_ICONS_ALLOWED })).toEqual([])
  })
})

describe("engine widget code colours through role names only", () => {
  it("no palette class or raw colour outside the reasoned allowances", () => {
    // Shrink-only: the colour pass (M5) moves these onto the role tokens, and
    // a file that loses its raw colours fails here until its entry goes.
    expect(scanColors(join(SRC, "widgets"))).toEqual([])
  })
})

describe("engine widget code draws no outline at rest under forced colours", () => {
  // Tailwind's outline-hidden is a transparent 2 px outline that a Windows contrast theme paints:
  // outside a focus state it frames a control at rest, and focus adds nothing visible. The browser
  // code is the widgets and what they share (`src/lib/shared`).
  it.each(["widgets", "lib/shared"])(
    "src/%s writes outline-hidden only under a focus state (pulse-ui's FOCUS_RING)",
    (dir) => {
      expect(scanOutlines(join(SRC, dir))).toEqual([])
    },
  )
})

/** The browser code's sources (the widgets and what they share), their tests left out. */
function widgetSources(): Array<{ file: string; text: string }> {
  return ["widgets", "lib/shared"].flatMap((dir) =>
    readdirSync(join(SRC, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test(-support)?\.tsx?$/.test(file))
      .map((file) => ({
        file: `${dir}/${file}`,
        text: readFileSync(join(SRC, dir, file), "utf8"),
      })),
  )
}

describe("engine widget code titles its sections with the kit's SectionHeading", () => {
  // One look for every section title (13 px at 600 in the foreground, the webview's): a heading
  // composed by hand drifted from it once (a quiet one beside foreground ones), so a section's
  // title is pulse-ui's SectionHeading (`as` for its level) or a collapsible Section.
  it("no h2 to h6 and no MICRO_LABEL composed by hand", () => {
    const found = widgetSources().flatMap(({ file, text }) =>
      [...text.matchAll(/<h[2-6][\s>]|\bMICRO_LABEL\b/g)].map((match) => `${file}: ${match[0]}`),
    )
    expect(found).toEqual([])
  })
})

describe("engine widget code sets text on the type scale", () => {
  // CI §4 as pulse-ui's TYPE_SCALE (#322 M6): title 28, section 21, body
  // 16, dense 13 (tables, controls), small 13 (the floor). No Tailwind sizes,
  // weights 400, 600 and 700 only.
  it("no text size off the five steps, nothing below 13 px, no weight but 400, 600 and 700", () => {
    expect(scanTypeScale(join(SRC, "widgets"))).toEqual([])
  })
})
