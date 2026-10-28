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
} from "@testing-library/react"
import { AppQueryProvider, LocaleProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { useViewData } from "@miragon/mcp-toolkit-ui/hooks"
import { useDetailView } from "./use-detail-view.js"
import { viewRefreshState } from "./view-refresh-state.js"

interface Detail {
  name: string
}

const callTool = vi.fn()
const answer = (name: string) => ({ structuredContent: { name } })

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
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
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
})

const invalidate = () => act(() => queryClient.invalidateQueries({ queryKey: ["test:detail"] }))

describe("useViewData in seed mode + viewRefreshState", () => {
  function setup(seed: Detail | null, ready = true) {
    return renderHook(
      () => {
        const view = useViewData<Detail>(
          seed,
          ["test:detail", "x"],
          "test_detail_data",
          { id: "x" },
          ready,
          { initialDataMode: "seed" },
        )
        return { ...view, ...viewRefreshState(view) }
      },
      { wrapper },
    )
  }

  it("loads while a ready view has nothing to show yet", async () => {
    callTool.mockResolvedValue(answer("fetched"))
    const { result } = setup(null)
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ name: "fetched" }))
    expect(result.current.loading).toBe(false)
  })

  it("is neither loading nor fetching before the scope is ready", () => {
    const { result } = setup(null, false)
    expect(result.current.loading).toBe(false)
    expect(callTool).not.toHaveBeenCalled()
  })

  it("reports a failed first load as error, not as a refresh error", async () => {
    callTool.mockRejectedValue(new Error("boom"))
    const { result } = setup(null)
    await waitFor(() => expect(result.current.error?.message).toBe("boom"))
    expect(result.current.loading).toBe(false)
    expect(result.current.refreshError).toBeNull()
  })

  it("flags a refetch in flight and a failed refetch next to the shown seed", async () => {
    let fail!: (error: Error) => void
    callTool.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const { result } = setup({ name: "seed" })
    expect(result.current.refreshing).toBe(false)
    // Not awaited and not in act: an open act scope would swallow the next test's updates.
    void queryClient.invalidateQueries({ queryKey: ["test:detail"] })
    await waitFor(() => expect(result.current.refreshing).toBe(true))
    act(() => fail(new Error("gone")))
    await waitFor(() => expect(result.current.refreshError?.message).toBe("gone"))
    expect(result.current.data).toEqual({ name: "seed" })
    expect(result.current.refreshing).toBe(false)
  })

  it("reports a failed refetch from its FIRST attempt — not after the client's retries", async () => {
    // TanStack retries 3× (~7 s) with `error` null; a view gating writes would keep offering them.
    queryClient.setDefaultOptions(toolkitDefaults)
    callTool.mockRejectedValue(new Error("gone"))
    const { result } = setup({ name: "seed" })
    void queryClient.invalidateQueries({ queryKey: ["test:detail"] })
    await waitFor(() => expect(result.current.refreshError?.message).toBe("gone"))
    // Still retrying: one attempt so far, the refetch in flight.
    expect(callTool).toHaveBeenCalledTimes(1)
    expect(result.current.refreshing).toBe(true)
    expect(result.current.data).toEqual({ name: "seed" })
  })
})

function Detail({ seed }: { seed: Detail | null }) {
  const { data, guard, notice, refreshError } = useDetailView<Detail>({
    initialData: seed,
    key: ["test:detail", "x"],
    tool: "test_detail_data",
    args: { id: "x" },
    ready: true,
    loadingText: "Loading…",
    emptyText: "Nothing",
    retryText: "Retry now",
    refreshErrorTitle: "Stale",
  })
  if (!data) return guard
  return (
    <div>
      {notice}
      <p>{data.name}</p>
      {!refreshError && <button type="button">Act</button>}
    </div>
  )
}

describe("useDetailView", () => {
  it("hands out the failed first load, so a section can hide when its tool is missing", async () => {
    callTool.mockRejectedValueOnce(new Error("Tool test_detail_data not found"))
    const { result } = renderHook(
      () =>
        useDetailView<Detail>({
          initialData: null,
          key: ["test:detail", "missing"],
          tool: "test_detail_data",
          args: {},
          ready: true,
          emptyText: "Nothing",
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.loadError).toBeInstanceOf(Error))
    expect(String(result.current.loadError)).toContain("not found")
  })

  it("offers a Retry on a failed load — never a dead end", async () => {
    callTool.mockRejectedValueOnce(new Error("[503 ProcessEngineException] down (engine prod)"))
    render(<Detail seed={null} />, { wrapper })
    // The error in words; the raw text only under "Details".
    expect(
      await screen.findByRole("heading", { name: "Engine prod is unreachable (HTTP 503)" }),
    ).toBeTruthy()
    expect(
      screen.getByText("[503 ProcessEngineException] down (engine prod)").closest("details"),
    ).toBeTruthy()

    callTool.mockResolvedValueOnce(answer("loaded"))
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }))
    expect(await screen.findByText("loaded")).toBeTruthy()
  })

  it("says so when a refetch fails over shown data, and retries from the notice", async () => {
    callTool.mockRejectedValueOnce(new Error("instance gone"))
    render(<Detail seed={{ name: "seed" }} />, { wrapper })
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()

    await invalidate()
    const notice = await screen.findByRole("alert")
    expect(notice.getAttribute("data-tone")).toBe("warning")
    expect(notice.getAttribute("data-variant")).toBe("inline")
    expect(notice.textContent).toContain("Stale")
    expect(notice.textContent).toContain(
      "Something went wrong. You're seeing the last loaded state.",
    )
    expect(screen.getByText("instance gone").closest("details")).toBeTruthy()
    expect(screen.getByText("seed")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Act" })).toBeNull()

    callTool.mockResolvedValueOnce(answer("fresh"))
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }))
    expect(await screen.findByText("fresh")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy()
  })

  function Bare() {
    const { data, guard, notice } = useDetailView<Detail>({
      initialData: { name: "seed" },
      key: ["test:detail", "bare"],
      tool: "test_detail_data",
      args: {},
      ready: true,
      loadingText: "Loading…",
      emptyText: "Nothing",
    })
    return data ? notice : guard
  }

  it("defaults its texts to English outside a locale", async () => {
    callTool.mockRejectedValueOnce(new Error("engine prod unreachable (ECONNREFUSED)"))
    render(<Bare />, { wrapper })
    await invalidate()
    expect(await screen.findByText("Couldn't refresh this view")).toBeTruthy()
    expect(
      screen.getByText("Engine prod is unreachable. You're seeing the last loaded state."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("defaults its texts to the active locale's kit labels (#339)", async () => {
    callTool.mockRejectedValueOnce(new Error("weg"))
    render(
      <LocaleProvider locale="de">
        <Bare />
      </LocaleProvider>,
      { wrapper },
    )
    await invalidate()
    expect(await screen.findByText("Die Ansicht konnte nicht aktualisiert werden")).toBeTruthy()
    expect(
      screen.getByText("Das hat nicht geklappt. Du siehst den zuletzt geladenen Stand."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy()
  })
})
