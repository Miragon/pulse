// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { ToolResultError } from "../protocol/tool-result.js"
import { spyHost } from "./tool-host.test-support.js"
import { createViewQueryClient, useToolMutation, useToolQuery, useViewData } from "./tool-query.js"

/** The view's data layer over the view host: keys, decoding, invalidation and the seeded feed (#341). */

interface Answer {
  value: string
}

const KEY = ["test:view", "prod"]
const ARGS = { id: "x-1", engine: "prod" }
const CACHE_KEY = [...KEY, ARGS]

const callTool = vi.fn()
const host = spyHost("test_view_data", callTool)
const wrapper = host.wrapper

const answer = (value: string) => ({ structuredContent: { value } })

function setup(seed: Answer | null, enabled = true) {
  return renderHook(
    ({ seed: current, enabled: on }: { seed: Answer | null; enabled: boolean }) =>
      useViewData<Answer>(current, KEY, "test_view_data", ARGS, on),
    { wrapper, initialProps: { seed, enabled } },
  )
}

beforeEach(() => {
  callTool.mockReset()
  host.reset()
})

afterEach(async () => {
  cleanup()
  await host.dispose()
})

describe("createViewQueryClient", () => {
  it("keeps reads fresh for 30 s, never refetches on focus and keeps TanStack's retries", () => {
    const queries = createViewQueryClient().getDefaultOptions().queries
    expect(queries).toEqual({ staleTime: 30_000, refetchOnWindowFocus: false })
  })
})

describe("useToolQuery", () => {
  it("caches under [...key, args] and decodes structuredContent first", async () => {
    callTool.mockResolvedValue(answer("fetched"))
    const { result } = renderHook(() => useToolQuery<Answer>(KEY, "test_view_data", ARGS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.data).toEqual({ value: "fetched" }))
    expect(callTool).toHaveBeenCalledWith("test_view_data", ARGS)
    expect(host.client().getQueryData(CACHE_KEY)).toEqual({ value: "fetched" })
  })

  it("fails on the tool's own isError answer, with the tool's text", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "no such id" }] })
    const { result } = renderHook(() => useToolQuery<Answer>(KEY, "test_view_data", ARGS), {
      wrapper,
    })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ToolResultError))
    expect(result.current.error?.message).toBe("no such id")
  })

  it("passes TanStack's options through (enabled)", async () => {
    renderHook(() => useToolQuery<Answer>(KEY, "test_view_data", ARGS, { enabled: false }), {
      wrapper,
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe("useToolMutation", () => {
  it("calls the tool, decodes its answer and invalidates every named prefix", async () => {
    callTool.mockResolvedValue(answer("v1"))
    const reader = renderHook(() => useToolQuery<Answer>(KEY, "test_view_data", ARGS), {
      wrapper,
    })
    await waitFor(() => expect(reader.result.current.data).toEqual({ value: "v1" }))

    callTool.mockResolvedValue(answer("v2"))
    const { result } = renderHook(
      () =>
        useToolMutation<Answer, { value: string }>("test_view_data", {
          invalidateKeys: [["test:view"]],
        }),
      { wrapper },
    )
    let saved: Answer | undefined
    await act(async () => {
      saved = await result.current.mutateAsync({ value: "v2" })
    })
    expect(saved).toEqual({ value: "v2" })
    expect(callTool).toHaveBeenCalledWith("test_view_data", { value: "v2" })
    // The reader under the invalidated prefix re-read the feed.
    await waitFor(() => expect(reader.result.current.data).toEqual({ value: "v2" }))
  })

  it("rejects on an isError answer and invalidates nothing", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "denied" }] })
    const invalidate = vi.spyOn(host.client(), "invalidateQueries")
    const { result } = renderHook(
      () => useToolMutation("test_view_data", { invalidateKeys: [["test:view"]] }),
      { wrapper },
    )
    await expect(result.current.mutateAsync({})).rejects.toThrow("denied")
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe("useViewData (always seeded)", () => {
  it("serves the seed from the cache without refetching it on mount", async () => {
    const seed = { value: "seed" }
    const { result } = setup(seed)
    expect(result.current.data).toBe(seed)
    expect(host.client().getQueryData(CACHE_KEY)).toBe(seed)
    // A fresh seed is the feed's current answer: the show tool just read it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.isFetching).toBe(false)
  })

  it("refetches a seeded view once a write invalidates it", async () => {
    callTool.mockResolvedValue(answer("after write"))
    const { result } = setup({ value: "seed" })
    await act(() => host.client().invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.data).toEqual({ value: "after write" }))
    expect(callTool).toHaveBeenCalledWith("test_view_data", ARGS)
  })

  it("self-fetches without a seed, like the plain tool query", async () => {
    callTool.mockResolvedValue(answer("fetched"))
    const { result } = setup(null)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data).toEqual({ value: "fetched" }))
  })

  it("stays idle while not enabled, but the seed still renders", async () => {
    const { result } = setup({ value: "seed" }, false)
    await act(() => host.client().invalidateQueries({ queryKey: ["test:view"] }))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.data).toEqual({ value: "seed" })
  })

  it("never rolls a refetched answer back when the view remounts with its old payload", async () => {
    callTool.mockResolvedValue(answer("after write"))
    const first = setup({ value: "remounted payload" })
    await act(() => host.client().invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(first.result.current.data).toEqual({ value: "after write" }))
    first.unmount()

    const { result } = setup({ value: "remounted payload" })
    expect(result.current.data).toEqual({ value: "after write" })
  })

  it("lets a payload it never seeded win over the cache: a new delivery", () => {
    host.client().setQueryData(CACHE_KEY, { value: "cached" })
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
    await act(() => host.client().invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.data).toEqual({ value: "after write" }))
    // Same content, new identity: the host re-emitted what it delivered.
    rerender({ seed: { value: "payload" }, enabled: true })
    expect(result.current.data).toEqual({ value: "after write" })
  })

  it("re-seeds an emptied cache with a payload it seeded before: no fetch on mount", async () => {
    const first = setup({ value: "seeded twice" })
    first.unmount()
    host.client().clear()

    const { result } = setup({ value: "seeded twice" })
    expect(host.client().getQueryData(CACHE_KEY)).toEqual({ value: "seeded twice" })
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
    expect(result.current.data).toEqual({ value: "seeded twice" })
  })

  it("seeds the new key when the scope changes under the same payload", async () => {
    const seed = { value: "same object" }
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useViewData<Answer>(seed, KEY, "test_view_data", { id, engine: "prod" }, true),
      { wrapper, initialProps: { id: "x-1" } },
    )
    rerender({ id: "x-2" })
    expect(host.client().getQueryData([...KEY, { id: "x-2", engine: "prod" }])).toBe(seed)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(callTool).not.toHaveBeenCalled()
  })

  it("takes an equal seed object per render without looping", () => {
    const { result } = renderHook(
      () => useViewData<Answer>({ value: "literal" }, KEY, "test_view_data", ARGS, true),
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

  it("keeps the shown data next to a failed refetch, and refetch() retries it", async () => {
    callTool.mockRejectedValueOnce(new Error("engine down"))
    const { result } = setup({ value: "seed" })
    await act(() => host.client().invalidateQueries({ queryKey: ["test:view"] }))
    await waitFor(() => expect(result.current.error?.message).toBe("engine down"))
    expect(result.current.data).toEqual({ value: "seed" })

    callTool.mockResolvedValueOnce(answer("recovered"))
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toEqual({ value: "recovered" }))
    expect(result.current.error).toBeNull()
  })

  it("refetch() without data is a new read at once, never a wait for the retry backoff", async () => {
    // TanStack restarts an in-flight fetch only over data; without, a plain refetch joins the backoff chain.
    host.withRetries()
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

  it("refetch() cancels only its OWN chain: a sibling's read in flight still lands", async () => {
    host.withRetries()
    // Same key prefix, a superset of the args: what a prefix match would also hit.
    const SIBLING_ARGS = { ...ARGS, firstResult: 0 }
    let landSibling!: (value: unknown) => void
    callTool.mockImplementation((_tool: string, sent: unknown) =>
      JSON.stringify(sent) === JSON.stringify(SIBLING_ARGS)
        ? new Promise((resolve) => (landSibling = resolve))
        : Promise.reject(new Error("engine down")),
    )
    const sibling = renderHook(
      () => useViewData<Answer>(null, KEY, "test_view_data", SIBLING_ARGS, true),
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
