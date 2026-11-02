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
 * The app's stylesheet, which every view document inlines. It builds on
 * pulse-ui's Miragon theme (`@miragon/pulse-ui/theme.css`: the vendored
 * `--cd-*` tokens plus the role layer, light and dark) and may only override
 * ROLE variables on top. Pinned here at the source (test:host re-checks the
 * BUILT bundle; the template's stylesheets are its own `brand.test.ts`, the
 * token drift scan is pulse-ui's `token-drift.test.ts`): the view's shape
 * (#339, pulse-ui's `stylesheetShapeFindings`: no height floor, no forced or
 * inlined font, no raw colour, no `--cd-*` token), the theme after Tailwind,
 * and the tone and role pairs at WCAG AA in light AND dark over what ships.
 */

const APP_CSS = readFileSync(new URL("../src/ui/globals.css", import.meta.url), "utf8")

const kit = themeStylesheets()

describe("the app's stylesheet (#339)", () => {
  it("keeps the view's shape: no height floor, no forced or inlined font, no raw colour or --cd-* token", () => {
    expect(stylesheetShapeFindings(APP_CSS, "globals.css")).toEqual([])
  })

  it("builds on pulse-ui's Miragon theme after Tailwind, never its globals.css", () => {
    const rules = stylesheetRules(APP_CSS)
    const tailwind = rules.indexOf('@import "tailwindcss"')
    const theme = rules.indexOf('@import "@miragon/pulse-ui/theme.css"')
    expect(tailwind).toBe(0)
    expect(theme).toBeGreaterThan(tailwind)
    expect(rules).not.toContain("@miragon/pulse-ui/globals.css")
    // The theme cannot know where the kit lives: the consumer scans its
    // components (Card, Skeleton, the kit pieces …) itself. The app reads the
    // workspace sources, where the brand gates' fixtures sit in src/testing.
    expect(rules).toMatch(/@source "[^"]*packages\/core\/ui\/src"/)
    expect(rules).toMatch(/@source not "[^"]*packages\/core\/ui\/src\/testing"/)
  })
})

describe("the app's stylesheet: role variables over the Miragon theme", () => {
  it("every TONE_* pair reaches AA in light and dark (apart from the CI's status exemption)", () => {
    const theme = parseThemeVariables(...kit, APP_CSS)
    expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(LIGHT_STATUS_EXEMPTION)
  })

  it("text, each foreground on its fill, links, focus rings and field edges reach AA in light and dark", () => {
    const theme = parseThemeVariables(...kit, APP_CSS)
    expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
  })
})
