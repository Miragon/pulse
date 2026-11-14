import { describe, expect, it } from "vitest"
import { ICON_STROKE } from "./icon.js"

/**
 * The Lucide stroke (CI §11): the constant of `icon.tsx`, 2.5 at every size, the
 * 12 px dense icon included (the guide gives stroke 2 only to 20 px palette
 * tools, which Pulse draws none of). Kit code takes every stroke from it, never a
 * literal; and no CSS rule
 * (`svg.lucide { stroke-width }`) in the theme, which would beat the stroke a
 * `LucideProvider` or an `Icon` sets.
 */

declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { query: "?raw"; import: "default"; eager: true },
    ): Record<string, string>
  }
}

const STYLESHEETS = import.meta.glob(["../*.css", "../tokens/*.css"], {
  query: "?raw",
  import: "default",
  eager: true,
})

const SOURCES = import.meta.glob(["../**/*.tsx", "!../**/*.test.tsx", "!../render-cases*.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
})

/** A stroke expression that is the constant. */
const FROM_CONSTANTS = /^ICON_STROKE$/

function strokeUses(): string[][] {
  return Object.entries(SOURCES).flatMap(([file, source]) =>
    [...source.matchAll(/<(\w+)[^<>]*?\bstrokeWidth=\{([^}]*)\}/g)].map((m) => [
      file,
      m[1] ?? "",
      (m[2] ?? "").trim(),
    ]),
  )
}

describe("Lucide stroke", () => {
  it("is 2.5 at every size (CI §11)", () => {
    expect(ICON_STROKE).toBe(2.5)
  })

  it("is never set in CSS (theme.css, globals.css, fonts.css, the vendored tokens)", () => {
    expect(Object.keys(STYLESHEETS)).toEqual(
      expect.arrayContaining([
        "../theme.css",
        "../globals.css",
        "../fonts.css",
        "../tokens/cd-tokens.generated.css",
      ]),
    )
    for (const [file, css] of Object.entries(STYLESHEETS)) {
      expect(css, file).not.toMatch(/stroke-width/)
    }
  })

  it("is taken from the icon-stroke constants wherever kit code sets one", () => {
    const uses = strokeUses()
    for (const [file, element, value] of uses) {
      expect(value, `${file}: <${element} strokeWidth={${value}}>`).toMatch(FROM_CONSTANTS)
    }
    // `Icon` itself and the default glyph of `TableEmptyState`.
    expect(uses.map(([file]) => file)).toEqual(
      expect.arrayContaining(["./icon.tsx", "./table.tsx"]),
    )
  })

  it("catches a literal stroke (self-test)", () => {
    expect("2.5").not.toMatch(FROM_CONSTANTS)
    expect("dense ? 2 : ICON_STROKE").not.toMatch(FROM_CONSTANTS)
    expect("ICON_STROKE").toMatch(FROM_CONSTANTS)
  })
})
