// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react"
import { PagedListFooter } from "@miragon/pulse-ui"
import { spyHost } from "./tool-host.test-support.js"
import { useCursorViewData } from "./use-cursor-view-data.js"

/** Retries are off, so a failure is final at once. */

interface Page {
  items: string[]
  total: number
  next: string | null
}

const page = (items: string[], total: number, next: string | null): Page => ({
  items,
  total,
  next,
})
const toolResult = (p: Page) => ({ structuredContent: p })

const selectItems = (data: Page) => data.items
const selectTotal = (data: Page) => data.total
const selectNext = (data: Page) => data.next

const callTool = vi.fn()

const host = spyHost("test_cursor_data", callTool)

interface HarnessProps {
  initialData: Page | null
  args: Record<string, unknown>
}

const useList = ({ initialData, args }: HarnessProps) =>
  useCursorViewData<string, Page>({
    initialData,
    key: ["test:cursor", "list-1"],
    tool: "test_cursor_data",
    args,
    pageSize: 2,
    ready: true,
    selectItems,
    selectTotal,
    selectNext,
  })

function setup(props: HarnessProps) {
  return renderHook(useList, { wrapper: host.wrapper, initialProps: props })
}

/** A tool answer that waits until the test lands it. */
function deferred() {
  let land!: (value: unknown) => void
  const promise = new Promise((resolve) => {
    land = resolve
  })
  return { promise, land }
}

beforeEach(() => {
  callTool.mockReset()
  host.reset()
})

afterEach(async () => {
  cleanup()
  await host.dispose()
})

const invalidate = () => act(() => host.client().invalidateQueries({ queryKey: ["test:cursor"] }))

describe("useCursorViewData", () => {
  it("reads page 0 without a cursor, its rows, its total and whether a next page follows", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["a", "b"], 5, "2,-")))
    const { result } = setup({ initialData: null, args: { activityId: "x" } })
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))
    expect(result.current.total).toBe(5)
    expect(result.current.hasMore).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(callTool).toHaveBeenCalledWith("test_cursor_data", { activityId: "x", maxResults: 2 })
  })

  it("reads each further page by the cursor of the one before, until a page names none", async () => {
    const { result } = setup({ initialData: page(["a", "b"], 5, "2,-"), args: {} })

    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 5, "4,-")))
    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))
    expect(callTool).toHaveBeenLastCalledWith("test_cursor_data", { after: "2,-", maxResults: 2 })
    expect(result.current.hasMore).toBe(true)

    callTool.mockResolvedValueOnce(toolResult(page(["e"], 5, null)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d", "e"]))
    expect(callTool).toHaveBeenLastCalledWith("test_cursor_data", { after: "4,-", maxResults: 2 })
    expect(result.current.hasMore).toBe(false)
    expect(result.current.loadingMore).toBe(false)
  })

  it("reads on from a page that came back empty with a cursor, whatever the total says", async () => {
    const { result } = setup({ initialData: page(["a"], 1, "1998,0"), args: {} })

    callTool.mockResolvedValueOnce(toolResult(page([], 1, "3996,0")))
    act(() => result.current.loadMore())
    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.loadingMore).toBe(false))
    expect(result.current.items).toEqual(["a"])
    expect(result.current.hasMore).toBe(true)

    callTool.mockResolvedValueOnce(toolResult(page(["b"], 1, null)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))
    expect(callTool).toHaveBeenLastCalledWith("test_cursor_data", {
      after: "3996,0",
      maxResults: 2,
    })
    expect(result.current.hasMore).toBe(false)
  })

  it("counts no fewer than the rows on screen and one more while a page follows, whatever page 0 said", async () => {
    const { result } = setup({ initialData: page(["a", "b"], 0, "2,-"), args: {} })
    expect(result.current.total).toBe(3)

    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 0, "4,-")))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))
    expect(result.current.total).toBe(5)

    callTool.mockResolvedValueOnce(toolResult(page(["e"], 0, null)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toHaveLength(5))
    expect(result.current.total).toBe(5)
  })

  it("keeps page 0's total where it counts more than the list proves", () => {
    const { result } = setup({ initialData: page(["a", "b"], 9, "2,-"), args: {} })

    expect(result.current.total).toBe(9)
  })

  it("offers Load more in the footer while a page follows, over a page 0 that counted none", () => {
    function List() {
      return <PagedListFooter paged={useList({ initialData: page(["a"], 0, "1,-"), args: {} })} />
    }
    render(<List />, { wrapper: host.wrapper })

    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy()
    expect(screen.getByText("Showing 1 of 2 rows")).toBeTruthy()
  })

  it("offers no further page where page 0 names none", () => {
    const { result } = setup({ initialData: page(["a", "b"], 9, null), args: {} })

    expect(result.current.hasMore).toBe(false)
    act(() => result.current.loadMore())
    expect(callTool).not.toHaveBeenCalled()
  })

  it("starts the list over when page 0 is read anew, its cursor page 0's again", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["a", "b"], 4, "2,-")))
    const { result } = setup({ initialData: null, args: {} })
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))
    callTool.mockResolvedValueOnce(toolResult(page(["c", "d"], 4, null)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))
    expect(result.current.hasMore).toBe(false)

    // A write resolved "a": the pages after page 0 went on from the one before.
    callTool.mockResolvedValueOnce(toolResult(page(["b", "c"], 3, "3,-")))
    await invalidate()
    await waitFor(() => expect(result.current.items).toEqual(["b", "c"]))
    expect(result.current.hasMore).toBe(true)
    callTool.mockResolvedValueOnce(toolResult(page(["d"], 3, null)))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["b", "c", "d"]))
    expect(callTool).toHaveBeenLastCalledWith("test_cursor_data", { after: "3,-", maxResults: 2 })
  })

  it("never puts a page that lands after another filter's page 0 into the list", async () => {
    const more = deferred()
    callTool.mockReturnValueOnce(more.promise)
    const initialData = page(["a", "b"], 5, "2,-")
    const { result, rerender } = setup({ initialData, args: {} })

    act(() => result.current.loadMore())
    rerender({ initialData, args: { q: "b" } })
    rerender({ initialData, args: {} })
    await act(async () => {
      more.land(toolResult(page(["z1", "z2"], 5, null)))
      await Promise.resolve()
    })

    expect(result.current.items).toEqual(["a", "b"])
    expect(result.current.hasMore).toBe(true)
    expect(result.current.loadingMore).toBe(false)
  })

  it("says a further page's failure apart from page 0, and reads it again on loadMore", async () => {
    callTool.mockRejectedValueOnce(new Error("boom"))
    const { result } = setup({ initialData: page(["a", "b"], 3, "2,-"), args: {} })

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.loadMoreError?.message).toBe("boom"))
    expect(result.current.error).toBeNull()
    expect(result.current.hasMore).toBe(true)

    const retry = deferred()
    callTool.mockReturnValueOnce(retry.promise)
    act(() => result.current.loadMore())
    expect(result.current.loadMoreError).toBeNull()
    await act(async () => {
      retry.land(toolResult(page(["c"], 3, null)))
      await Promise.resolve()
    })
    expect(result.current.items).toEqual(["a", "b", "c"])
    expect(callTool).toHaveBeenLastCalledWith("test_cursor_data", { after: "2,-", maxResults: 2 })
  })

  it("keeps the previous filter's rows while its page 0 reads, without a next page of them", async () => {
    callTool.mockResolvedValueOnce(toolResult(page(["a", "b"], 3, "2,-")))
    const { result, rerender } = setup({ initialData: null, args: {} })
    await waitFor(() => expect(result.current.items).toEqual(["a", "b"]))

    const search = deferred()
    callTool.mockReturnValueOnce(search.promise)
    rerender({ initialData: null, args: { q: "x" } })
    await waitFor(() => expect(result.current.refreshing).toBe(true))

    expect(result.current.items).toEqual(["a", "b"])
    expect(result.current.stale).toBe(true)
    expect(result.current.hasMore).toBe(false)
    act(() => search.land(toolResult(page(["x1"], 1, null))))
    await waitFor(() => expect(result.current.items).toEqual(["x1"]))
    expect(result.current.stale).toBe(false)
  })

  it("says a page-0 failure without rows, and reads again on retry", async () => {
    callTool.mockRejectedValueOnce(new Error("down"))
    const { result } = setup({ initialData: null, args: {} })
    await waitFor(() => expect(result.current.error?.message).toBe("down"))
    expect(result.current.loading).toBe(false)
    expect(result.current.canRetry?.(new Error("down"))).toBe(true)

    callTool.mockResolvedValueOnce(toolResult(page(["a"], 1, null)))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.items).toEqual(["a"]))
    expect(result.current.error).toBeNull()
  })
})
