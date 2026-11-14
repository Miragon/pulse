// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Tabs, TabsList, TabsTrigger } from "./tabs.js"

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

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
    const at = (el: Element, left: number, width: number) => {
      el.getBoundingClientRect = () =>
        ({ left, right: left + width, top: 0, bottom: 36 }) as DOMRect
    }
    at(list, 0, 320)
    at(second, 290, 59)
    first?.focus()
    fireEvent.keyDown(first, { key: "ArrowRight" })
    // Radix moves the focus in a task of its own.
    await waitFor(() => expect(document.activeElement).toBe(second))
    expect(list.scrollLeft).toBe(29)
    expect(onFocus).toHaveBeenCalledTimes(1)

    // Back to a tab cut at the left edge: the list scrolls back just as far.
    at(first, -20, 60)
    first?.focus()
    expect(list.scrollLeft).toBe(9)
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
