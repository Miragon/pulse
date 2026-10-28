/** Zod-free so widget code can import the option arrays without pulling zod into the UI bundle. */

/** Every locale needs a catalog. */
export const LOCALES = ["en", "de"] as const
export type Locale = (typeof LOCALES)[number]

/** `system` follows the host's locale, then English; server summaries have no host locale, so English there. */
export const LANGUAGES = ["system", ...LOCALES] as const
export type LanguagePref = (typeof LANGUAGES)[number]

/** Loose input on purpose: profile feeds arrive untyped. */
export function explicitLocale(language: string | undefined): Locale | undefined {
  return LOCALES.find((locale) => locale === language)
}

/**
 * Every bump needs a `PROFILE_MIGRATIONS` entry. v3 is the baseline; the theme key it
 * once carried stays inert in the raw document (widgets follow the host theme).
 */
export const PROFILE_SCHEMA_VERSION = 3
