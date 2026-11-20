// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SPLIT, SplitPane } from "../src/screens/split-pane.js"
import { useWide, WIDE } from "../src/screens/use-wide.js"

/**
 * The instance screen's split between its diagram and its details: a separator the reader moves
 * by keyboard, mouse or touch (WCAG 2.1.1), the diagram's share kept in this browser; and the width
 * from which a screen splits and fills the window.
 */

const KEY = "pulse.web.instance.diagramShare"

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderSplit = () =>
  render(
    <SplitPane
      top={<p>diagram</p>}
      bottom={<p>details</p>}
      label="Resize diagram and details"
      storageKey={KEY}
    />,
  )

const separator = () => screen.getByRole("separator", { name: "Resize diagram and details" })
const share = () => Number(separator().getAttribute("aria-valuenow"))
const rows = () =>
  document.querySelector<HTMLElement>("[data-slot=split-pane]")?.style.gridTemplateRows

describe("the split of the instance screen", () => {
  it("starts in the middle, the separator saying the diagram's share within its bounds", () => {
    renderSplit()
    expect(share()).toBe(50)
    expect(separator().getAttribute("aria-valuemin")).toBe("20")
    expect(separator().getAttribute("aria-valuemax")).toBe("80")
    expect(separator().getAttribute("aria-orientation")).toBe("horizontal")
    expect(separator().tabIndex).toBe(0)
    expect(rows()).toBe("minmax(0, 0.5fr) auto minmax(0, 0.5fr)")
  })

  it("moves by the arrows, to its ends by Home and End, and keeps the share in this browser", () => {
    renderSplit()
    fireEvent.keyDown(separator(), { key: "ArrowDown" })
    expect(share()).toBe(55)
    fireEvent.keyDown(separator(), { key: "ArrowUp" })
    fireEvent.keyDown(separator(), { key: "ArrowUp" })
    expect(share()).toBe(45)
    fireEvent.keyDown(separator(), { key: "Home" })
    expect(share()).toBe(SPLIT.min * 100)
    fireEvent.keyDown(separator(), { key: "ArrowUp" })
    expect(share()).toBe(20)
    fireEvent.keyDown(separator(), { key: "End" })
    expect(share()).toBe(80)
    fireEvent.keyDown(separator(), { key: "Tab" })
    expect(share()).toBe(80)
    expect(window.localStorage.getItem(KEY)).toBe("0.8")
    cleanup()
    renderSplit()
    expect(share()).toBe(80)
  })

  it("follows a drag of the separator, and keeps where it was let go", () => {
    renderSplit()
    const frame = document.querySelector<HTMLElement>("[data-slot=split-pane]")!
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 400,
    } as DOMRect)
    const handle = separator()
    handle.setPointerCapture = vi.fn()
    handle.releasePointerCapture = vi.fn()
    // A move before the drag starts moves nothing.
    fireEvent.pointerMove(handle, { clientY: 300 })
    expect(share()).toBe(50)
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 300 })
    expect(handle.getAttribute("data-dragging")).toBe("true")
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 260 })
    expect(share()).toBe(40)
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 900 })
    expect(share()).toBe(80)
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 900 })
    expect(handle.hasAttribute("data-dragging")).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe("0.8")
    fireEvent.pointerDown(handle, { pointerId: 2, clientY: 300 })
    fireEvent.pointerCancel(handle, { pointerId: 2 })
    expect(handle.hasAttribute("data-dragging")).toBe(false)
  })

  it("moves nothing while the frame has no height", () => {
    renderSplit()
    const frame = document.querySelector<HTMLElement>("[data-slot=split-pane]")!
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ top: 0, height: 0 } as DOMRect)
    const handle = separator()
    handle.setPointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 200 })
    expect(share()).toBe(50)
  })

  it("starts in the middle where the browser keeps nothing it can read, or refuses its storage", () => {
    window.localStorage.setItem(KEY, "not a share")
    renderSplit()
    expect(share()).toBe(50)
    cleanup()
    window.localStorage.setItem(KEY, "0.95")
    renderSplit()
    expect(share()).toBe(80)
    cleanup()
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage is off")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage is off")
    })
    renderSplit()
    expect(share()).toBe(50)
    fireEvent.keyDown(separator(), { key: "ArrowDown" })
    expect(share()).toBe(55)
  })
})

function Width() {
  return <p>{useWide() ? "wide" : "narrow"}</p>
}

describe("the width from which a screen splits", () => {
  it("is 64rem, followed as the window changes, and wide where the browser cannot say", () => {
    let matches = false
    const listeners = new Set<() => void>()
    const media = {
      get matches() {
        return matches
      },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
    const matchMedia = vi.fn(() => media)
    vi.stubGlobal("matchMedia", matchMedia)
    const { unmount } = render(<Width />)
    expect(screen.getByText("narrow")).toBeTruthy()
    expect(matchMedia).toHaveBeenCalledWith(WIDE)
    matches = true
    act(() => {
      for (const listener of listeners) listener()
    })
    expect(screen.getByText("wide")).toBeTruthy()
    unmount()
    expect(listeners.size).toBe(0)
    vi.stubGlobal("matchMedia", undefined)
    render(<Width />)
    expect(screen.getByText("wide")).toBeTruthy()
    vi.unstubAllGlobals()
  })
})
