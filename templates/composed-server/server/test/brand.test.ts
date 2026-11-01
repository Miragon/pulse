import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  contrastFindings,
  parseThemeVariables,
  ROLE_CONTRAST_PAIRS,
  toneContrastPairs,
  themeStylesheets,
} from "@miragon/pulse-ui/testing"

/**
 * Your brand stays readable. src/ui/brand.css overrides role variables on top
 * of pulse-ui's Miragon theme; this measures the result in light AND dark,
 * the way the browser resolves it on <html> (text and each -foreground on
 * its fill 4.5:1, edges, dots, icons and the focus ring 3:1) for the
 * overrides you set and for the file's own example. The surfaces are the
 * Miragon neutrals; inside a host that sends its palette the host's replace
 * them (see brand.css), so check your colours against those too.
 */

const brandCss = readFileSync(new URL("../src/ui/brand.css", import.meta.url), "utf8")
const miragon = themeStylesheets()

/**
 * The CI's own exemption: on a light ground success green and amber reach
 * only 1.67:1 / 1.83:1 as a dot, edge or icon, so a status always sits next
 * to its words. A brand that lifts them to 3:1 drops the entries.
 */
const LIGHT_STATUS_EXEMPTION = ["success", "warning"].flatMap((tone) =>
  ["on card", "on background"]
    .flatMap((surface) =>
      ["DOT", "ICON", "BORDER"].map((role) => `TONE_${role}.${tone} ${surface}`),
    )
    .concat([`TONE_DOT.${tone} inside its tint`, `TONE_ICON.${tone} inside its tint`])
    .map((pair) => `light: ${pair}`),
)

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
    ["as shipped", parseThemeVariables(...miragon, brandCss)],
    [
      "with its example filled in",
      parseThemeVariables(...miragon, brandCss, exampleOverrides(brandCss)),
    ],
  ] as const

  it.each(cases)("%s: every tone pair stays readable in light and dark", (_, theme) => {
    expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(
      [...LIGHT_STATUS_EXEMPTION].sort(),
    )
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

  it("sets role variables only — never a --cd-* token, never a variable the theme lacks", () => {
    const roles = new Set(
      declaredVariables(...miragon).filter((name) => !/^--(cd|color)-/.test(name)),
    )
    for (const css of [brandCss, exampleOverrides(brandCss)]) {
      for (const name of declaredVariables(css)) expect(roles).toContain(name)
    }
  })
})
