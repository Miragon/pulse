// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook } from "@testing-library/react"
import { useDebouncedValue } from "./use-debounced-value.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useDebouncedValue", () => {
  it("passes a value on only once it held still for the delay", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 200), {
      initialProps: { value: "a" },
    })
    expect(result.current).toBe("a")
    rerender({ value: "ab" })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    rerender({ value: "abc" })
    act(() => {
      vi.advanceTimersByTime(150)
    })
    // Every change restarts the timer: "ab" never comes through.
    expect(result.current).toBe("a")
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(result.current).toBe("abc")
  })

  it("waits 300 ms by default", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 1 },
    })
    rerender({ value: 2 })
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(result.current).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe(2)
  })
})
