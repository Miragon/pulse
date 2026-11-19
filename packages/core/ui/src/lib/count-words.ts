import type { Count } from "../format/index.js"
import { compactCountIn, countIn } from "../format/numbers.js"
import type { CountMessages } from "../locale/message-types.js"

const known = (value: number) => Number.isFinite(value)

/**
 * The kit's locale (`useUiLocale`) as an `Intl` tag, so a count is grouped in the language of the
 * words around it (`1,234`, German `1.234`) whatever the format locale says. A tag `Intl` refuses
 * writes English instead of throwing inside a render.
 */
function tagOf(locale: string): string {
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? "en"
  } catch {
    return "en"
  }
}

const languageOf = (tag: string): "de" | "en" => (tag.toLowerCase().startsWith("de") ? "de" : "en")

/** A count on screen in the kit's locale: `1,234`, a lower bound `≥ 2,000`, unknown `—`. */
export function countText(count: Count, locale: string): string {
  return countIn(count, tagOf(locale))
}

/** A count on screen in the kit's locale, compact where it is narrow: `12.3k`, `2k+`, `—`. */
export function compactCountText(count: Count, locale: string): string {
  const tag = tagOf(locale)
  return compactCountIn(count, tag, languageOf(tag))
}

/**
 * A count as a screen reader hears it, in the kit's locale like its words: the exact number
 * (`1,234`), a lower bound in words ("at least 2,000" where the screen shows `≥ 2,000`), or
 * "count unknown" where it shows `—`.
 */
export function countWords(count: Count, words: CountMessages, locale: string): string {
  if (typeof count === "number") return known(count) ? countText(count, locale) : words.unknown
  if (count && known(count.atLeast)) {
    return words.atLeast({ count: countText(count.atLeast, locale) })
  }
  return words.unknown
}
