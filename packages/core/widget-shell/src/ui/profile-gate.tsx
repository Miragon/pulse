import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { AppQueryProvider, LocaleProvider, Skeleton, useToolQuery } from "@miragon/mcp-toolkit-ui"
import { useHostBridge } from "@miragon/mcp-toolkit-ui/app"
import {
  getFormatLocale,
  setFormatLocale,
  subscribeFormatLocale,
  type FormatLocale,
} from "./format.js"
import { formattingLocale, resolveLanguage, validTimeZone } from "./host-context.js"
import { SHELL_SETTINGS_DATA } from "../shell-settings-contract.js"
import { kitLabels } from "./kit-labels.js"
import { SHELL_SETTINGS_KEY } from "./shell-settings.js"
import { useShellHost } from "./shell-host.js"
import { useApplyTheme } from "./use-apply-theme.js"

interface ProfileFeed {
  language?: string
}

const PROFILE_WAIT_MS = 1_500

/** Longer than the profile wait: painting without host context is the flash the gate prevents. */
const HOST_WAIT_MS = 5_000

export interface ProfileGateProps {
  /** Counted from the host connection, so a slow handshake never eats into it. */
  profileWaitMs?: number
  children: ReactNode
}

/**
 * Resolves the view's ONE effective locale and theme at the app root. Shares
 * the language section's query key, so a saved language flips views live.
 * The first paint waits (bounded) for host and profile, so a German profile
 * or dark host never flashes English or the OS theme. A failing feed releases
 * the gate at its FIRST failure: react-query stays pending through retries.
 */
export function ProfileGate({ profileWaitMs, children }: ProfileGateProps) {
  const { callTool } = useHostBridge()
  const callToolFn = useCallback(
    (name: string, args: object) => callTool(name, args as Record<string, unknown>),
    [callTool],
  )
  return (
    <AppQueryProvider callTool={callToolFn}>
      <ProfileGateInner profileWaitMs={profileWaitMs}>{children}</ProfileGateInner>
    </AppQueryProvider>
  )
}

/** The clock starts once and never restarts; the result never flips back. */
function useElapsedSince(start: boolean, ms: number): boolean {
  const [started, setStarted] = useState(start)
  if (start && !started) setStarted(true)
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!started) return
    const id = setTimeout(() => setElapsed(true), ms)
    return () => clearTimeout(id)
  }, [started, ms])
  return elapsed
}

/** A FIRST failure counts as an answer: retries keep the query pending for ~7 s. */
function useFirstPaintSettled(
  connected: boolean,
  profile: { isPending: boolean; failureCount: number },
  profileWaitMs: number,
): boolean {
  const hostWaitedOut = useElapsedSince(true, HOST_WAIT_MS)
  const profileWaitedOut = useElapsedSince(connected, profileWaitMs)
  const profileAnswered = !profile.isPending || profile.failureCount > 0 || profileWaitedOut
  return (connected && profileAnswered) || hostWaitedOut
}

function ProfileGateInner({
  profileWaitMs = PROFILE_WAIT_MS,
  children,
}: Omit<ProfileGateProps, "children"> & { children: ReactNode }) {
  const host = useShellHost()
  const query = useToolQuery<ProfileFeed>([...SHELL_SETTINGS_KEY], SHELL_SETTINGS_DATA, {})
  const profile = query.data
  const settled = useFirstPaintSettled(host.connected, query, profileWaitMs)

  useApplyTheme()
  const language = resolveLanguage(profile?.language, host.locale)
  const target = useMemo<FormatLocale>(
    () => ({
      language,
      locale: formattingLocale(language, host.locale),
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
  if (!ready && settled && isPublished(published, target)) setReady(true)

  if (!ready) return host.connected ? <GateSkeleton language={language} /> : null
  return <LocaleProvider locale={published?.language ?? language}>{children}</LocaleProvider>
}

function isPublished(published: FormatLocale | undefined, target: FormatLocale): boolean {
  return (
    published?.language === target.language &&
    published.locale === target.locale &&
    published.timeZone === target.timeZone
  )
}

function GateSkeleton({ language }: { language: string }) {
  return (
    <div className="flex flex-col gap-4 p-4" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
      <span role="status" className="sr-only">
        {kitLabels(language).loading}
      </span>
    </div>
  )
}
