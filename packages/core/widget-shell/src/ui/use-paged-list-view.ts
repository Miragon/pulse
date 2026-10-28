import { useState } from "react"
import { useDebouncedValue } from "@miragon/mcp-toolkit-ui"
import { usePagedViewData, type PagedViewData } from "./use-paged-view-data.js"

export interface PagedListView<TItem, TData> {
  paged: PagedViewData<TItem, TData>
  search: string
  setSearch: (next: string) => void
  debouncedSearch: string
  /** Stays the previous result's while `paged.stale`: no "no match" for a search that has not answered. */
  interacted: boolean
}

/**
 * Search box, 300 ms debounce and the server-side search arg; the search is a
 * feed param so it covers the whole result set, not the loaded page.
 */
export function usePagedListView<TItem, TData>(opts: {
  initialData: TData | null | undefined
  key: ReadonlyArray<unknown>
  tool: string
  args: Record<string, unknown>
  /** Omit for lists without a search box. */
  searchArg?: string
  /** Non-search filters that must also drop the handed-in unfiltered page 0. */
  filtersActive?: boolean
  pageSize: number
  ready: boolean
  selectItems: (data: TData) => TItem[]
  selectTotal: (data: TData) => number
}): PagedListView<TItem, TData> {
  const {
    initialData,
    key,
    tool,
    args,
    searchArg,
    filtersActive = false,
    pageSize,
    ready,
    selectItems,
    selectTotal,
  } = opts
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)

  const requested = debouncedSearch !== "" || filtersActive
  const effectiveArgs =
    searchArg && debouncedSearch !== "" ? { ...args, [searchArg]: debouncedSearch } : args

  const paged = usePagedViewData<TItem, TData>({
    // Standalone data is only the unfiltered first page.
    initialData: requested ? null : initialData,
    key,
    tool,
    args: effectiveArgs,
    pageSize,
    ready,
    selectItems,
    selectTotal,
  })

  // The rows on screen answer the last SETTLED request.
  const [shownRequested, setShownRequested] = useState(requested)
  if (!paged.stale && shownRequested !== requested) setShownRequested(requested)
  const interacted = paged.stale ? shownRequested : requested

  return { paged, search, setSearch, debouncedSearch, interacted }
}
