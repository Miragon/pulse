import { useMemo } from "react"
import type { FindScreenData } from "@miragon/pulse-screens"
import { useToolQueries } from "@miragon/pulse-widget-shell/widgets"
import { refusalOf, useEngineList } from "../../engine-list.js"

/**
 * The search's feed (the engine module's `SCREEN_FEEDS`): an app-only read of the engine contract
 * in every dialect, one engine per call, which the page's forward admits (`test/page-reads.test.ts`).
 */
export const FIND_FEED = "engine_screen_find_data"

/** The search's cache key, beside each call's arguments: one read per engine and text. */
const FIND_KEY = ["web:find"] as const

/** How many instances with the business key an engine lists at most (the screens' `Finder`). */
export const MOST_BY_BUSINESS_KEY = 20

/** One engine's search: what it found once it answered, or why it could not. */
export interface EngineSearch {
  readonly engine: string
  readonly found: FindScreenData | undefined
  /** Why it could not, from its first failed attempt on, while the query client retries. */
  readonly error: Error | null
  /** Neither an answer nor a failure yet: one retried after a failure has settled for the page. */
  readonly pending: boolean
  /**
   * A failed attempt the query client still retries, at once or once the tab shows again: its
   * failure shows, a retry may answer.
   */
  readonly retrying: boolean
  readonly fetching: boolean
}

/** What the search's read of an engine holds: its answer, its failure, whether it reads. */
interface SearchRead {
  readonly data: FindScreenData | undefined
  readonly error: Error | null
  /** The failure of its last attempt, set from the first one on while the query retries. */
  readonly failureReason: Error | null
  readonly isPending: boolean
  readonly isFetching: boolean
  /** Its next attempt waits: TanStack pauses a retry while the tab is hidden. */
  readonly isPaused: boolean
}

/**
 * One engine's search from its read, pending while its read has not started: its failure from its
 * first failed attempt on, as the query client retries quietly behind it, so an engine that is down
 * says so at once, as on the start page, and counts as settled for what the search shows, though
 * still `retrying`; an answer of a later attempt replaces the failure.
 */
export function searchOf(engine: string, read: SearchRead | undefined): EngineSearch {
  if (read === undefined) {
    return {
      engine,
      found: undefined,
      error: null,
      pending: true,
      retrying: false,
      fetching: false,
    }
  }
  const error = read.error ?? read.failureReason
  return {
    engine,
    found: read.data,
    error,
    pending: read.isPending && error === null,
    retrying: (read.isFetching || read.isPaused) && read.failureReason !== null,
    fetching: read.isFetching,
  }
}

/** Whether an engine's search is over: answered, or failed with no retry left. */
export const searchedOut = ({ pending, retrying }: EngineSearch): boolean => !pending && !retrying

/**
 * The search for `text` on every engine of the frame's one read of the engine list (the engines of
 * every dialect), each its own call made at once beside the others, as the start page reads each
 * engine, one at a time per engine (the page's `engineLanes`), so each engine's failure is its own
 * and never holds back the hits of the others; a refused profile is read nothing of, its refusal
 * the list's (after the engines). Nothing is read for no text.
 */
export function useSearchReads(text: string) {
  const list = useEngineList()
  // The list as the search reads it: none before it answered, nor for no text.
  const listed = text === "" ? undefined : list.data
  const reads = useMemo(() => (listed?.engines ?? []).map(({ id }) => id), [listed])
  const queries = useToolQueries<FindScreenData>(
    reads.map((engine) => ({ key: FIND_KEY, tool: FIND_FEED, args: { engine, text } })),
  )
  const refused = (listed?.refused ?? []).map(({ id, reason }): EngineSearch => ({
    engine: id,
    found: undefined,
    error: refusalOf(id, reason),
    pending: false,
    retrying: false,
    fetching: false,
  }))
  const searches = [...reads.map((engine, index) => searchOf(engine, queries[index])), ...refused]
  const refetch = () => {
    for (const query of queries) void query.refetch()
  }
  return { list, searches, refetch }
}
