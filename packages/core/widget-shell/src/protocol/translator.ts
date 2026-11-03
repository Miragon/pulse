/** Browser-safe, no imports: `/server` (tool summaries) and `/widgets` (widget strings) export it alike. */

/** A string with `{name}` placeholders, or a function of the params (plurals, conditionals). */
export type Message = string | ((params: Record<string, unknown>) => string)

/** One locale's messages, keyed by a dotted message key. */
export type MessageCatalog = Record<string, Message>

/** Per-locale catalogs, keyed by a locale tag (`en`, `de`). */
export type Catalogs = Record<string, MessageCatalog>

export type Translator = (locale: string, key: string, params?: Record<string, unknown>) => string

/**
 * Requested locale, then `en`, then the key itself, so a missing message stays visible. A string
 * message interpolates `{name}` placeholders from the params and leaves unknown ones untouched.
 */
export function createTranslator(catalogs: Catalogs): Translator {
  return (locale, key, params) => {
    const message = catalogs[locale]?.[key] ?? catalogs.en?.[key]
    if (message === undefined) return key
    if (typeof message === "function") return message(params ?? {})
    if (!params) return message
    return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? String(params[name]) : whole,
    )
  }
}
