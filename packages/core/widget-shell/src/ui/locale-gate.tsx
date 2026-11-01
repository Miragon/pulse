import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  LocaleProvider,
  getFormatLocale,
  setFormatLocale,
  subscribeFormatLocale,
  type FormatLocale,
} from "@miragon/pulse-ui"
import { formattingLocale, resolveLanguage, validTimeZone } from "./host-context.js"
import { useShellHost } from "./shell-host.js"
import { useApplyTheme } from "./use-apply-theme.js"

/** Painting without host context is the flash the gate prevents, so the host gets a generous bound. */
const HOST_WAIT_MS = 5_000

/** The clock starts once; the result never flips back. */
function useElapsed(ms: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setElapsed(true), ms)
    return () => clearTimeout(id)
  }, [ms])
  return elapsed
}

/**
 * Resolves the view's ONE effective locale and theme at the app root, from the host context
 * alone: a host locale whose language is `de` renders German, anything else English. The first
 * paint waits (bounded) for the host connection, so a German or dark host never flashes English
 * or the OS theme. It reads through the view's host (`ViewRoot`; `TestViewHost` in tests).
 */
export function LocaleGate({ children }: { children: ReactNode }) {
  const host = useShellHost()
  const hostWaitedOut = useElapsed(HOST_WAIT_MS)

  useApplyTheme()
  const language = resolveLanguage(host.locale)
  const target = useMemo<FormatLocale>(
    () => ({
      language,
      locale: formattingLocale(host.locale),
      timeZone: validTimeZone(host.timeZone),
    }),
    [language, host.locale, host.timeZone],
  )
  // The view document ships without `lang` (screen readers). The tree reads the
  // PUBLISHED value, so dates and strings never render in different locales.
  useLayoutEffect(() => {
    document.documentElement.lang = target.language
    setFormatLocale(target)
  }, [target])
  const published = useSyncExternalStore(subscribeFormatLocale, getFormatLocale, getFormatLocale)

  const [ready, setReady] = useState(false)
  if (!ready && (host.connected || hostWaitedOut) && isPublished(published, target)) setReady(true)

  if (!ready) return null
  return <LocaleProvider locale={published?.language ?? language}>{children}</LocaleProvider>
}

function isPublished(published: FormatLocale | undefined, target: FormatLocale): boolean {
  return (
    published?.language === target.language &&
    published.locale === target.locale &&
    published.timeZone === target.timeZone
  )
}
