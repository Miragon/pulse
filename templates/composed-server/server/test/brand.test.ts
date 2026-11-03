import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  contrastFindings,
  LIGHT_STATUS_EXEMPTION,
  parseThemeVariables,
  ROLE_CONTRAST_PAIRS,
  stylesheetRules,
  stylesheetShapeFindings,
  themeStylesheets,
  toneContrastPairs,
} from "@miragon/pulse-ui/testing"

/**
 * Your brand stays readable. src/ui/brand.css overrides role variables on top
 * of pulse-ui's Miragon theme; this measures the result in light AND dark,
 * the way the browser resolves it on <html> (text and each -foreground on
 * its fill 4.5:1, edges, dots, icons and the focus ring 3:1) for the
 * overrides you set and for the file's own example, over the whole stack the
 * browser applies (the theme, globals.css, brand.css). The surfaces are the
 * Miragon neutrals; inside a host that sends its palette the host's replace
 * them (see brand.css), so check your colours against those too.
 *
 * Both stylesheets are inlined into every view document, so they also keep
 * the view's shape (#339, pulse-ui's `stylesheetShapeFindings`): no
 * `min-height` floor on html/body/#root (auto-resize measures the document, so
 * every inline view would be that tall in the chat), no forced or inlined font
 * (Geist arrives by URL from the server's font route), no raw colour and no
 * `--cd-*` token of their own.
 */

const globalsCss = readFileSync(new URL("../src/ui/globals.css", import.meta.url), "utf8")
const brandCss = readFileSync(new URL("../src/ui/brand.css", import.meta.url), "utf8")
const miragon = themeStylesheets()

const STYLESHEETS = { "globals.css": globalsCss, "brand.css": brandCss }

/** The example at the end of brand.css as the two override blocks it stands for. */
function exampleOverrides(css: string): string {
  const between = (start: string, end: string) => {
    const from = css.indexOf(start)
    const to = css.indexOf(end, from)
    if (from === -1 || to === -1) throw new Error(`brand.css lost its "${start}" example`)
    return css
      .slice(from + start.length, to)
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .join("\n")
  }
  return [
    `:root { ${between("brand-example:light", "brand-example:dark")} }`,
    `.dark { ${between("brand-example:dark", "brand-example:end")} }`,
  ].join("\n")
}

/** The custom properties a stylesheet's rules declare (comments skipped). */
function declaredVariables(...stylesheets: string[]): string[] {
  const theme = parseThemeVariables(...stylesheets)
  return [...new Set([...theme.light.keys(), ...theme.dark.keys()])]
}

describe("brand.css", () => {
  const cases = [
    ["as shipped", parseThemeVariables(...miragon, globalsCss, brandCss)],
    [
      "with its example filled in",
      parseThemeVariables(...miragon, globalsCss, brandCss, exampleOverrides(brandCss)),
    ],
  ] as const

  // The CI's status exemption: a brand that lifts green and amber to 3:1 filters its entries.
  it.each(cases)("%s: every tone pair stays readable in light and dark", (_, theme) => {
    expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(LIGHT_STATUS_EXEMPTION)
  })

  it.each(cases)(
    "%s: text, each foreground on its fill, links, focus rings and field edges stay readable",
    (_, theme) => {
      expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
    },
  )

  it("builds on pulse-ui's Miragon theme", () => {
    expect(brandCss).toContain('@import "@miragon/pulse-ui/theme.css"')
  })

  it("sets role variables only: never a --cd-* token, never a variable the theme lacks", () => {
    const roles = new Set(
      declaredVariables(...miragon).filter((name) => !/^--(cd|color)-/.test(name)),
    )
    for (const css of [brandCss, exampleOverrides(brandCss)]) {
      for (const name of declaredVariables(css)) expect(roles).toContain(name)
    }
  })
})

describe("the view stylesheets (#339)", () => {
  it.each(Object.entries(STYLESHEETS))(
    "%s: keeps the view's shape (no height floor, no forced or inlined font, no raw colour or --cd-* token)",
    (file, css) => {
      expect(stylesheetShapeFindings(css, file)).toEqual([])
    },
  )

  it("globals.css builds on pulse-ui's Miragon theme through brand.css, after Tailwind", () => {
    const globals = stylesheetRules(globalsCss)
    expect(globals.indexOf('@import "tailwindcss"')).toBe(0)
    expect(globals).toContain('@import "./brand.css"')
    expect(globals).not.toContain("@miragon/pulse-ui/globals.css")
    // The tarball's dist carries no tests (pulse-ui's package.json `files`), so the
    // template scans it whole: no fixture class reaches your stylesheet.
    expect(globals).toMatch(/@source "[^"]*node_modules\/@miragon\/pulse-ui\/dist"/)
    expect(globals).not.toMatch(/@source not/)
  })
})
