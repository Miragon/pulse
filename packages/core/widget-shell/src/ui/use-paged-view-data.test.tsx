// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { AppQueryProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { usePagedViewData } from "./use-paged-view-data.js"

/** Retries are off, so a failure is final at once; backoff cases live in the `.seeded` suite. */

interface Page {
  items: string[]
  total: number
}

const page = (items: string[], total: number): Page => ({ items, total })
const toolResult = (p: Page) => ({ structuredContent: p })

const selectItems = (data: Page) => data.items
const selectTotal = (data: Page) => data.total

const callTool = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
}

interface HarnessProps {
  initialData: Page | null
  args: Record<string, unknown>
  scope?: string
}

function setup(props: HarnessProps) {
  return renderHook(
    ({ initialData, args, scope = "list-1" }: HarnessProps) =>
      usePagedViewData<string, Page>({
        initialData,
        key: ["test:list", scope],
        tool: "test_list_data",
        args,
        pageSize: 2,
        ready: true,
        selectItems,
        selectTotal,
      }),
    { wrapper, initialProps: props },
  )
}

const page0Calls = (args: Record<string, unknown>) =>
  callTool.mock.calls.filter(
    ([, sent]) =>
      JSON.stringify(sent) === JSON.stringify({ ...args, firstResult: 0, maxResults: 2 }),
  )

/** A tool answer that waits until the test lands it. */
function deferred() {
  let land!: (value: unknown) => void
  let fail!: (error: Error) => void
  const promise = new Promise((resolve, reject) => {
    land = resolve
    fail = reject
  })
  return { promise, land, fail }
}

const toolkitDefaults = queryClient.getDefaultOptions()

beforeEach(() => {
  callTool.mockReset()
  queryClient.setDefaultOptions({
    ...toolkitDefaults,
    queries: { ...toolkitDefaults.queries, retry: false },
  })
})

afterEach(() => {
  cleanup()
  // The seed lands in the toolkit's singleton client — never across tests.
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
})

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
const invalidate = () => act(() => queryClient.invalidateQueries({ queryKey: ["test:list"] }))

describe("usePagedViewData", () => {
  it("serves page 0 from handed-in initialData — as the SEED of a live page-0 query", async () => {
    const initialData = page(["a", "b"], 5)
    const { result } = setup({ initialData, args: {} })
    expect(result.current.items).toEqual(["a", "b"])
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.stale).toBe(false)
    const page0Key = ["test:list", "list-1", "{}", "page0", { firstResult: 0, maxResults: 2 }]
    expect(queryClient.getQueryData(page0Key)).toBe(initialData)
    // A fresh seed is not refetched on mount …
    await settle()
    expect(callTool).not.toHaveBeenCalled()
    // … and never switched off: a write's invalidation refetches a standalone list.
    callTool.mockResolvedValue(toolResult(page(["a2", "b2"], 5)))
    await invalidate()
    await waitFor(() => expect(result.current.items).toEqual(["a2", "b2"]))
    expect(page0Calls({})).toHaveLength(1)
  })

  it("self-fetches page 0 when no initialData is handed in", async () => {
    callTool.mockResolvedValue(toolResult(page(["a", "b"], 3)))
    const { result } = setup({ initialData: null, args: {} })
    expect(result.current.loading).toBe(true)
    expect(result.current.items).toEqual([])
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))
    expect(result.current.loading).toBe(false)
    expect(page0Calls({})).toHaveLength(1)
  })

  it("appends the next offset on loadMore", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 5)))
    const { result } = setup({ initialData: page(["a", "b"], 5), args: {} })

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))
    expect(callTool).toHaveBeenCalledWith("test_list_data", {
      firstResult: 2,
      maxResults: 2,
    })
    expect(result.current.loadingMore).toBe(false)
    expect(result.current.hasMore).toBe(true)
  })

  it("drops accumulated pages when args change", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 5)))
    const initialData = page(["a", "b"], 5)
    const { result, rerender } = setup({ initialData, args: {} })
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))

    rerender({ initialData, args: { q: "x" } })
    expect(result.current.items).toEqual(["a", "b"])
  })

  it("drops accumulated pages when the self-fetched page 0 refetches", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["a", "b"], 4)))
    const { result } = setup({ initialData: null, args: {} })
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))
    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 4)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))

    // A mutation shifted page 0: keeping the appended page would duplicate "c".
    callTool.mockResolvedValueOnce(toolResult(page(["b", "c"], 3)))
    await invalidate()
    await waitFor(() => expect(result.current.items).toEqual(["b", "c"]))
  })

  it("drops accumulated pages when a fresh initialData identity is handed in", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 5)))
    const { result, rerender } = setup({ initialData: page(["a", "b"], 5), args: {} })
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))

    rerender({ initialData: page(["a2", "b2"], 5), args: {} })
    expect(result.current.items).toEqual(["a2", "b2"])
  })

  it("discards an in-flight page across an A→B→A args round-trip", async () => {
    const more = deferred()
    callTool.mockReturnValueOnce(more.promise)
    const initialData = page(["a", "b"], 5)
    const { result, rerender } = setup({ initialData, args: {} })

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)

    rerender({ initialData, args: { q: "b" } })
    rerender({ initialData, args: {} })

    // Resolves at a stale offset for the pre-round-trip filter — must not append.
    await act(async () => {
      more.land(toolResult(page(["z1", "z2"], 5)))
      await Promise.resolve()
    })
    expect(result.current.items).toEqual(["a", "b"])
    expect(result.current.loadingMore).toBe(false)
  })

  it("surfaces a loadMore error as loadMoreError and clears it on retry", async () => {
    callTool.mockRejectedValueOnce(new Error("boom"))
    const { result } = setup({ initialData: page(["a", "b"], 5), args: {} })

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.loadMoreError?.message).toBe("boom"))
    // A load-more failure is not a page-0 failure: the rows above are current.
    expect(result.current.error).toBeNull()

    const retry = deferred()
    callTool.mockReturnValueOnce(retry.promise)
    act(() => result.current.loadMore())
    // Cleared eagerly, before the retry resolves.
    expect(result.current.loadMoreError).toBeNull()

    await act(async () => {
      retry.land(toolResult(page(["c", "d"], 5)))
      await Promise.resolve()
    })
    expect(result.current.items).toEqual(["a", "b", "c", "d"])
    expect(result.current.loadMoreError).toBeNull()
  })

  it("stops paging after a short page even when the reported total claims more", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["c"], 10)))
    const { result } = setup({ initialData: page(["a", "b"], 10), args: {} })

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c"]))
    expect(result.current.hasMore).toBe(false)
  })
})

/**
 * A new page 0 must never unmount the list (#341 N123), and a page-0 failure
 * is never reported as "Failed to load more" (N130).
 */
describe("usePagedViewData — page-0 fetch states", () => {
  const A = page(["a", "b"], 3)
  const SEARCH = { q: "x" }

  async function settledOnA() {
    callTool.mockResolvedValueOnce(toolResult(A))
    const hook = setup({ initialData: null, args: {} })
    await waitFor(() => expect(hook.result.current.firstPage).toEqual(A))
    return hook
  }

  it("keeps the previous result while a changed filter's page 0 is in flight", async () => {
    const { result, rerender } = await settledOnA()
    expect(result.current.stale).toBe(false)

    const search = deferred()
    callTool.mockReturnValueOnce(search.promise)
    rerender({ initialData: null, args: SEARCH })
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(1))

    expect(result.current.firstPage).toEqual(A)
    expect(result.current.items).toEqual(["a", "b"])
    expect(result.current.total).toBe(3)
    // … and says so: the page and its total are the previous filter's.
    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.error).toBeNull()
    // The rows on screen belong to the previous filter: no next page of them.
    expect(result.current.hasMore).toBe(false)
    const sent = callTool.mock.calls.length
    act(() => result.current.loadMore())
    expect(callTool).toHaveBeenCalledTimes(sent)

    // The new page lands and replaces it.
    const B = page(["x1"], 1)
    act(() => search.land(toolResult(B)))
    await waitFor(() => expect(result.current.firstPage).toEqual(B))
    expect(result.current.items).toEqual(["x1"])
    expect(result.current.refreshing).toBe(false)
    expect(result.current.stale).toBe(false)
  })

  it("keeps a handed-in page while the first filtered page 0 is in flight", async () => {
    callTool.mockReturnValue(deferred().promise)
    const { result, rerender } = setup({ initialData: A, args: {} })
    // Standalone: the search drops the handed-in page, the feed answers it.
    rerender({ initialData: null, args: SEARCH })
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(1))
    expect(result.current.firstPage).toBe(A)
    expect(result.current.stale).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it("keeps a page that landed AFTER mount (cockpit self-fetch: pending first)", async () => {
    const first = deferred()
    callTool.mockReturnValueOnce(first.promise)
    const { result, rerender } = setup({ initialData: null, args: {} })
    expect(result.current.loading).toBe(true)

    act(() => first.land(toolResult(A)))
    await waitFor(() => expect(result.current.firstPage).toEqual(A))
    callTool.mockReturnValue(deferred().promise)
    rerender({ initialData: null, args: SEARCH })
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(1))
    expect(result.current.firstPage).toEqual(A)
  })

  it("keeps the page the list SHOWS: a handed-in page carried into a new key scope", async () => {
    callTool.mockReturnValue(deferred().promise)
    const { result, rerender } = setup({ initialData: A, args: {}, scope: "list-1" })
    // The same handed-in page, now rendered under another scope …
    rerender({ initialData: A, args: {}, scope: "list-2" })
    // … is what that list shows, so its first search keeps it.
    rerender({ initialData: null, args: SEARCH, scope: "list-2" })
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(1))
    expect(result.current.firstPage).toBe(A)
  })

  it("never carries a result over into another list (a changed key scope)", async () => {
    const { result, rerender } = await settledOnA()
    callTool.mockReturnValue(deferred().promise)
    rerender({ initialData: null, args: {}, scope: "list-2" })
    await waitFor(() => expect(page0Calls({})).toHaveLength(2))
    expect(result.current.firstPage).toBeNull()
    expect(result.current.items).toEqual([])
    expect(result.current.loading).toBe(true)
    expect(result.current.refreshing).toBe(false)
    expect(result.current.stale).toBe(false)
  })

  it("a failed filtered page 0 keeps the previous rows, reports a page-0 error and retries page 0", async () => {
    const { result, rerender } = await settledOnA()
    callTool.mockRejectedValueOnce(new Error("engine down"))
    rerender({ initialData: null, args: SEARCH })

    // Final failure: TanStack drops its placeholder, the rows the failure line refers to stay.
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.firstPage).toEqual(A)
    expect(result.current.stale).toBe(true)
    expect(result.current.loadMoreError).toBeNull()

    const again = deferred()
    callTool.mockReturnValueOnce(again.promise)
    act(() => result.current.retry())
    // The retry re-runs page 0 of the search — never the next offset.
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(2))
    expect(
      callTool.mock.calls.some(([, sent]) => (sent as { firstResult: number }).firstResult > 0),
    ).toBe(false)
    expect(result.current.firstPage).toEqual(A)
    expect(result.current.stale).toBe(true)
    act(() => again.land(toolResult(page(["x1"], 1))))
    await waitFor(() => expect(result.current.items).toEqual(["x1"]))
    expect(result.current.error).toBeNull()
    expect(result.current.stale).toBe(false)
  })

  it("a failed background refetch is a page-0 error over the stale rows — never a load-more error", async () => {
    const { result } = await settledOnA()
    callTool.mockRejectedValueOnce(new Error("timeout"))
    await invalidate()

    await waitFor(() => expect(result.current.error?.message).toBe("timeout"))
    expect(result.current.items).toEqual(["a", "b"])
    // The last good page is still THIS filter's: rows on screen, not stale.
    expect(result.current.stale).toBe(false)
    expect(result.current.loadMoreError).toBeNull()

    callTool.mockResolvedValueOnce(toolResult(A))
    act(() => result.current.retry())
    await waitFor(() => expect(page0Calls({})).toHaveLength(3))
    await waitFor(() => expect(result.current.error).toBeNull())
  })

  it("an initial page-0 failure has nothing to keep: no rows, the error for the caller's guard", async () => {
    callTool.mockRejectedValueOnce(new Error("engine down"))
    const { result } = setup({ initialData: null, args: {} })
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.firstPage).toBeNull()
    expect(result.current.stale).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it("never bridges a failure into another list", async () => {
    const { result, rerender } = await settledOnA()
    callTool.mockRejectedValueOnce(new Error("engine down"))
    rerender({ initialData: null, args: {}, scope: "list-2" })
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.firstPage).toBeNull()
    expect(result.current.stale).toBe(false)
  })

  it("bridges a failed search over the page the list SHOWS, also one carried into a new scope", async () => {
    const { result, rerender } = setup({ initialData: A, args: {}, scope: "list-1" })
    // The same handed-in page, now this list's (scope list-2) …
    rerender({ initialData: A, args: {}, scope: "list-2" })
    callTool.mockRejectedValueOnce(new Error("engine down"))
    // … so when its first search fails for good, the rows it keeps are this page.
    rerender({ initialData: null, args: SEARCH, scope: "list-2" })
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.firstPage).toBe(A)
    expect(result.current.stale).toBe(true)
  })
})
