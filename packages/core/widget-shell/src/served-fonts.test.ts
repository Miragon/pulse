import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { GEIST_FONT_FILES } from "@miragon/mcp-toolkit-ui"
import { SERVED_FONT_FILES, SERVED_FONT_PATH, servedFontBaseUrl } from "./served-fonts.js"

const require = createRequire(import.meta.url)
const versionOf = (name: string) => (require(`${name}/package.json`) as { version: string }).version

describe("the served-font contract", () => {
  it("names the installed fontsource release in the path, so a font update is a new URL", () => {
    // Cached `immutable`: bumping fonts without moving the path keeps browsers on old files for a year.
    for (const name of ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"]) {
      expect(SERVED_FONT_PATH, name).toBe(`/fonts/geist-${versionOf(name)}`)
    }
  })

  it("serves the files the toolkit's fontFaces() names", () => {
    expect(SERVED_FONT_FILES).toEqual(GEIST_FONT_FILES)
  })
})

describe("servedFontBaseUrl", () => {
  it("puts the font path on the origin of the view's public base", () => {
    expect(servedFontBaseUrl("https://mcp.example.com/mcp/_mcp-use/public/")).toBe(
      "https://mcp.example.com/fonts/geist-5.3.0",
    )
    expect(servedFontBaseUrl("http://127.0.0.1:8400/mcp/_mcp-use/public/")).toBe(
      "http://127.0.0.1:8400/fonts/geist-5.3.0",
    )
  })

  it("declares nothing outside a served view document or for a base that is no http(s) URL", () => {
    for (const base of [undefined, "", "not a url", "data:text/plain,x", "ftp://files.example/"]) {
      expect(servedFontBaseUrl(base), String(base)).toBeUndefined()
    }
  })
})
