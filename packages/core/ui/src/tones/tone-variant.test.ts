import { describe, expect, it } from "vitest"
import {
  isToneVariant,
  resolveTone,
  TONE_ALIASES,
  TONE_VARIANTS,
  type ToneVariant,
} from "./index.js"

const ALL_TONES: ToneVariant[] = ["neutral", "info", "success", "warning", "danger"]

describe("the tone vocabulary", () => {
  it("has ONE vocabulary of five tones, in severity order", () => {
    expect(TONE_VARIANTS).toEqual(["danger", "warning", "success", "info", "neutral"])
    expect([...TONE_VARIANTS].sort()).toEqual([...ALL_TONES].sort())
  })
})

describe("the tone vocabulary: retired names map onto the five tones", () => {
  it("pins every alias (one red, one amber: critical/error/destructive are danger)", () => {
    expect(TONE_ALIASES).toEqual({
      critical: "danger",
      error: "danger",
      destructive: "danger",
      failure: "danger",
      warn: "warning",
      ok: "success",
      positive: "success",
      notice: "info",
      default: "neutral",
      muted: "neutral",
      secondary: "neutral",
    })
    for (const tone of Object.values(TONE_ALIASES)) expect(isToneVariant(tone)).toBe(true)
    for (const alias of Object.keys(TONE_ALIASES)) expect(isToneVariant(alias)).toBe(false)
  })

  it("keeps a tone as it is", () => {
    for (const tone of ALL_TONES) expect(resolveTone(tone)).toBe(tone)
  })

  it("maps every alias onto its tone, ignoring case and padding", () => {
    for (const [alias, tone] of Object.entries(TONE_ALIASES)) {
      expect(resolveTone(alias), alias).toBe(tone)
    }
    expect(resolveTone("Critical")).toBe("danger")
    expect(resolveTone("  WARN ")).toBe("warning")
    expect(resolveTone(" Danger")).toBe("danger")
  })

  it("falls back to neutral (or the caller's fallback) for anything else", () => {
    for (const unknown of ["", "   ", "purple", "constructor", "toString", "__proto__"]) {
      expect(resolveTone(unknown), JSON.stringify(unknown)).toBe("neutral")
    }
    for (const notAString of [undefined, null, 3, true, {}, ["danger"]]) {
      expect(resolveTone(notAString)).toBe("neutral")
    }
    expect(resolveTone("purple", "info")).toBe("info")
    expect(resolveTone(undefined, "warning")).toBe("warning")
    expect(resolveTone("critical", "info")).toBe("danger")
  })

  it("isToneVariant accepts exactly the five tones", () => {
    for (const tone of ALL_TONES) expect(isToneVariant(tone)).toBe(true)
    for (const other of ["Danger", "critical", "", undefined, null, 1, { tone: "info" }]) {
      expect(isToneVariant(other)).toBe(false)
    }
  })
})
