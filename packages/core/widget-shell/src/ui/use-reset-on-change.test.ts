// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { useEffect, useState } from "react"
import { cleanup, renderHook } from "@testing-library/react"
import { useResetOnChange } from "./use-reset-on-change.js"

afterEach(() => cleanup())

describe("useResetOnChange", () => {
  it("does not reset on the first render", () => {
    const reset = vi.fn()
    renderHook(({ k }) => useResetOnChange(k, reset), { initialProps: { k: "a" } })
    expect(reset).not.toHaveBeenCalled()
  })

  it("resets once per identity change, and not at all while the key holds", () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ k }) => useResetOnChange(k, reset), {
      initialProps: { k: "a" },
    })

    rerender({ k: "a" })
    expect(reset).not.toHaveBeenCalled()

    rerender({ k: "b" })
    expect(reset).toHaveBeenCalledTimes(1)

    // The new key is now the baseline — re-rendering on it must not reset again.
    rerender({ k: "b" })
    expect(reset).toHaveBeenCalledTimes(1)

    rerender({ k: "a" })
    expect(reset).toHaveBeenCalledTimes(2)
  })

  it("keys on identity, not equality — an equal-valued new object still resets", () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ k }) => useResetOnChange(k, reset), {
      initialProps: { k: { total: 1 } },
    })

    rerender({ k: { total: 1 } })
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it("commits the reset value directly — no render showing the stale state first", () => {
    const committed = vi.fn()
    const { result, rerender } = renderHook(
      ({ k }) => {
        const [shadow, setShadow] = useState("optimistic")
        useResetOnChange(k, () => setShadow(""))
        useEffect(() => committed(shadow))
        return shadow
      },
      { initialProps: { k: "a" } },
    )
    expect(result.current).toBe("optimistic")

    rerender({ k: "b" })
    expect(result.current).toBe("")
    // Two commits: an effect-driven reset would add a third, the flash this hook avoids.
    expect(committed.mock.calls).toEqual([["optimistic"], [""]])
  })

  it("treats NaN as unchanged (Object.is), so a NaN key cannot loop the render", () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ k }) => useResetOnChange(k, reset), {
      initialProps: { k: NaN },
    })

    rerender({ k: NaN })
    expect(reset).not.toHaveBeenCalled()
  })
})
