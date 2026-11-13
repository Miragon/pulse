// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DisplayModeProvider, WidgetShell, useHostDisplayMode } from "./widget-shell.js"

afterEach(cleanup)

const classesOf = (element: Element) => element.className.split(" ")
/** The element a test child sits in: the shell's content, or the shell itself without one. */
const holderOf = (testId: string) => screen.getByTestId(testId).parentElement!
const shellOf = (element: Element) => element.closest('[data-slot="widget-shell"]')!

describe("WidgetShell", () => {
  it("caps the width inline and lets a fullscreen host have it all", () => {
    render(
      <>
        <WidgetShell>
          <p data-testid="inline">a</p>
        </WidgetShell>
        <DisplayModeProvider mode="fullscreen">
          <WidgetShell>
            <p data-testid="fullscreen">b</p>
          </WidgetShell>
        </DisplayModeProvider>
      </>,
    )

    expect(shellOf(holderOf("inline")).className).toContain("max-w-7xl")
    expect(shellOf(holderOf("fullscreen")).className).toContain("max-w-full")
  })

  it("pads nothing itself: its header runs from edge to edge, its content sits in the gutter, 12 px above and below, its sections the section gap apart", () => {
    render(
      <WidgetShell header={<header data-testid="bar">bar</header>}>
        <p data-testid="content">a</p>
      </WidgetShell>,
    )
    const shell = shellOf(holderOf("content"))
    // The bar sits on the shell itself, before the content: no gutter around it.
    expect(holderOf("bar")).toBe(shell)
    expect(shell.firstElementChild).toBe(screen.getByTestId("bar"))
    expect(classesOf(shell).filter((c) => /^(?:sm:)?p[xy]?-/.test(c))).toEqual([])
    const content = holderOf("content")
    expect(content.getAttribute("data-slot")).toBe("widget-content")
    expect(classesOf(content)).toEqual(
      expect.arrayContaining(["px-gutter", "py-3", "gap-section", "min-w-0"]),
    )
    expect(classesOf(content).filter((c) => /^p-/.test(c) || /^gap-\d/.test(c))).toEqual([])
    expect(shell.parentElement!.className).toContain("min-w-0")
    // No inset variable for a bar: the bar takes the gutter itself.
    expect(document.body.innerHTML).not.toContain("bar-inset")
  })

  it("draws no empty content under a header alone", () => {
    render(<WidgetShell header={<header data-testid="bar">bar</header>} />)
    expect(document.querySelector('[data-slot="widget-content"]')).toBeNull()
  })

  it("nested under another shell's content keeps only the section stack", () => {
    render(
      <WidgetShell>
        <WidgetShell className="extra" header={<header data-testid="inner-bar">bar</header>}>
          <p data-testid="inner">c</p>
        </WidgetShell>
      </WidgetShell>,
    )

    const inner = holderOf("inner")
    expect(holderOf("inner-bar")).toBe(inner)
    expect(classesOf(inner).sort()).toEqual(
      ["extra", "flex", "flex-col", "gap-section", "min-w-0"].sort(),
    )
    // Exactly one card surface and one gutter: the outer shell's.
    expect(document.querySelectorAll(".bg-card")).toHaveLength(1)
    expect(document.querySelectorAll(".px-gutter")).toHaveLength(1)
  })

  it("flush: its children are views of their own, each with its bars from edge to edge and its content in the gutter", () => {
    render(
      <WidgetShell flush header={<nav data-testid="nav">nav</nav>}>
        <WidgetShell className="route" header={<header data-testid="route-bar">bar</header>}>
          <p data-testid="route">d</p>
        </WidgetShell>
      </WidgetShell>,
    )
    const outer = shellOf(holderOf("nav"))
    const flush = outer.querySelector('[data-slot="widget-content"]')!
    expect(classesOf(flush).sort()).toEqual(["flex", "flex-col", "min-w-0"].sort())
    const route = holderOf("route-bar")
    expect(route.parentElement).toBe(flush)
    expect(classesOf(route)).toEqual(expect.arrayContaining(["route", "flex", "flex-col"]))
    expect(classesOf(holderOf("route"))).toEqual(
      expect.arrayContaining(["px-gutter", "py-3", "gap-section"]),
    )
    expect(document.querySelectorAll(".bg-card")).toHaveLength(1)
  })
})

describe("useHostDisplayMode", () => {
  function Mode() {
    return <span data-testid="mode">{useHostDisplayMode()}</span>
  }

  it('defaults to "inline" outside a host and reports the provided mode inside one', () => {
    render(
      <>
        <Mode />
        <DisplayModeProvider mode="pip">
          <Mode />
        </DisplayModeProvider>
      </>,
    )

    const [outside, inside] = screen.getAllByTestId("mode")
    expect(outside.textContent).toBe("inline")
    expect(inside.textContent).toBe("pip")
  })
})
