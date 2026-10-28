// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { AppQueryProvider, PagedListFooter, queryClient } from "@miragon/mcp-toolkit-ui"
import { usePagedViewData } from "./use-paged-view-data.js"

/**
 * Under the production retry defaults (#341): a failed page 0 is reported from
 * its first attempt, and Retry is a new read at once, even during the backoff.
 */

interface Page {
  items: string[]
  total: number
}

const KEY = ["test:paged", "prod"]
const SEED: Page = { items: ["a", "b"], total: 4 }

const callTool = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
}

const answer = (page: Page) => ({ structuredContent: page })

interface Props {
  /** The handed-in page 0 — dropped by `usePagedListView` once a filter is set. */
  initialData: Page | null
  args: Record<string, unknown>
}

function useList({ initialData, args }: Props) {
  return usePagedViewData<string, Page>({
    initialData,
    key: KEY,
    tool: "test_list_data",
    args,
    pageSize: 2,
    ready: true,
    selectItems: (d) => d.items,
    selectTotal: (d) => d.total,
  })
}

function setup(props: Props) {
  return renderHook(useList, { wrapper, initialProps: props })
}

function ListFooter(props: Props) {
  return <PagedListFooter paged={useList(props)} noun="items" />
}

const page0Calls = (args: Record<string, unknown>) =>
  callTool.mock.calls.filter(
    ([, sent]) =>
      JSON.stringify(sent) === JSON.stringify({ ...args, firstResult: 0, maxResults: 2 }),
  )

const SEARCH = { q: "x" }

beforeEach(() => {
  // A block: a returned function would be called as the teardown.
  callTool.mockReset()
})

afterEach(() => {
  cleanup()
  // Also cancels a retry still waiting on its backoff.
  queryClient.clear()
})

describe("usePagedViewData — a seeded page 0 that keeps its rows (real query stack)", () => {
  it("serves the seed without a fetch; a write's invalidation replaces it and collapses the pages", async () => {
    const { result } = setup({ initialData: SEED, args: {} })
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.firstPage).toBe(SEED)

    callTool.mockResolvedValueOnce(answer({ items: ["c", "d"], total: 4 }))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.items).toEqual(["a", "b", "c", "d"]))

    callTool.mockResolvedValue(answer({ items: ["b", "c"], total: 3 }))
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:paged"] }))
    await waitFor(() => expect(result.current.items).toEqual(["b", "c"]))
    expect(result.current.total).toBe(3)
    expect(result.current.stale).toBe(false)
  })

  it("keeps the seeded rows while a search's page 0 is in flight — stale, no next page of them", async () => {
    let land!: (value: unknown) => void
    callTool.mockReturnValue(new Promise((resolve) => (land = resolve)))
    const { result, rerender } = setup({ initialData: SEED, args: {} })

    rerender({ initialData: null, args: SEARCH })
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(1))
    expect(result.current.firstPage).toBe(SEED)
    expect(result.current.stale).toBe(true)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(result.current.hasMore).toBe(false)
    expect(result.current.error).toBeNull()

    act(() => land(answer({ items: ["x1"], total: 1 })))
    await waitFor(() => expect(result.current.items).toEqual(["x1"]))
    expect(result.current.total).toBe(1)
    expect(result.current.stale).toBe(false)
    expect(result.current.refreshing).toBe(false)
  })

  it("a cleared search shows the refetched page 0 again — the old seed never rolls it back", async () => {
    const { result, rerender } = setup({ initialData: SEED, args: {} })
    callTool.mockResolvedValue(answer({ items: ["a2", "b2"], total: 4 }))
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:paged"] }))
    await waitFor(() => expect(result.current.items).toEqual(["a2", "b2"]))

    callTool.mockResolvedValue(answer({ items: ["x1"], total: 1 }))
    rerender({ initialData: null, args: SEARCH })
    await waitFor(() => expect(result.current.items).toEqual(["x1"]))

    // The search is cleared: the scaffold hands the payload in again.
    rerender({ initialData: { ...SEED }, args: {} })
    expect(result.current.items).toEqual(["a2", "b2"])
    expect(result.current.stale).toBe(false)
  })
})

describe("usePagedViewData — a failed page 0 over the rows on screen, from its first attempt", () => {
  it("an invalidation's refetch: the error is up while the client still retries", async () => {
    const { result } = setup({ initialData: SEED, args: {} })
    callTool.mockRejectedValue(new Error("engine down"))
    // Not awaited: the invalidation settles only once the retries ran out.
    act(() => void queryClient.invalidateQueries({ queryKey: ["test:paged"] }))

    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(callTool).toHaveBeenCalledTimes(1)
    // The rows are this filter's last good answer — unconfirmed, not stale.
    expect(result.current.firstPage).toBe(SEED)
    expect(result.current.stale).toBe(false)
    expect(result.current.refreshing).toBe(true)
  })

  it("a changed filter: the same report over the kept rows, which are the previous result", async () => {
    const { result, rerender } = setup({ initialData: SEED, args: {} })
    callTool.mockRejectedValue(new Error("engine down"))
    rerender({ initialData: null, args: SEARCH })

    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(page0Calls(SEARCH)).toHaveLength(1)
    expect(result.current.firstPage).toBe(SEED)
    expect(result.current.stale).toBe(true)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.loading).toBe(false)
  })

  it("no rows on screen: the guard keeps loading through the retries — no error yet", async () => {
    callTool.mockRejectedValue(new Error("engine down"))
    const { result } = setup({ initialData: null, args: {} })

    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(1))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(result.current.firstPage).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)
  })

  it("its Retry during the client's backoff is a new read at once — not a wait for the running chain", async () => {
    callTool.mockRejectedValueOnce(new Error("engine down"))
    const { rerender } = render(<ListFooter initialData={SEED} args={{}} />, { wrapper })
    rerender(<ListFooter initialData={null} args={SEARCH} />)

    // The search's first attempt failed; the client's own next one is ~1 s away.
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("engine down")
    expect(screen.getByRole("status").textContent).toBe("Updating…")
    expect(page0Calls(SEARCH)).toHaveLength(1)

    callTool.mockResolvedValueOnce(answer({ items: ["x1"], total: 1 }))
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    // Well inside the backoff: a Retry that joined the running chain sends nothing yet.
    await waitFor(() => expect(page0Calls(SEARCH)).toHaveLength(2), { timeout: 400 })
    expect(await screen.findByText("Showing 1 of 1 items")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
