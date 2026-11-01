// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { ViewMeta } from "./view-meta.js"

/** `brand-gates.test.ts` scans for off-scale sizes; these pin the role each piece takes. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("widget-shell type roles", () => {
  it("ViewMeta is a caption (13 px)", () => {
    render(<ViewMeta subject="Invoice" />)
    expect(classes(screen.getByText("Invoice"))).toContain("text-small")
  })
})

describe("BpmnZoomControls (CI §8, §10: chrome over the paper stays light)", () => {
  it("is a forced-light island of 32 px icon buttons with Lucide icons and names", () => {
    const { container } = render(
      <BpmnZoomControls onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFit={vi.fn()} />,
    )
    const bar = container.firstElementChild!
    expect(bar.getAttribute("data-theme-mode")).toBe("light")
    expect(classes(bar)).toContain("rounded-md")
    for (const name of ["Zoom in", "Fit to viewport", "Zoom out"]) {
      const button = screen.getByRole("button", { name })
      expect(classes(button)).toContain("size-8")
      expect(button.querySelector("svg.lucide")).toBeTruthy()
    }
  })
})
