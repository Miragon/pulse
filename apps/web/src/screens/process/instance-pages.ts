import { useMemo, useState } from "react"
import { useInstanceRows } from "@miragon/pulse-blocks"
import type { InstanceListFilterData, InstanceRowData } from "@miragon/pulse-screens"
import {
  decodeToolResult,
  isPermanentError,
  useToolQuery,
  useViewHost,
} from "@miragon/pulse-widget-shell/widgets"
import { READ_AGAIN_AFTER_MS } from "../read-on-return.js"
import {
  INSTANCES_FEED,
  instancesArgs,
  instancesKey,
  isRefusedCondition,
  type InstancesFeed,
} from "./process-feed.js"

/** How many times a failed read runs again by itself: TanStack's three, never for a refusal. */
const READ_RETRIES = 3

/** A refusal no retry changes: the kit's, and a condition of a kind the engine refuses. */
export const isListRefusal = (error: unknown): boolean =>
  isPermanentError(error) || isRefusedCondition(error)

/** The pages read after the first, of the first page read at `base`. */
interface LaterPages {
  readonly base: number
  readonly pages: readonly (readonly InstanceRowData[])[]
  readonly next: string | null
  readonly loading: boolean
  /** Why the last further page failed: whatever the call rejected with; null without a failure. */
  readonly error: unknown
}

const NONE: LaterPages = { base: -1, pages: [], next: null, loading: false, error: null }

/** The instance list of a process screen, page by page. */
export interface InstancePages {
  /** The first page: its counts, its refused kinds, its state of reading. */
  readonly first: ReturnType<typeof useToolQuery<InstancesFeed>>
  /** The rows of every page read, a later page after the rows before it. */
  readonly rows: readonly InstanceRowData[]
  /** Whether a further page follows. */
  readonly hasMore: boolean
  /** Reads the next page and puts its rows after those shown. */
  readonly loadMore: () => void
  readonly loadingMore: boolean
  /** The last failure of a further page, null without one. */
  readonly moreError: unknown
}

/**
 * A version's instance list by its filter, page by page (D10's point 8): the first page with the
 * scopes' counts through the list feed, fresh for 60 s (the screen reads it again after its
 * versions, on Refresh and when the reader comes back), the rows of the filter before it kept on
 * screen while it reads (the filter bar stays; another version's rows never); each
 * further page by the cursor of the one before (Load more), its rows after those shown without a
 * row shown already (the blocks' `useInstanceRows`). A first page read anew (a Refresh, another
 * filter, the reader's return) starts the list over. Nothing reads before the version is known.
 */
export function useInstancePages(
  engine: string,
  definitionId: string | undefined,
  filter: InstanceListFilterData,
  ready: boolean,
): InstancePages {
  const version = definitionId ?? ""
  const args = useMemo(() => instancesArgs(engine, version, filter), [engine, version, filter])
  const enabled = ready && definitionId !== undefined
  const first = useToolQuery<InstancesFeed>(instancesKey(engine, version), INSTANCES_FEED, args, {
    staleTime: READ_AGAIN_AFTER_MS,
    enabled,
    // The rows of the filter before stay while another filter reads: the bar keeps its place.
    // Another version's rows never stand in for this version's.
    placeholderData: (previous, before) => (before?.queryKey[2] === version ? previous : undefined),
    retry: (failures, error) => failures < READ_RETRIES && !isListRefusal(error),
  })
  const { callTool } = useViewHost()
  const [later, setLater] = useState<LaterPages>(NONE)
  const base = first.isPlaceholderData ? NONE.base : first.dataUpdatedAt
  const current = later.base === base ? later : NONE
  const firstRows = first.data?.rows
  const pages = useMemo(
    () => (firstRows === undefined ? [] : [firstRows, ...current.pages]),
    [firstRows, current.pages],
  )
  const rows = useInstanceRows(pages)
  const next = current.pages.length > 0 ? current.next : (first.data?.next ?? null)
  // Offered only while a page follows and none is being read (`LoadMore` waits while busy).
  const loadMore = () => {
    setLater({ ...current, base, loading: true, error: null })
    const settle = (change: (pages: LaterPages) => LaterPages) => {
      setLater((shown) => (shown.base === base ? change(shown) : shown))
    }
    callTool(INSTANCES_FEED, { ...args, after: next })
      .then((result) => decodeToolResult<InstancesFeed>(result))
      .then(
        (page) => {
          settle((shown) => ({
            ...shown,
            pages: [...shown.pages, page.rows],
            next: page.next,
            loading: false,
          }))
        },
        (error: unknown) => {
          settle((shown) => ({ ...shown, loading: false, error }))
        },
      )
  }
  return {
    first,
    rows,
    hasMore: next !== null,
    loadMore,
    loadingMore: current.loading,
    moreError: current.error,
  }
}
