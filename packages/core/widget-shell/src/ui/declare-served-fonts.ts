import { fontFaces } from "@miragon/pulse-ui"
import { SERVED_FONT_FILES, servedFontBaseUrl } from "../protocol/served-fonts.js"

export const SERVED_FONTS_STYLE_ID = "__miragon-served-fonts"

/**
 * `font-display: swap`: the host's or system font renders at once, so a host blocking the server's
 * origin leaves it there and nothing waits. `publicBase` is the view host's (`ShellHost`); returns
 * the base URL the faces load from, if any.
 */
export function declareServedFonts(doc: Document, publicBase: string): string | undefined {
  const existing = doc.getElementById(SERVED_FONTS_STYLE_ID)
  if (existing) return existing.dataset.baseUrl
  const baseUrl = servedFontBaseUrl(publicBase)
  if (!baseUrl) return undefined
  let css: string
  try {
    css = fontFaces({ baseUrl, files: SERVED_FONT_FILES })
  } catch {
    // A base the helper refuses to write into url("…") (quotes, brackets).
    return undefined
  }
  const style = doc.createElement("style")
  style.id = SERVED_FONTS_STYLE_ID
  style.dataset.baseUrl = baseUrl
  style.textContent = css
  doc.head.appendChild(style)
  return baseUrl
}
