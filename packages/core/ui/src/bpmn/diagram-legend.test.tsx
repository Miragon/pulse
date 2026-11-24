// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../index.js"
import { BPMN_OVERLAY_CSS } from "./bpmn-tokens.js"
import { CanvasBadge } from "./canvas-badge.js"
import { DiagramLegend } from "./diagram-legend.js"

afterEach(() => {
  cleanup()
  document.getElementById("bpmn-overlay-css")?.remove()
})

const samples = () =>
  [...document.querySelectorAll("[data-part=canvas-badge]")].map((badge) => [
    badge.getAttribute("data-kind"),
    badge.classList.contains("pulse-badge-legend"),
    badge.textContent,
  ])

describe("DiagramLegend", () => {
  it("explains each badge behind its button, with the badge as the diagram draws it", () => {
    render(<DiagramLegend scope="Badges count running instances of v3." />)
    const button = screen.getByRole("button", { name: "Legend" })
    const legend = document.querySelector<HTMLElement>("[data-part=diagram-legend]")!
    expect(button.getAttribute("popovertarget")).toBe(legend.id)
    expect(legend.getAttribute("popover")).toBe("auto")
    expect([...legend.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Badges count running instances of v3.",
      "incident here",
      "incident in a called instance",
      "waiting here",
    ])
    expect(samples()).toEqual([
      ["incidents", true, ""],
      ["incidentsInCalledInstances", true, ""],
      ["running", true, ""],
    ])
  })

  it("opens at its own button, apart from another legend's", () => {
    render(
      <>
        <DiagramLegend />
        <DiagramLegend placement="top" kinds={["running"]} />
      </>,
    )
    const [first, second] = screen.getAllByRole("button", { name: "Legend" })
    const anchors = [first, second].map((button) => button.style.getPropertyValue("anchor-name"))
    expect(anchors[0]).toMatch(/^--pulse-legend-\w+$/)
    expect(anchors[1]).not.toBe(anchors[0])
    const legends = [...document.querySelectorAll<HTMLElement>("[data-part=diagram-legend]")]
    expect(legends.map((legend) => legend.style.getPropertyValue("position-anchor"))).toEqual(
      anchors,
    )
    expect(legends[1].className).toContain("[position-area:top_span-left]")
    expect(legends[1].querySelectorAll("p")).toHaveLength(1)
  })

  it("speaks German", () => {
    render(
      <LocaleProvider locale="de">
        <DiagramLegend />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Legende" })).toBeTruthy()
    expect(screen.getByText("Incident in einer aufgerufenen Instanz")).toBeTruthy()
  })
})

describe("CanvasBadge", () => {
  it("brings the canvas's stylesheet, so a badge outside a diagram is drawn too", () => {
    render(<CanvasBadge kind="running" count={12} />)
    expect(document.getElementById("bpmn-overlay-css")?.textContent).toBe(BPMN_OVERLAY_CSS)
    const badge = document.querySelector("[data-part=canvas-badge]")!
    expect(badge.getAttribute("aria-hidden")).toBe("true")
    expect([...badge.classList]).toEqual([
      "bpmn-overlay-badge",
      "bpmn-overlay-badge--instance-count",
    ])
    expect(badge.textContent).toBe("12")
  })

  it("draws a root incident filled, the incidents in called instances quiet with their icon", () => {
    render(
      <>
        <CanvasBadge kind="incidents" count={2} />
        <CanvasBadge kind="incidentsInCalledInstances" count={1} stale />
      </>,
    )
    const [root, called] = [...document.querySelectorAll("[data-part=canvas-badge]")]
    expect(root.classList.contains("bpmn-overlay-badge--incident-count")).toBe(true)
    expect(root.querySelector("svg")).toBeNull()
    expect(called.classList.contains("bpmn-overlay-badge--called-incident-count")).toBe(true)
    expect(called.classList.contains("pulse-badge-stale")).toBe(true)
    expect(called.querySelector("svg.lucide")).not.toBeNull()
  })
})
