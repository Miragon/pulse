import { setFormatLocale } from "@miragon/pulse-ui/format"

export interface ViewerLocale {
  /** The language of the page's words: German for a German tag, English for every other. */
  language: "en" | "de"
  /** The tag the dates and numbers format in: the viewer's own where it speaks the language. */
  locale: string
}

/** The viewer's language from the browser's tag (`de-AT` → German, `fr-FR` → English). */
export function viewerLocale(tag: string | undefined): ViewerLocale {
  const viewer = (tag ?? "").trim()
  const lower = viewer.toLowerCase()
  if (lower === "de" || lower.startsWith("de-")) return { language: "de", locale: viewer }
  if (lower === "en" || lower.startsWith("en-")) return { language: "en", locale: viewer }
  return { language: "en", locale: "en" }
}

/** Sets the formatters' locale (pulse-ui's `format*` helpers) to the viewer's. */
export function applyFormatLocale({ language, locale }: ViewerLocale): void {
  setFormatLocale({ language, locale })
}
