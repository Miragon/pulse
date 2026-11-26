// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { BPMN_CANVAS_SLOT, BPMN_CANVAS_VARS } from "@miragon/pulse-ui/bpmn"
import { HeatmapLegend } from "./heat-diagram.js"

afterEach(() => {
  cleanup()
  document.getElementById("bpmn-overlay-css")?.remove()
})

describe("HeatmapLegend", () => {
  // The throughput view shows the legend wherever a range exists, also where no diagram mounts
  // (no version to draw, an XML read that failed): its swatch must not wait for a viewer.
  it("declares the canvas's stylesheet itself, in a document no diagram has drawn into", () => {
    expect(document.getElementById("bpmn-overlay-css")).toBeNull()
    const { container } = render(<HeatmapLegend min="1" max="9" />)
    const sheet = document.getElementById("bpmn-overlay-css")
    expect(sheet?.tagName).toBe("STYLE")
    // The swatch is a canvas slot, so the sheet's paper, ramp and blend reach it.
    const swatch = container.querySelector(`[data-slot="${BPMN_CANVAS_SLOT}"]`)
    expect(swatch).not.toBeNull()
    for (const name of [
      BPMN_CANVAS_VARS.paper,
      BPMN_CANVAS_VARS.heatTo,
      BPMN_CANVAS_VARS.heatBlend,
    ])
      expect(sheet?.textContent).toContain(`${name}:`)
  })

  it("adds the stylesheet once, however many legends and diagrams the view shows", () => {
    render(
      <>
        <HeatmapLegend min="1" max="9" />
        <HeatmapLegend min="2" max="2" />
      </>,
    )
    expect(document.querySelectorAll("#bpmn-overlay-css")).toHaveLength(1)
  })
})
