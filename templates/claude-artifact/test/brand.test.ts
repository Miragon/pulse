import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  BARE_PAUSE_RULE_EN,
  catalogTextFindings,
  contrastFindings,
  COUNT_TERMS,
  glossaryFindings,
  LIGHT_STATUS_EXEMPTION,
  parseThemeVariables,
  PRODUCT_GLOSSARY,
  ROLE_CONTRAST_PAIRS,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
  stylesheetShapeFindings,
  themeStylesheets,
  toneContrastPairs,
} from "@miragon/pulse-ui/testing"
import { describe, expect, it } from "vitest"
import { ERROR_CATALOGS } from "../src/engine/errors.ts"
import { DE, EN } from "../src/messages.ts"
import { COUNT_TERMS as COUNT_TERMS_COPY } from "../src/temporary/count-terms.ts"

/**
 * pulse-ui's brand gates over the page (ESLint's gates do not reach a template, so these hold it):
 * colours by role only, Lucide icons at 16 or 24 px, the type scale, no hidden outline at rest,
 * the voice rules and the product's words in English and German, the stylesheets' shape and
 * every role pair readable in light and dark.
 */

const SRC = join(import.meta.dirname, "../src")
const SCAN = { timeout: 30_000 }
const APP_CSS = readFileSync(join(SRC, "app.css"), "utf8")
const DIAGRAM_CSS = readFileSync(join(SRC, "temporary/diagram.css"), "utf8")

/** The density section's 12 px icon, only where a reason names it. */
const DENSE_ICONS = {
  "temporary/canvas-badge.tsx":
    "the incident icon inside a 22 px count badge on the BPMN canvas, as the web app's badge",
}

describe("the page's sources", () => {
  it("colour through role names only", SCAN, () => {
    expect(scanColors(SRC)).toEqual([])
  })

  it("draw icons with Lucide, never glyphs or emoji", SCAN, () => {
    expect(scanGlyphs(SRC)).toEqual([])
  })

  it("draw icons at 16 or 24 px, 12 px only on the canvas badge", SCAN, () => {
    expect(scanIconSizes(SRC, { allowDense: DENSE_ICONS })).toEqual([])
  })

  it("set text on the type scale and its three weights", SCAN, () => {
    expect(scanTypeScale(SRC).map((f) => `${f.file}:${String(f.line)} ${f.match}`)).toEqual([])
  })

  it("hide no outline at rest", SCAN, () => {
    expect(scanOutlines(SRC)).toEqual([])
  })
})

describe("the page's words", () => {
  it("hold the same keys in English and German", () => {
    expect(Object.keys(DE).sort()).toEqual(Object.keys(EN).sort())
  })

  it.each([
    ["en", EN, ERROR_CATALOGS.en],
    ["de", DE, ERROR_CATALOGS.de],
  ] as const)("follow the voice rules and the glossary (%s)", (language, page, errors) => {
    const rules =
      language === "en" ? [...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN] : PRODUCT_GLOSSARY.de
    for (const catalog of [page, errors]) {
      expect(catalogTextFindings(catalog, { language })).toEqual([])
      expect(glossaryFindings(catalog, rules)).toEqual([])
    }
  })

  it("copy pulse-ui's count words exactly, until they are browser data (#667)", () => {
    for (const term of ["incidents", "withIncident", "allVersions"] as const) {
      expect(COUNT_TERMS_COPY[term].en).toBe(COUNT_TERMS[term].en)
      expect(COUNT_TERMS_COPY[term].de).toBe(COUNT_TERMS[term].de)
    }
    expect(COUNT_TERMS_COPY.incidents.long).toEqual(COUNT_TERMS.incidents.long)
  })
})

describe("the stylesheets", () => {
  it.each([
    ["app.css", APP_CSS],
    ["temporary/diagram.css", DIAGRAM_CSS],
  ])(
    "%s keeps its shape: no height floor, no forced or inlined font, no raw colour, no --cd-* token",
    (file, css) => {
      expect(stylesheetShapeFindings(css, file)).toEqual([])
    },
  )

  it("app.css builds on pulse-ui's theme after Tailwind, never its globals.css", () => {
    expect(APP_CSS.indexOf('@import "tailwindcss"')).toBe(0)
    expect(APP_CSS).toContain('@import "@miragon/pulse-ui/theme.css"')
    expect(APP_CSS).not.toContain("@miragon/pulse-ui/globals.css")
  })

  it("keeps every tone pair and every role pair readable in light and dark", () => {
    const theme = parseThemeVariables(...themeStylesheets(), APP_CSS, DIAGRAM_CSS)
    expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(LIGHT_STATUS_EXEMPTION)
    expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
  })
})
