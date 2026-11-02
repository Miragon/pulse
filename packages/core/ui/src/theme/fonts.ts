/**
 * Opt-in Geist delivery by URL. The kit's font tokens name "Geist" and
 * "Geist Mono" first but load no font: an app either imports
 * `@miragon/pulse-ui/fonts.css` (bundled by the build) or serves the
 * woff2 files itself and declares them with {@link fontFaces}. The second path
 * keeps MCP App views small: the files are fetched once and cached instead of
 * inlined as base64 into every view; allow their origin in the view's CSP
 * `resourceDomains`. Where the fonts never load, the host's font renders (if
 * the host sends one, see `adoptHostFontVariables`), else the system stack.
 */

/** The latin variable woff2 files, as `@fontsource-variable/geist(-mono)` ship them. */
export const GEIST_FONT_FILES = {
  sans: "geist-latin-wght-normal.woff2",
  mono: "geist-mono-latin-wght-normal.woff2",
} as const

/** The latin subset both files cover (identical to fontsource's `latin` range). */
const LATIN_UNICODE_RANGE =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

/** Options for {@link fontFaces}. */
export interface FontFacesOptions {
  /** Where the woff2 files are served from, e.g. `https://mcp.example.com/fonts`. */
  baseUrl: string
  /** File names under `baseUrl`. Defaults to {@link GEIST_FONT_FILES}. */
  files?: { sans?: string; mono?: string }
  /** `font-display` strategy. Default `"swap"`: text renders at once in the fallback. */
  display?: "auto" | "block" | "swap" | "fallback" | "optional"
}

/** Characters that could break out of the CSS `url("…")` the helper writes. */
const UNSAFE_URL_CHARS = /["'\\()\s<>]/

/** `value` without its trailing slashes, in linear time (`/\/+$/` backtracks on a long run of them). */
function withoutTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === "/") end--
  return value.slice(0, end)
}

function fontUrl(baseUrl: string, file: string): string {
  const url = `${withoutTrailingSlashes(baseUrl)}/${file.replace(/^\/+/, "")}`
  if (UNSAFE_URL_CHARS.test(url)) {
    throw new Error(`fontFaces: refusing a font URL with quote, bracket or whitespace: ${url}`)
  }
  return url
}

function face(family: string, url: string, display: string): string {
  return [
    "@font-face {",
    `  font-family: "${family}";`,
    "  font-style: normal;",
    `  font-display: ${display};`,
    "  font-weight: 100 900;",
    `  src: url("${url}") format("woff2");`,
    `  unicode-range: ${LATIN_UNICODE_RANGE};`,
    "}",
  ].join("\n")
}

/**
 * The `@font-face` rules for Geist and Geist Mono (latin, variable weight
 * 100–900) served from `baseUrl`. Pure — inject the string where your app
 * builds its document, e.g. `<style>{fontFaces({ baseUrl })}</style>`.
 *
 * @example
 * fontFaces({ baseUrl: "https://mcp.example.com/fonts" })
 * // @font-face { font-family: "Geist"; … src: url("https://mcp.example.com/fonts/geist-latin-wght-normal.woff2") … }
 */
export function fontFaces({ baseUrl, files, display = "swap" }: FontFacesOptions): string {
  const sans = files?.sans ?? GEIST_FONT_FILES.sans
  const mono = files?.mono ?? GEIST_FONT_FILES.mono
  return [
    face("Geist", fontUrl(baseUrl, sans), display),
    face("Geist Mono", fontUrl(baseUrl, mono), display),
  ].join("\n")
}
