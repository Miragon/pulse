// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SearchField } from "../kit/search-field.js"
import { classesUnder, compiled, narrowRules } from "./bar-css.test-support.js"
import { Toolbar } from "./Toolbar.js"

/** Toolbar, the webview's filter bar: controls, then the summary and an aside at its end. */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("Toolbar", () => {
  it("is a 36 px bar, its rule below included, with the gutter at its sides, its controls 8 px apart", async () => {
    const { container } = render(
      <Toolbar>
        <button type="button">Running</button>
      </Toolbar>,
    )
    const bar = container.querySelector('[data-slot="toolbar"]')
    // 36 px with its rule, as the webview's filter bar: the minimum sits on the box that draws
    // the rule (border-box), and the row of controls is centred in it.
    expect(classes(bar)).toEqual(
      expect.arrayContaining([
        "@container/bar",
        "border-b",
        "min-h-toolbar",
        "flex-col",
        "justify-center",
      ]),
    )
    expect(classes(bar?.firstElementChild)).toEqual(
      expect.arrayContaining(["gap-2", "items-center", "px-gutter"]),
    )
    expect(classes(bar?.firstElementChild)).not.toContain("min-h-toolbar")
    const css = await compiled(["min-h-toolbar", "border-b"])
    expect(css).toContain(".min-h-toolbar { min-height: var(--toolbar-h); }")
    expect(css).toContain("border-bottom-width: 1px")
    expect(bar?.getAttribute("role")).toBeNull()
    expect(container.querySelector('[data-slot="toolbar-end"]')).toBeNull()
  })

  it("names its group when asked and puts the summary, quiet and tabular, and the aside at its end", () => {
    render(
      <Toolbar
        ariaLabel="Filter instances"
        summary="Showing 20 of 160"
        aside={<button type="button">Legend</button>}
      >
        <button type="button">Running</button>
      </Toolbar>,
    )
    const group = screen.getByRole("group", { name: "Filter instances" })
    const summary = screen.getByText("Showing 20 of 160")
    expect(classes(summary)).toEqual(
      expect.arrayContaining(["text-small", "text-muted-foreground", "tabular-nums"]),
    )
    expect(classes(summary.parentElement)).toContain("ml-auto")
    // The keyboard meets the controls first, then the aside.
    const buttons = Array.from(group.querySelectorAll("button")).map((b) => b.textContent)
    expect(buttons).toEqual(["Running", "Legend"])
  })

  it("under 760 px takes two lines with the summary first; a SearchField inside shrinks under 1180 px by the bar's width", async () => {
    const { container } = render(
      <Toolbar summary="Showing 20 of 160">
        <SearchField value="" onChange={vi.fn()} />
      </Toolbar>,
    )
    const css = await compiled(classesUnder(container.firstElementChild!))
    const narrow = narrowRules(css, "47.5rem")
    expect(narrow).toContain("flex-wrap: wrap")
    expect(narrow).toContain("order: -9999")
    expect(narrow).toContain("flex-basis: 100%")
    // The field queries the nearest container: the bar.
    expect(css).toContain("@container (width < 73.75rem)")
  })
})
