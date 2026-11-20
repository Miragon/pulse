// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FIELD_TEXT } from "@miragon/pulse-ui"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { IdText } from "./id-text.js"
import { ViewMeta } from "./view-meta.js"

/** `brand-gates.test.ts` scans for off-scale sizes; these pin the role each piece takes. */

const restores: Array<() => void> = []

/** Replaces `key` on `target` for one test; `afterEach` puts the original back or drops the stand-in. */
function stubProperty(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, value })
  restores.push(() => {
    if (original) Object.defineProperty(target, key, original)
    else Reflect.deleteProperty(target, key)
  })
}

afterEach(() => {
  cleanup()
  for (const restore of restores.splice(0).reverse()) restore()
})

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("widget-shell type roles", () => {
  it("ViewMeta is a caption (13 px)", () => {
    render(<ViewMeta subject="Invoice" />)
    expect(classes(screen.getByText("Invoice"))).toContain("text-small")
  })

  it("IdText's field after a failed copy is a field's text (16 px on a coarse pointer), never the dense step", async () => {
    // Neither path copies in this frame: the id stays selected in a read-only field that takes focus.
    stubProperty(navigator, "clipboard", {
      writeText: () => Promise.reject(new Error("denied")),
    })
    stubProperty(document, "execCommand", () => false)
    render(<IdText value="5f0ce78e-6b1d-11ef-9c3a-0242ac120002" />)
    fireEvent.click(screen.getByRole("button", { name: /^Copy / }))
    const field = await screen.findByRole("textbox", { name: "Full ID" })
    expect(classes(field)).toContain(FIELD_TEXT)
    expect(classes(field)).not.toContain("text-dense")
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
