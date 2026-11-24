// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../index.js"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"

afterEach(() => {
  cleanup()
})

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("BpmnZoomControls", () => {
  const noop = () => {}

  it("names its buttons in the active locale, overridable per prop", () => {
    render(
      <LocaleProvider locale="de">
        <BpmnZoomControls
          onZoomIn={noop}
          onZoomOut={noop}
          onFit={noop}
          labels={{ fit: "Passend" }}
        />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Vergrößern" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Verkleinern" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Passend" })).toBeTruthy()
  })

  it("sits top-right, clear of the bpmn.io logo bpmn-js pins bottom-right", () => {
    render(<BpmnZoomControls onZoomIn={noop} onZoomOut={noop} onFit={noop} />)
    const bar = screen.getByRole("button", { name: "Zoom in" }).parentElement!
    expect(bar.className).toContain("top-3")
    expect(bar.className).not.toContain("bottom-")
  })

  it("calls each step on its button", () => {
    const steps = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onFit: vi.fn() }
    render(<BpmnZoomControls {...steps} />)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    fireEvent.click(screen.getByRole("button", { name: "Fit to viewport" }))
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    expect(steps.onZoomIn).toHaveBeenCalledTimes(1)
    expect(steps.onFit).toHaveBeenCalledTimes(1)
    expect(steps.onZoomOut).toHaveBeenCalledTimes(1)
  })
})

describe("BpmnZoomControls (CI §8: chrome over the paper, in the theme like the paper)", () => {
  it("is a card of 32 px icon buttons with Lucide icons and names, no light island", () => {
    const { container } = render(
      <BpmnZoomControls onZoomIn={vi.fn()} onZoomOut={vi.fn()} onFit={vi.fn()} />,
    )
    const bar = container.firstElementChild!
    expect(bar.hasAttribute("data-theme-mode")).toBe(false)
    expect(classes(bar)).toContain("bg-card")
    expect(classes(bar)).toContain("rounded-md")
    for (const name of ["Zoom in", "Fit to viewport", "Zoom out"]) {
      const button = screen.getByRole("button", { name })
      expect(classes(button)).toContain("size-8")
      expect(button.querySelector("svg.lucide")).toBeTruthy()
    }
  })
})
