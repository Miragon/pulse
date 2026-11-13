// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DisplayModeProvider, WidgetShell, useHostDisplayMode } from "./widget-shell.js"

afterEach(cleanup)

const frameOf = (testId: string) => screen.getByTestId(testId).parentElement!

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

    expect(frameOf("inline").className).toContain("max-w-7xl")
    expect(frameOf("fullscreen").className).toContain("max-w-full")
  })

  it("pads in the gutter and parts its sections by the section gap of the density roles (12 px, 16 px on touch), and lets its content shrink", () => {
    render(
      <WidgetShell>
        <p data-testid="content">a</p>
      </WidgetShell>,
    )
    const frame = frameOf("content").className.split(" ")
    expect(frame).toEqual(expect.arrayContaining(["p-gutter", "gap-section", "min-w-0"]))
    expect(frame.filter((c) => /^(?:sm:)?p-\d/.test(c) || /^gap-\d/.test(c))).toEqual([])
    expect(frameOf("content").parentElement!.className).toContain("min-w-0")
  })

  it("nested under another shell keeps only the section stack", () => {
    render(
      <WidgetShell>
        <WidgetShell className="extra">
          <p data-testid="inner">c</p>
        </WidgetShell>
      </WidgetShell>,
    )

    const inner = frameOf("inner")
    expect(inner.className.split(" ").sort()).toEqual(
      ["extra", "flex", "flex-col", "gap-section", "min-w-0"].sort(),
    )
    // Exactly one card surface: the outer shell's.
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
