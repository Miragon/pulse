/**
 * The kit's own UI strings (every caption, label, placeholder and
 * accessible name a kit component renders) as one typed catalog per
 * locale. Components read the active locale's catalog through
 * `useUiMessages()` (the nearest `LocaleProvider`), so a consumer only
 * passes a locale; nothing in the kit hard-codes English.
 *
 * Pure data and functions (no React): browser-safe.
 */
import type { UiMessages } from "./message-types.js"
import { de } from "./messages-de.js"
import { en } from "./messages-en.js"

export type {
  CommonMessages,
  FilterBarMessages,
  ListFooterMessages,
  UiMessages,
} from "./message-types.js"

/** A partial override of a {@link UiMessages} catalog, per section. */
export type UiMessagesOverride = {
  [K in keyof UiMessages]?: Partial<UiMessages[K]>
}

/** The locales the kit ships a catalog for. English is the fallback. */
export const UI_LOCALES = ["en", "de"] as const
export type UiLocale = (typeof UI_LOCALES)[number]

/** The shipped catalogs, keyed by {@link UiLocale}. */
export const UI_MESSAGES: Readonly<Record<UiLocale, UiMessages>> = { en, de }

/**
 * Map any BCP 47 tag (`"de-DE"`, `"de_AT"`, `"EN"`) onto a shipped catalog:
 * its primary language subtag when the kit ships it, English otherwise.
 */
export function resolveUiLocale(locale: string | undefined): UiLocale {
  const primary = (locale ?? "").trim().toLowerCase().split(/[-_]/)[0]
  return (UI_LOCALES as readonly string[]).includes(primary ?? "") ? (primary as UiLocale) : "en"
}

/**
 * The catalog for `locale`, with `override` merged over it section by
 * section. Without an override the shipped catalog object itself is returned
 * (referentially stable, so safe as a memo dependency).
 */
export function resolveUiMessages(
  locale: string | undefined,
  override?: UiMessagesOverride,
): UiMessages {
  const base = UI_MESSAGES[resolveUiLocale(locale)]
  if (!override) return base
  return {
    common: { ...base.common, ...override.common },
    listFooter: { ...base.listFooter, ...override.listFooter },
    filterBar: { ...base.filterBar, ...override.filterBar },
    pills: { ...base.pills, ...override.pills },
  }
}

/**
 * Format a count for display in `locale` (grouping separators per locale:
 * `1,234` / `1.234`). An invalid tag falls back to English instead of
 * throwing inside a render.
 */
export function formatCount(value: number, locale: string | undefined): string {
  try {
    return new Intl.NumberFormat(locale).format(value)
  } catch {
    return new Intl.NumberFormat("en").format(value)
  }
}
