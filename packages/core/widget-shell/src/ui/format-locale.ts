import { useLayoutEffect, useSyncExternalStore } from "react"
import {
  getFormatLocale,
  setFormatLocale,
  subscribeFormatLocale,
  type FormatLocale,
} from "@miragon/pulse-ui"
import { formattingLocale, resolveLanguage, validTimeZone } from "./host-context.js"

/**
 * The locale the formatters render in for a locale tag and a time zone: the tag's language when
 * the UI ships it (else English), its canonical tag, the zone when the runtime knows it (else the
 * runtime's own).
 */
export function formatLocaleOf(
  tag: string | undefined,
  timeZone: string | undefined,
): FormatLocale {
  return {
    language: resolveLanguage(tag),
    locale: formattingLocale(tag),
    timeZone: validTimeZone(timeZone),
  }
}

export function isFormatLocale(published: FormatLocale | undefined, target: FormatLocale): boolean {
  return (
    published?.language === target.language &&
    published.locale === target.locale &&
    published.timeZone === target.timeZone
  )
}

/**
 * Publishes `target` as the locale every formatter of `@miragon/pulse-ui` renders in, before the
 * paint, and returns the one they render in now (re-rendering on a change), so a tree can wait
 * until it is `target` and never formats a date in a locale it then drops. On unmount it puts back
 * what it replaced while the store still holds `target`, so no test inherits another's locale.
 * `LocaleGate` publishes the host's locale through it, `TestViewHost` its own.
 */
export function usePublishedFormatLocale(target: FormatLocale): FormatLocale | undefined {
  useLayoutEffect(() => {
    const replaced = getFormatLocale()
    setFormatLocale(target)
    return () => {
      if (isFormatLocale(getFormatLocale(), target)) setFormatLocale(replaced)
    }
  }, [target])
  return useSyncExternalStore(subscribeFormatLocale, getFormatLocale, getFormatLocale)
}
