/**
 * Read SSR markup (`renderToStaticMarkup`) the way a user — sighted or with a
 * screen reader — meets it: its text nodes plus the attributes that carry
 * text (accessible names, tooltips, placeholders). DATA/TEST support module
 * like `render-cases.tsx`: the a11y and i18n render suites scan through it,
 * so it stays pure and dependency-free. React's SSR output is well-formed
 * (attributes always double-quoted), which is what keeps these regexes honest.
 */

/** Attributes whose value a user reads or hears. */
export const TEXT_ATTRIBUTES = [
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "placeholder",
  "alt",
] as const

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
}

/** Decode the HTML entities React's SSR emits (named, decimal and hex). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(ref.slice(2), 16))
    }
    if (ref.startsWith("#")) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10))
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole
  })
}

/** One piece of user-facing text in the markup. */
export interface MarkupText {
  /** `"text"` for a text node, else the attribute name. */
  source: string
  value: string
}

/** Every non-blank text node and text-bearing attribute value, decoded. */
export function userFacingTexts(html: string): MarkupText[] {
  const out: MarkupText[] = []
  const withoutRawText = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
  for (const chunk of withoutRawText.split(/<[^>]*>/)) {
    const value = decodeEntities(chunk).trim()
    if (value) out.push({ source: "text", value })
  }
  for (const tag of withoutRawText.match(/<[a-z][^>]*>/gi) ?? []) {
    for (const name of TEXT_ATTRIBUTES) {
      const value = attribute(tag, name)
      if (value?.trim()) out.push({ source: name, value: value.trim() })
    }
  }
  return out
}

/** The opening tags of every element named `tag` (e.g. `"button"`). */
export function openingTags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>`, "gi")) ?? []
}

/** The decoded value of `name` on one opening tag, `undefined` when absent. */
export function attribute(openingTag: string, name: string): string | undefined {
  const escaped = name.replace(/[-]/g, "\\-")
  const match = new RegExp(`\\s${escaped}="([^"]*)"`, "i").exec(openingTag)
  return match ? decodeEntities(match[1] ?? "") : undefined
}
