// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { AppQueryProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { useViewData } from "@miragon/mcp-toolkit-ui/hooks"

/** The seeded feed every standalone widget relies on (#341); `useDetailView` and `usePagedViewData` build on it. */

interface Answer {
  value: string
}

const KEY = ["test:view", "prod"]
const ARGS = { id: "x-1", engine: "prod" }
const CACHE_KEY = [...KEY, ARGS]

const callTool = vi.fn()

function wrapper({ children }: { children: ReactNode }) {
  return <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
}

const answer = (value: string) => ({ structuredContent: { value } })

const SEED = { initialDataMode: "seed" } as const

function setup(seed: Answer | null, enabled = true) {
  return renderHook(
    ({ seed: current, enabled: on }: { seed: Answer | null; enabled: boolean }) =>
      useViewData<Answer>(current, KEY, "test_view_data", ARGS, on, SEED),
    { wrapper, initialProps: { seed, enabled } },
  )
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

describe("useViewData in seed mode", () => {
  it("serves the seed from the cache without refetching it on mount", async () => {
    const seed = { value: "seed" }
    const { result } = setup(seed)
    expect(result.current.data).toBe(seed)
    expect(queryClient.getQueryData(CACHE_KEY)).toBe(seed)
    // A fresh seed is the feed's current answer — the show tool just read it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.isFetching).toBe(false)
  })

  it("refetches a seeded view once a write invalidates it", async () => {
    callTool.mockResolvedValue(answer("after write"))
    const { result } = setup({ value: "seed" })
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.data).toEqual({ value: "after write" }))
    expect(callTool).toHaveBeenCalledWith("test_view_data", ARGS)
  })

  it("self-fetches without a seed, like the plain tool query", async () => {
    callTool.mockResolvedValue(answer("fetched"))
    const { result } = setup(null)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data).toEqual({ value: "fetched" }))
  })

  it("stays idle while not enabled — the seed still renders", async () => {
    const { result } = setup({ value: "seed" }, false)
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:view"] }))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.data).toEqual({ value: "seed" })
  })

  it("never rolls a refetched answer back when the view remounts with its old payload", async () => {
    callTool.mockResolvedValue(answer("after write"))
    const first = setup({ value: "remounted payload" })
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(first.result.current.data).toEqual({ value: "after write" }))
    first.unmount()

    const { result } = setup({ value: "remounted payload" })
    expect(result.current.data).toEqual({ value: "after write" })
  })

  it("lets a payload it never seeded win over the cache — a new delivery", () => {
    queryClient.setQueryData(CACHE_KEY, { value: "cached" })
    const { result } = setup({ value: "never seeded before" })
    expect(result.current.data).toEqual({ value: "never seeded before" })
  })

  it("takes a NEW payload the host delivers into the mounted view", () => {
    const { result, rerender } = setup({ value: "first" })
    rerender({ seed: { value: "second" }, enabled: true })
    expect(result.current.data).toEqual({ value: "second" })
  })

  it("ignores a re-emission of the same payload after a refetch", async () => {
    callTool.mockResolvedValue(answer("after write"))
    const { result, rerender } = setup({ value: "payload" })
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.data).toEqual({ value: "after write" }))
    // Same content, new identity — the host re-emitted what it delivered.
    rerender({ seed: { value: "payload" }, enabled: true })
    expect(result.current.data).toEqual({ value: "after write" })
  })

  it("re-seeds an emptied cache with a payload it seeded before — no fetch on mount", async () => {
    const first = setup({ value: "seeded twice" })
    first.unmount()
    queryClient.clear()

    const { result } = setup({ value: "seeded twice" })
    expect(queryClient.getQueryData(CACHE_KEY)).toEqual({ value: "seeded twice" })
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.data).toEqual({ value: "seeded twice" })
  })

  it("seeds the new key when the scope changes under the same payload", async () => {
    const seed = { value: "same object" }
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useViewData<Answer>(seed, KEY, "test_view_data", { id, engine: "prod" }, true, SEED),
      { wrapper, initialProps: { id: "x-1" } },
    )
    rerender({ id: "x-2" })
    expect(queryClient.getQueryData([...KEY, { id: "x-2", engine: "prod" }])).toBe(seed)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
  })

  it("takes an equal seed object per render without looping", () => {
    const { result } = renderHook(
      () => useViewData<Answer>({ value: "literal" }, KEY, "test_view_data", ARGS, true, SEED),
      { wrapper },
    )
    expect(result.current.data).toEqual({ value: "literal" })
  })

  it("treats a payload it cannot compare as new", () => {
    const { result, rerender } = setup({ value: "first" })
    const cyclic = { value: "cyclic" } as Answer & { self?: unknown }
    cyclic.self = cyclic
    rerender({ seed: cyclic, enabled: true })
    expect(result.current.data?.value).toBe("cyclic")
  })

  it("keeps the shown data next to a failed refetch — and refetch() retries it", async () => {
    callTool.mockRejectedValueOnce(new Error("engine down"))
    const { result } = setup({ value: "seed" })
    await act(() => queryClient.invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.data).toEqual({ value: "seed" })

    callTool.mockResolvedValueOnce(answer("recovered"))
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toEqual({ value: "recovered" }))
    expect(result.current.error).toBeNull()
  })

  it("refetch() without data is a new read at once — never a wait for the retry backoff", async () => {
    // TanStack restarts an in-flight fetch only over data; without, a plain refetch joins the backoff chain.
    queryClient.setDefaultOptions(toolkitDefaults)
    callTool.mockRejectedValueOnce(new Error("engine down"))
    const { result } = setup(null)
    await waitFor(() => expect(result.current.failureReason?.message).toBe("engine down"))
    expect(result.current.isFetching).toBe(true)

    callTool.mockResolvedValueOnce(answer("recovered"))
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toEqual({ value: "recovered" }), {
      timeout: 400,
    })
    expect(result.current.failureReason).toBeNull()
    // The cancelled chain sends nothing once its backoff ends.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)))
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("refetch() cancels only its OWN chain — a sibling's read in flight still lands", async () => {
    queryClient.setDefaultOptions(toolkitDefaults)
    // Same key prefix, a superset of the args: what a prefix match would also hit.
    const SIBLING_ARGS = { ...ARGS, firstResult: 0 }
    let landSibling!: (value: unknown) => void
    callTool.mockImplementation((_tool: string, sent: unknown) =>
      JSON.stringify(sent) === JSON.stringify(SIBLING_ARGS)
        ? new Promise((resolve) => (landSibling = resolve))
        : Promise.reject(new Error("engine down")),
    )
    const sibling = renderHook(
      () => useViewData<Answer>(null, KEY, "test_view_data", SIBLING_ARGS, true, SEED),
      { wrapper },
    )
    const { result } = setup(null)
    await waitFor(() => expect(result.current.failureReason?.message).toBe("engine down"))

    act(() => result.current.refetch())
    // The sibling's one read, then this key's first attempt and its new read.
    await waitFor(() => expect(callTool).toHaveBeenCalledTimes(3), { timeout: 400 })
    act(() => landSibling(answer("sibling")))
    await waitFor(() => expect(sibling.result.current.data).toEqual({ value: "sibling" }))
  })
})
