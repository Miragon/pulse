// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { declareServedFonts, SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"

const PUBLIC_BASE = "https://mcp.example.com/mcp/_mcp-use/public/"
const FONT_BASE = "https://mcp.example.com/fonts/geist-5.3.0"

const declared = () => document.getElementById(SERVED_FONTS_STYLE_ID)

afterEach(() => {
  declared()?.remove()
})

describe("declareServedFonts", () => {
  it("declares Geist and Geist Mono from the view's own server, swap, once per document", () => {
    expect(declareServedFonts(document, PUBLIC_BASE)).toBe(FONT_BASE)
    const style = declared()!
    expect(style.parentElement).toBe(document.head)
    expect(style.dataset.baseUrl).toBe(FONT_BASE)
    const css = style.textContent
    expect(css).toContain('font-family: "Geist";')
    expect(css).toContain('font-family: "Geist Mono";')
    expect(css).toContain(`url("${FONT_BASE}/geist-latin-wght-normal.woff2") format("woff2")`)
    expect(css).toContain(`url("${FONT_BASE}/geist-mono-latin-wght-normal.woff2") format("woff2")`)
    expect(css.match(/font-display: swap;/g)).toHaveLength(2)
    // Never inlined: the files are fetched once and cached across views.
    expect(css).not.toContain("data:")

    // A second mount (StrictMode, a re-rendered shell) adds nothing.
    expect(declareServedFonts(document, "https://other.example/mcp/_mcp-use/public/")).toBe(
      FONT_BASE,
    )
    expect(document.querySelectorAll(`#${SERVED_FONTS_STYLE_ID}`)).toHaveLength(1)
  })

  it("declares nothing outside a served view document — the host's font renders", () => {
    expect(declareServedFonts(document, "")).toBeUndefined()
    expect(declared()).toBeNull()
  })

  it("declares nothing for a base it cannot write into a CSS url()", () => {
    expect(declareServedFonts(document, "http://a(b/mcp/_mcp-use/public/")).toBeUndefined()
    expect(declared()).toBeNull()
  })
})
