/**
 * Dependency-free, so both `/server` and `/widgets` export it. Self-hosted on purpose
 * (design system §4: no CDN, offline-capable, GDPR-safe).
 */

/** Names the fontsource release so the route can be cached `immutable`; `served-fonts.test.ts` pins it. */
export const SERVED_FONT_PATH = "/fonts/geist-5.3.0"

/** The latin variable woff2 files under {@link SERVED_FONT_PATH} (the toolkit's `GEIST_FONT_FILES`). */
export const SERVED_FONT_FILES = {
  sans: "geist-latin-wght-normal.woff2",
  mono: "geist-mono-latin-wght-normal.woff2",
} as const

/**
 * The same origin the view's CSP admits in `resourceDomains`. `undefined` for no or a
 * non-http(s) base: the view then declares no face and the host's font renders.
 */
export function servedFontBaseUrl(publicBase: string | undefined): string | undefined {
  if (!publicBase) return undefined
  let base: URL
  try {
    base = new URL(publicBase)
  } catch {
    return undefined
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return undefined
  return `${base.origin}${SERVED_FONT_PATH}`
}
