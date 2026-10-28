// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { AppQueryProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { usePagedListView } from "./use-paged-list-view.js"

interface Page {
  items: string[]
  total: number
}

const PAGE: Page = { items: ["a", "b"], total: 10 }
const toolResult = (p: Page) => ({ structuredContent: p })

const callTool = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
}

/** The list's filter args: a chip (`suspended`) is part of them, as in the real lists. */
const argsFor = (filtersActive: boolean) =>
  filtersActive ? { scope: "s1", suspended: true } : { scope: "s1" }

function setup(opts?: { initialData?: Page | null; filtersActive?: boolean }) {
  return renderHook(
    ({ filtersActive }: { filtersActive: boolean }) =>
      usePagedListView<string, Page>({
        initialData: opts?.initialData ?? null,
        key: ["test:list"],
        tool: "test_list_data",
        args: argsFor(filtersActive),
        searchArg: "nameLike",
        filtersActive,
        pageSize: 2,
        ready: true,
        selectItems: (d) => d.items,
        selectTotal: (d) => d.total,
      }),
    { wrapper, initialProps: { filtersActive: opts?.filtersActive ?? false } },
  )
}

const page0Calls = (args: Record<string, unknown>) =>
  callTool.mock.calls.filter(
    ([, sent]) =>
      JSON.stringify(sent) === JSON.stringify({ ...args, firstResult: 0, maxResults: 2 }),
  )

function deferred() {
  let land!: (value: unknown) => void
  const promise = new Promise((resolve) => (land = resolve))
  return { promise, land }
}

const debounce = () => act(() => new Promise((resolve) => setTimeout(resolve, 350)))

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
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
})

describe("usePagedListView", () => {
  it("adds the debounced, trimmed search value as the server-side search arg", async () => {
    callTool.mockResolvedValue(toolResult(PAGE))
    const { result } = setup()
    await waitFor(() => expect(result.current.paged.items).toEqual(["a", "b"]))

    act(() => result.current.setSearch("  ORDER-1 "))
    // Before the debounce elapses the feed still sees the base args.
    expect(callTool.mock.calls.some(([, sent]) => "nameLike" in (sent as object))).toBe(false)
    expect(result.current.interacted).toBe(false)

    await debounce()
    await waitFor(() => expect(page0Calls({ scope: "s1", nameLike: "ORDER-1" })).toHaveLength(1))
    await waitFor(() => expect(result.current.interacted).toBe(true))
    expect(result.current.debouncedSearch).toBe("ORDER-1")
  })

  it("drops the handed-in page 0 once a search or filter is active", async () => {
    const { result, rerender } = setup({ initialData: PAGE })
    // Unfiltered: the handed-in page is the seed of a query that stays live.
    expect(result.current.paged.items).toEqual(["a", "b"])
    expect(
      queryClient.getQueryData([
        "test:list",
        JSON.stringify({ scope: "s1" }),
        "page0",
        { scope: "s1", firstResult: 0, maxResults: 2 },
      ]),
    ).toBe(PAGE)
    expect(callTool).not.toHaveBeenCalled()

    callTool.mockReturnValue(deferred().promise)
    act(() => result.current.setSearch("x"))
    await debounce()
    // The filtered view must come from the feed, not the unfiltered page …
    await waitFor(() => expect(page0Calls({ scope: "s1", nameLike: "x" })).toHaveLength(1))
    // … but until it answers the handed-in rows stay (#341 N123).
    expect(result.current.paged.firstPage).toBe(PAGE)
    expect(result.current.paged.items).toEqual(["a", "b"])
    expect(result.current.paged.loading).toBe(false)

    // Chips (filtersActive) drop the handed-in page the same way.
    act(() => result.current.setSearch(""))
    await debounce()
    rerender({ filtersActive: true })
    await waitFor(() => expect(page0Calls({ scope: "s1", suspended: true })).toHaveLength(1))
    expect(result.current.paged.firstPage).toBe(PAGE)
    expect(result.current.paged.stale).toBe(true)
  })

  it("`interacted` describes the rows on screen, not a filter that has not answered", async () => {
    const EMPTY: Page = { items: [], total: 0 }
    const { result, rerender } = setup({ initialData: EMPTY })
    expect(result.current.interacted).toBe(false)

    // In flight: the empty state must not read "no match" for a filter nobody answered.
    const chip = deferred()
    callTool.mockReturnValueOnce(chip.promise)
    rerender({ filtersActive: true })
    await waitFor(() => expect(page0Calls({ scope: "s1", suspended: true })).toHaveLength(1))
    expect(result.current.paged.stale).toBe(true)
    expect(result.current.interacted).toBe(false)

    // The filtered page lands: the rows on screen are now the filtered set.
    act(() => chip.land(toolResult({ items: [], total: 0 })))
    await waitFor(() => expect(result.current.paged.stale).toBe(false))
    expect(result.current.interacted).toBe(true)
  })

  it("a filtered result on screen still reads as filtered while the unfiltered one loads", async () => {
    const ALL: Page = { items: ["a"], total: 1 }
    const FILTERED: Page = { items: [], total: 0 }
    callTool.mockResolvedValueOnce(toolResult(ALL))
    const { result, rerender } = setup({ initialData: null })
    await waitFor(() => expect(result.current.paged.firstPage).toEqual(ALL))
    expect(result.current.interacted).toBe(false)

    // The chip's page lands: the filtered set is on screen.
    callTool.mockResolvedValueOnce(toolResult(FILTERED))
    rerender({ filtersActive: true })
    await waitFor(() => expect(result.current.paged.firstPage).toEqual(FILTERED))
    expect(result.current.paged.stale).toBe(false)
    expect(result.current.interacted).toBe(true)

    // The chip is cleared; the unfiltered page 0 (gone from the cache) is in flight.
    queryClient.removeQueries({ queryKey: ["test:list", JSON.stringify({ scope: "s1" })] })
    callTool.mockReturnValueOnce(deferred().promise)
    rerender({ filtersActive: false })
    await waitFor(() => expect(page0Calls({ scope: "s1" })).toHaveLength(2))
    expect(result.current.paged.firstPage).toEqual(FILTERED)
    expect(result.current.paged.stale).toBe(true)
    expect(result.current.interacted).toBe(true)
  })
})
