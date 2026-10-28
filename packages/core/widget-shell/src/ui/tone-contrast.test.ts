import { describe, expect, it } from "vitest"
import {
  ROLE_CONTRAST_PAIRS,
  contrastFindings,
  measureContrast,
  parseThemeVariables,
  toneContrastPairs,
  toolkitThemeStylesheets,
} from "../testing/index.js"

/** WCAG AA on the toolkit theme in light AND dark: 4.5:1 for text, 3:1 for dots, edges and icons. */

const shipped = toolkitThemeStylesheets()
const theme = parseThemeVariables(...shipped)

/**
 * CI exemption (§3.3): success green and amber reach only ~1.7:1 on light, so a
 * status always sits next to words. Shrink-only: a pair that reaches 3:1 fails until deleted.
 */
const CI_EXEMPT_LIGHT_STATUS = ["success", "warning"].flatMap((tone) => [
  `light: TONE_DOT.${tone} on card`,
  `light: TONE_ICON.${tone} on card`,
  `light: TONE_BORDER.${tone} on card`,
  `light: TONE_DOT.${tone} on background`,
  `light: TONE_ICON.${tone} on background`,
  `light: TONE_BORDER.${tone} on background`,
  `light: TONE_DOT.${tone} inside its tint`,
  `light: TONE_ICON.${tone} inside its tint`,
])

describe("tone contrast (the toolkit's Miragon theme, light + dark)", () => {
  it("measures every TONE_* entry in both modes", () => {
    const results = measureContrast(theme, toneContrastPairs())
    // 5 tones × (2 surfaces × 4–5 roles + 3 tint pairs), each in two modes.
    expect(results.length).toBeGreaterThanOrEqual(5 * 11 * 2)
    expect(new Set(results.map((r) => r.mode))).toEqual(new Set(["light", "dark"]))
  })

  it("every TONE_* entry reaches its minimum, apart from the CI's light status exemption", () => {
    expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(
      [...CI_EXEMPT_LIGHT_STATUS].sort(),
    )
  })

  it("measures a light-only brand override in dark too, where html.dark sees it", () => {
    // A light-only `:root` override leaks into dark, so the guard must fail; a customer brand is test data here.
    /* brand-lint-disable */
    const light = ":root { --info: #0055aa; --info-soft: #e6f0fa; --info-ink: #0055aa; }"
    const dark = ".dark { --info: #6b9ce0; --info-soft: transparent; --info-ink: #6b9ce0; }"
    /* brand-lint-enable */
    const findings = contrastFindings(parseThemeVariables(...shipped, light), toneContrastPairs())
    expect(findings).toContain("dark: TONE_INK.info on card")
    expect(findings.filter((f) => f.startsWith("dark: "))).not.toEqual([])
    const repeated = contrastFindings(
      parseThemeVariables(...shipped, light, dark),
      toneContrastPairs(),
    )
    expect(repeated.sort()).toEqual([...CI_EXEMPT_LIGHT_STATUS].sort())
  })
})

describe("role contrast (the toolkit's Miragon theme, light + dark)", () => {
  it("reaches AA on every neutral and interaction role — the interim gaps are gone", () => {
    // The shadcn neutrals missed it on the input edge (1.26:1) and the quiet
    // text on muted (4.34:1); the Miragon roles reach 3.40:1 and 5.29:1.
    expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
  })
})
