import { describe, expect, it } from "vitest"
import { DENSE_ICON_STROKE, ICON_STROKE } from "./icon.js"

/**
 * The Lucide stroke (CI §11): the two constants of `icon.tsx`, 2.5 for the view
 * and 2 in dense chrome bars. Kit code takes every stroke from them, never a
 * literal, so the two can never disagree; and no CSS rule
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

/** A stroke expression built from the two constants only (`dense ? A : B` included). */
const FROM_CONSTANTS =
  /^(?:[\w.]+\s*\?\s*)?(?:DENSE_ICON_STROKE|ICON_STROKE)(?:\s*:\s*(?:DENSE_ICON_STROKE|ICON_STROKE))?$/

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
  it("is 2.5 for the view and 2 in dense bars (CI §11)", () => {
    expect(ICON_STROKE).toBe(2.5)
    expect(DENSE_ICON_STROKE).toBe(2)
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
    expect("dense ? DENSE_ICON_STROKE : ICON_STROKE").toMatch(FROM_CONSTANTS)
  })
})
