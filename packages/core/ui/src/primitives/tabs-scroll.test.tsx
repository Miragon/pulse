// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Tabs, TabsList, TabsTrigger } from "./tabs.js"

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

/**
 * A 320 px tab list whose tabs need 400 px, each tab where `boxes` puts it in the list's content
 * by its text and moved as far as the list scrolls, before the list mounts: a selected tab is
 * measured as it is drawn.
 */
function stubLineGeometry(boxes: Record<string, [number, number]>): () => void {
  const isList = (el: Element) => el.getAttribute("role") === "tablist"
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (isList(this)) return { left: 0, right: 320, top: 0, bottom: 36 } as DOMRect
      const [left, right] = boxes[this.textContent ?? ""] ?? [0, 0]
      const shift = this.closest('[role="tablist"]')?.scrollLeft ?? 0
      return { left: left - shift, right: right - shift, top: 0, bottom: 36 } as DOMRect
    })
  const sizes = { scrollWidth: 400, clientWidth: 320 }
  const own = Object.fromEntries(
    Object.keys(sizes).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
    ]),
  )
  for (const [key, size] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get(this: HTMLElement) {
        return isList(this) ? size : 0
      },
    })
  }
  return () => {
    rect.mockRestore()
    for (const [key, descriptor] of Object.entries(own)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
    }
  }
}

function lineTabs() {
  return render(
    <Tabs defaultValue="incidents">
      <TabsList variant="line">
        <TabsTrigger value="incidents">Incidents</TabsTrigger>
        <TabsTrigger value="jobs">Jobs</TabsTrigger>
      </TabsList>
    </Tabs>,
  )
}

describe("Tabs: a line list in a narrow bar stays one line and scrolls inside it", () => {
  it("the line list stays one line and scrolls inside its bar, its scrollbar hidden, over the bar's rule so the open tab's bar covers it", () => {
    lineTabs()
    const list = screen.getByRole("tablist")
    expect(classes(list)).toEqual(
      expect.arrayContaining([
        "overflow-x-auto",
        "overflow-y-hidden",
        "[scrollbar-width:none]",
        "-mb-px",
        "min-w-0",
        "flex-1",
        // Alone in its bar, the list's own sides lie inside the scroll: the tabs reach both edges.
        "pl-2",
        "pr-gutter",
      ]),
    )
    expect(classes(list)).not.toContain("flex-wrap")
    // The list reaches over the rule, so no tab does: in a scroll container it would be cut.
    for (const tab of screen.getAllByRole("tab")) expect(classes(tab)).not.toContain("-mb-px")
  })

  it("a tab that takes the focus scrolls the list just enough to show it whole, the page never", async () => {
    const onFocus = vi.fn()
    render(
      <Tabs defaultValue="a">
        <TabsList variant="line">
          <TabsTrigger value="a">Tasks</TabsTrigger>
          <TabsTrigger value="b" onFocus={onFocus}>
            History
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = screen.getByRole("tablist")
    const [first, second] = screen.getAllByRole("tab")
    // A 320 px list whose second tab is cut at its right edge by 29 px.
    Object.defineProperties(list, {
      scrollWidth: { configurable: true, value: 349 },
      clientWidth: { configurable: true, value: 320 },
    })
    // Where each lies in the list's content; a tab moves left as far as the list scrolls.
    const at = (el: Element, left: number, width: number) => {
      el.getBoundingClientRect = () => {
        const shown = el === list ? left : left - list.scrollLeft
        return { left: shown, right: shown + width, top: 0, bottom: 36 } as DOMRect
      }
    }
    at(list, 0, 320)
    at(second, 290, 59)
    first?.focus()
    fireEvent.keyDown(first, { key: "ArrowRight" })
    // Radix moves the focus in a task of its own.
    await waitFor(() => expect(document.activeElement).toBe(second))
    expect(list.scrollLeft).toBe(29)
    expect(onFocus).toHaveBeenCalledTimes(1)

    // Back to a tab cut at the left edge by 20 px: the list scrolls back just as far.
    at(first, 9, 60)
    first?.focus()
    expect(list.scrollLeft).toBe(9)
  })

  it("the selected tab scrolls into view once drawn and whenever the selection changes, never back on a re-render", async () => {
    // A 320 px list of 400 px of tabs: Tasks at its start, History cut at its end by 29 px.
    const boxes: Record<string, [number, number]> = { Tasks: [0, 80], History: [290, 349] }
    const restore = stubLineGeometry(boxes)
    try {
      const tabs = (value: string) => (
        <Tabs value={value}>
          <TabsList variant="line">
            <TabsTrigger value="a">Tasks</TabsTrigger>
            <TabsTrigger value="b">History</TabsTrigger>
          </TabsList>
        </Tabs>
      )
      const { rerender } = render(tabs("b"))
      const list = screen.getByRole("tablist")
      expect(list.scrollLeft).toBe(29)
      expect(document.activeElement).toBe(document.body)

      // The reader swipes back; a re-render keeps the selection and leaves the list where it is.
      list.scrollLeft = 100
      rerender(tabs("b"))
      expect(list.scrollLeft).toBe(100)

      // The host selects Tasks, out of view at the start: the list scrolls back to it.
      rerender(tabs("a"))
      await waitFor(() => expect(list.scrollLeft).toBe(0))
    } finally {
      restore()
    }
  })

  it("a caller's ref reaches the list, and a new one on each render never scrolls it back", () => {
    const boxes: Record<string, [number, number]> = { Tasks: [0, 80], History: [290, 349] }
    const restore = stubLineGeometry(boxes)
    try {
      const seen: (HTMLDivElement | null)[] = []
      // An inline callback: a new ref on every render, as a caller writing `ref={(el) => …}` passes.
      const tabs = () => (
        <Tabs value="b">
          <TabsList variant="line" ref={(el) => void seen.push(el)}>
            <TabsTrigger value="a">Tasks</TabsTrigger>
            <TabsTrigger value="b">History</TabsTrigger>
          </TabsList>
        </Tabs>
      )
      const { rerender, unmount } = render(tabs())
      const list = screen.getByRole("tablist")
      expect(seen).toEqual([list])
      expect(list.scrollLeft).toBe(29)

      // The reader swipes back to the start, the selected tab cut again: re-renders leave it so.
      list.scrollLeft = 0
      rerender(tabs())
      rerender(tabs())
      expect(list.scrollLeft).toBe(0)
      // React hands each new ref the list, the one before it null, as for any element.
      expect(seen).toEqual([list, null, list, null, list])

      unmount()
      expect(seen.at(-1)).toBeNull()
    } finally {
      restore()
    }
  })

  it("vertical line tabs keep the list alone, its rule at its side", () => {
    render(
      <Tabs defaultValue="a" orientation="vertical">
        <TabsList variant="line">
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const list = screen.getByRole("tablist")
    expect(list.parentElement?.getAttribute("data-slot")).toBe("tabs")
    expect(classes(list)).toEqual(
      expect.arrayContaining(["group-data-[orientation=vertical]/tabs:border-r"]),
    )
  })
})
