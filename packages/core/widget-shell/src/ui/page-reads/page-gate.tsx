/**
 * What a page's reads tell the page as a whole, derived from its one query client, with no state
 * of its own: the gate a refusal of a connection closes (`PageGate`), the bar's Refresh, when the
 * numbers on screen were read and whether a read runs (`usePageReads`).
 */
import {
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { notifyManager, useIsFetching, type QueryCache } from "@tanstack/react-query"
import { ErrorState, useLocale } from "@miragon/pulse-ui"
import { useQueryClient } from "../tool-query.js"
import { useErrorWords, useViewHost } from "../view-host.js"
import { describePageFailure } from "./describe-page-failure.js"
import { isPageWideRefusal, type PageCallError } from "./page-call-error.js"
import { PAGE_READS, refreshPageReads, SECTION_READS } from "./page-reader.js"

/** What a section's read keeps: its data and when the server read it, in ms. */
export interface SectionAnswer<T> {
  readonly data: T
  readonly at: number
}

/**
 * The nearest gate above a section and the connection it covers (every one without a name): a
 * refusal it covers is the gate's to say, never the section's.
 */
export const PageGateContext = createContext<{ readonly connector: string | undefined } | null>(
  null,
)

/** Whether a gate of `connector` (every connection without one) covers a refusal of `refused`. */
export function gateCovers(connector: string | undefined, refused: PageCallError): boolean {
  return connector === undefined || refused.connector === connector
}

/** The first section read a page-wide refusal of `connector` failed, any connection's without one. */
function refusalOf(cache: QueryCache, connector: string | undefined): PageCallError | undefined {
  for (const query of cache.findAll({ queryKey: SECTION_READS })) {
    // A query holds an error only while it failed (a success or a new read without data clears it).
    const { error } = query.state
    if (isPageWideRefusal(error) && gateCovers(connector, error)) return error
  }
  return undefined
}

/**
 * When the numbers on screen were read: the oldest read of the sections that hold data and are
 * mounted (a section whose refresh failed keeps its older read), none of a read whose connection
 * refuses as a whole. A gate that closes unmounts its sections, and a read outside it that shares
 * their key (the bar's) is refused alike, so a page of one connection shows none then; a page of
 * several keeps the time of the numbers another connection still shows.
 */
function readAtOf(cache: QueryCache): number | undefined {
  let oldest: number | undefined
  for (const query of cache.findAll({ queryKey: SECTION_READS })) {
    const at = (query.state.data as SectionAnswer<unknown> | undefined)?.at
    if (at === undefined || query.getObserversCount() === 0) continue
    if (isPageWideRefusal(query.state.error)) continue
    if (oldest === undefined || at < oldest) oldest = at
  }
  return oldest
}

/**
 * A value of the page's query cache, read again on every change of it. `select` gives the same
 * value for the same cache (an error the cache holds, a number), so nothing renders for nothing.
 */
function useCacheValue<T>(select: (cache: QueryCache) => T): T {
  const cache = useQueryClient().getQueryCache()
  const subscribe = useCallback(
    (onChange: () => void) => cache.subscribe(notifyManager.batchCalls(onChange)),
    [cache],
  )
  const read = () => select(cache)
  return useSyncExternalStore(subscribe, read, read)
}

/** The page's Refresh over its one query client. */
function usePageRefresh(): () => void {
  const client = useQueryClient()
  return useCallback(() => {
    void refreshPageReads(client)
  }, [client])
}

const systemNow = () => new Date()

/** What the page's bar shows of its reads. */
export interface PageReads {
  /**
   * Reads the page again (the bar's Refresh): every call asks the server from now on, a read that
   * runs is asked anew, a refused gate opens.
   */
  readonly refresh: () => void
  /**
   * When the numbers on screen were read, the bar's freshness: the oldest answer's `asOf` of the
   * mounted sections, none of a read its connection refuses as a whole; none before the first
   * read, and none while the one connection of a page refuses.
   */
  readonly readAt: Date | undefined
  /** A read of the page runs. */
  readonly reading: boolean
  /** The page's clock (`ViewHost.now`, a recording's time), else now: relative times count from it. */
  readonly now: () => Date
}

/** The page's Refresh, its freshness, whether any of its reads runs, and its clock. */
export function usePageReads(): PageReads {
  const refresh = usePageRefresh()
  const at = useCacheValue(readAtOf)
  const reading = useIsFetching({ queryKey: [PAGE_READS] }) > 0
  const now = useViewHost().now ?? systemNow
  return useMemo(
    () => ({ refresh, readAt: at === undefined ? undefined : new Date(at), reading, now }),
    [refresh, at, reading, now],
  )
}

export interface PageGateProps {
  /**
   * The connection the gate covers, by the name the page knows it under; default every one. A page
   * that reads several puts one gate around each connection's sections.
   */
  readonly connector?: string
  readonly children: ReactNode
}

/** pulse-ui's `SectionState` region, which takes focus programmatically. */
const SECTION = "[data-slot='section-state']"

/** The first section region after `marker` among its siblings, in document order. */
function firstSectionAfter(marker: HTMLElement | null): HTMLElement | null {
  for (
    let next = marker?.nextElementSibling ?? null;
    next !== null;
    next = next.nextElementSibling
  ) {
    const section = next.matches(SECTION) ? next : next.querySelector(SECTION)
    if (section instanceof HTMLElement) return section
  }
  return null
}

/**
 * The page's sections, or its ONE state while a refusal of a connection as a whole stands (no
 * sign-in, no connection, none chosen, none declared, no approval): every section would fail
 * alike, so none mounts, and the sections below it never say such a refusal as their own. Its Try
 * again is the page's Refresh, which opens it and reads every section again; the first section
 * then takes the keyboard focus its gone Try again held (WCAG 2.4.3), found from a hidden marker
 * before the sections. A refusal no retry changes (a page that declares no connection, which only
 * whoever published it can declare) offers none: its words send the viewer there. A refusal of a
 * connection no gate covers stays in its sections, said once under a `SectionStateGroup`.
 */
export function PageGate({ connector, children }: PageGateProps) {
  const refused = useCacheValue((cache) => refusalOf(cache, connector))
  const refresh = usePageRefresh()
  const locale = useLocale()
  const words = useErrorWords()
  const gate = useMemo(() => ({ connector }), [connector])
  const marker = useRef<HTMLSpanElement>(null)
  const reopened = useRef(false)
  const retry = useCallback(() => {
    reopened.current = true
    refresh()
  }, [refresh])
  useLayoutEffect(() => {
    const doc = marker.current?.ownerDocument
    if (refused !== undefined || !reopened.current || doc === undefined) return
    reopened.current = false
    if (doc.activeElement === null || doc.activeElement === doc.body) {
      firstSectionAfter(marker.current)?.focus({ preventScroll: true })
    }
  })
  if (refused === undefined) {
    return (
      <PageGateContext.Provider value={gate}>
        <span ref={marker} hidden />
        {children}
      </PageGateContext.Provider>
    )
  }
  // A reconnect, a set-up connection, a choice or an approval ends one, so Try again reads anew;
  // a page that declares no connection stays refused until whoever published it declares one.
  const failure = describePageFailure(refused, locale, words)
  return (
    <ErrorState
      titleAs="h2"
      title={failure.title}
      description={failure.hint}
      details={failure.details}
      onRetry={failure.permanent === true ? undefined : retry}
    />
  )
}
