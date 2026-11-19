import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react"
import { LocaleProvider, type UiMessagesOverride } from "@miragon/pulse-ui"
import { ERROR_LABELS } from "./error-labels.js"
import { formatLocaleOf, isFormatLocale, usePublishedFormatLocale } from "./format-locale.js"
import { resolveLanguage } from "./host-context.js"
import { useShellHost } from "./shell-host.js"
import { useApplyTheme } from "./use-apply-theme.js"
import { useHostFollowUp } from "./view-host.js"

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
 * The kit's words on a page that posts to no chat: its load failure's line says what to do there,
 * in `describeError`'s page words for a failure it cannot name, as the view frame's do. In a chat,
 * none: the kit's own line points there.
 */
function pageWords(language: string, chat: boolean): UiMessagesOverride | undefined {
  if (chat) return undefined
  const hint = ERROR_LABELS[resolveLanguage(language)].unknown.hint({
    source: "unknown",
    page: true,
  })
  return { common: { loadFailedHint: hint } }
}

/**
 * Resolves the view's ONE effective locale and theme at the app root, from the host context
 * alone: a host locale whose language is `de` renders German, anything else English. The first
 * paint waits (bounded) for the host connection, so a German or dark host never flashes English
 * or the OS theme. It reads through the view's host (`ViewRoot`; `TestViewHost` in tests); on a
 * page that posts to no chat the kit's words say what to do there (`pageWords`).
 */
export function LocaleGate({ children }: { children: ReactNode }) {
  const host = useShellHost()
  const hostWaitedOut = useElapsed(HOST_WAIT_MS)

  useApplyTheme()
  const target = useMemo(
    () => formatLocaleOf(host.locale, host.timeZone),
    [host.locale, host.timeZone],
  )
  // The view document ships without `lang` (screen readers). The tree reads the
  // PUBLISHED value, so dates and strings never render in different locales.
  useLayoutEffect(() => {
    document.documentElement.lang = target.language
  }, [target])
  const published = usePublishedFormatLocale(target)
  const language = published?.language ?? target.language
  const chat = useHostFollowUp() === "chat"
  const uiMessages = useMemo(() => pageWords(language, chat), [language, chat])

  const [ready, setReady] = useState(false)
  if (!ready && (host.connected || hostWaitedOut) && isFormatLocale(published, target)) {
    setReady(true)
  }

  if (!ready) return null
  return (
    <LocaleProvider locale={language} uiMessages={uiMessages}>
      {children}
    </LocaleProvider>
  )
}
