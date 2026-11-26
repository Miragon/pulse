// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react"
import type { InstanceRowData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { describe, expect, it } from "vitest"
import { useDiagramDecorations, useInstanceRows } from "./process-hooks.js"

const row = (id: string): InstanceRowData => ({ id, state: "running", hasIncident: false })

describe("the decorations of a process's diagram", () => {
  it("give the calling process's call activity its counts, its incident outline and its target", () => {
    const { result } = renderHook(() => useDiagramDecorations(WORLD_SCREENS.callingProcess))
    const [decoration] = result.current

    expect(result.current).toHaveLength(1)
    expect(decoration?.elementId).toBe(WORLD_SCREENS.callingProcess.calls[0]?.elementId)
    expect(decoration?.counts.map(({ kind }) => kind)).toEqual([
      "incidentsInCalledInstances",
      "running",
    ])
    expect(decoration?.incident).toBe(false)
    expect(decoration?.call).toEqual(WORLD_SCREENS.callingProcess.calls[0])
  })

  it("keep their answer while the screen is the same", () => {
    const { result, rerender } = renderHook(() => useDiagramDecorations(WORLD_SCREENS.process))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe("the rows of an instance list read page by page", () => {
  it("put each later page after the rows before it, without a row shown already", () => {
    const pages = [[row("a"), row("b")], [row("b"), row("c")], [row("d")]]
    const { result } = renderHook(() => useInstanceRows(pages))

    expect(result.current.map(({ id }) => id)).toEqual(["a", "b", "c", "d"])
  })

  it("show no row before a page was read", () => {
    const { result } = renderHook(() => useInstanceRows<InstanceRowData>([]))
    expect(result.current).toEqual([])
  })
})
