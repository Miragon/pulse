import { describe, expect, it } from "vitest"
import type { ToneVariant } from "../tones/index.js"
import { TONE_BORDER, TONE_DOT, TONE_ICON, TONE_INK, TONE_SOFT, TONE_TINT } from "./tone-utils.js"

const ALL_TONES: ToneVariant[] = ["neutral", "info", "success", "warning", "danger"]
const STATUS_TONES = ["info", "success", "warning", "danger"] as const
const ALL_MAPS = { TONE_SOFT, TONE_TINT, TONE_DOT, TONE_INK, TONE_BORDER, TONE_ICON }

describe("tone-utils", () => {
  it("covers every ToneVariant in each map (no missing tones)", () => {
    for (const map of Object.values(ALL_MAPS)) {
      expect(Object.keys(map).sort()).toEqual([...ALL_TONES].sort())
    }
  })

  it("maps each tone to a non-empty class string in every map", () => {
    for (const [name, map] of Object.entries(ALL_MAPS)) {
      for (const tone of ALL_TONES) {
        expect(map[tone], `${name}:${tone}`).toBeTruthy()
      }
    }
  })

  it("routes each status tone to its three roles (colour, tint, ink)", () => {
    for (const tone of STATUS_TONES) {
      expect(TONE_SOFT[tone]).toBe(`bg-${tone}-soft text-foreground`)
      expect(TONE_TINT[tone]).toBe(`bg-${tone}-soft`)
      expect(TONE_INK[tone]).toBe(`text-${tone}-ink`)
      expect(TONE_DOT[tone]).toBe(`bg-${tone}`)
      expect(TONE_BORDER[tone]).toBe(`border-${tone}`)
      expect(TONE_ICON[tone]).toBe(`text-${tone}`)
    }
  })

  it("never sets text in a raw status colour outside the icon map (CI §3.3)", () => {
    // Success and warning reach 1.67:1 / 1.83:1 on white; text takes the
    // tone's -ink role. TONE_ICON is the one deliberate exception (SVG
    // currentColor, always next to a readable label).
    const rawStatusText = /\btext-(success|warning|danger|info)(?![-\w])/
    for (const [name, map] of Object.entries({
      TONE_SOFT,
      TONE_TINT,
      TONE_DOT,
      TONE_INK,
      TONE_BORDER,
    })) {
      for (const tone of ALL_TONES) {
        expect(map[tone], `${name}:${tone}`).not.toMatch(rawStatusText)
      }
    }
  })

  it("puts the foreground on every tint, never the ink or the status colour (CI §3.3)", () => {
    // "-soft: Text darauf --cd-schwarz, Rand in der Statusfarbe": the rim
    // (TONE_BORDER) carries the tone; a neutral count on the muted tint is a
    // figure and stays in the foreground too.
    for (const tone of ALL_TONES) {
      expect(TONE_SOFT[tone]).toBe(`${TONE_TINT[tone]} text-foreground`)
      expect(TONE_TINT[tone]).not.toMatch(/\btext-/)
    }
  })

  it("routes the neutral tone to the muted ramp", () => {
    expect(TONE_SOFT.neutral).toBe("bg-muted text-foreground")
    expect(TONE_TINT.neutral).toBe("bg-muted")
    expect(TONE_DOT.neutral).toBe("bg-muted-foreground")
    expect(TONE_INK.neutral).toBe("text-foreground")
    expect(TONE_BORDER.neutral).toBe("border-border")
    expect(TONE_ICON.neutral).toBe("text-muted-foreground")
  })
})
