/**
 * The one locale every formatter of `@miragon/pulse-ui/format` renders in: set once with
 * {@link setFormatLocale} (the MCP views' LocaleGate from the host's language, the VS Code
 * extension's English), the runtime's own until then.
 */

/** What every formatter renders for no value: never a `0` or "Invalid Date" that reads as fact. */
export const EMPTY = "—"

/** A non-breaking space: a number never wraps away from its unit. */
export const NBSP = " "

export interface FormatLocale {
  language: string
  /** The host's full tag when it speaks `language`; a `-u-hc-h23` extension picks a 24-hour clock. */
  locale: string
  timeZone?: string
}

let current: FormatLocale | undefined
const listeners = new Set<() => void>()

function sameFormatLocale(a: FormatLocale | undefined, b: FormatLocale | undefined): boolean {
  return a?.language === b?.language && a?.locale === b?.locale && a?.timeZone === b?.timeZone
}

/** A no-op for an unchanged value, so subscribers re-render only on a real change. */
export function setFormatLocale(next: FormatLocale | undefined): void {
  if (sameFormatLocale(current, next)) return
  current = next
  for (const listener of listeners) listener()
}

export function getFormatLocale(): FormatLocale | undefined {
  return current
}

export function subscribeFormatLocale(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The locale tag the formatters hand to `Intl`; `undefined` is the runtime's own. */
export function localeTag(): string | undefined {
  return current?.locale
}

/** The language of the words the formatters write themselves (units, "just now"). */
export function unitLanguage(): "de" | "en" {
  return current?.language.toLowerCase().startsWith("de") ? "de" : "en"
}

/** `options` in the published time zone, the runtime's own when none is published. */
export function zoned(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormatOptions {
  return current?.timeZone ? { ...options, timeZone: current.timeZone } : options
}
