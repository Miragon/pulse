// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TriangleAlert } from "lucide-react"
import { Icon } from "./icon.js"
import { Section } from "./section.js"
import { SegmentedControl } from "./segmented-control.js"

/** The kit pieces' tone and icon roles; the primitives and components are pinned by their own suites. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("selection in the info tone (CI: blue contour + tint, black text)", () => {
  it("SegmentedControl: the pressed segment is the info tint and an inset info contour", () => {
    render(
      <SegmentedControl
        options={[
          { value: "f", label: "Frequenz" },
          { value: "d", label: "Dauer" },
        ]}
        value="d"
        onChange={() => {}}
      />,
    )
    const pressed = screen.getByRole("button", { name: "Dauer" })
    expect(classes(pressed)).toEqual(
      expect.arrayContaining([
        "bg-info-soft",
        "text-foreground",
        "ring-1",
        "ring-inset",
        "ring-info",
      ]),
    )
    expect(classes(pressed)).toContain("focus-visible:ring-focus")
    expect(classes(screen.getByRole("button", { name: "Frequenz" }))).not.toContain("ring-info")
  })

  it("SegmentedControl: segments sit inside the track with concentric corners, no separators", () => {
    const { container } = render(
      <SegmentedControl
        ariaLabel="Ansicht"
        options={[
          { value: "live", label: "Live" },
          { value: "freq", label: "Frequenz" },
          { value: "dur", label: "Dauer" },
        ]}
        value="live"
        onChange={() => undefined}
      />,
    )
    const track = container.firstElementChild!
    // The contour never touches the track's border, and the track never clips it.
    expect(classes(track)).toEqual(expect.arrayContaining(["p-0.5", "gap-0.5", "rounded-md"]))
    expect(classes(track)).not.toContain("overflow-hidden")
    for (const segment of screen.getAllByRole("button")) {
      expect(classes(segment)).toContain("rounded-[calc(var(--radius-md)-3px)]")
      expect(classes(segment).some((c) => c.includes("border-r"))).toBe(false)
    }
  })
})

describe("icons", () => {
  it("Icon: decorative 16 px at the CI stroke by default, named when it stands alone, dense opt-in", () => {
    const { container } = render(
      <>
        <Icon icon={TriangleAlert} />
        <Icon icon={TriangleAlert} label="Warnung" dense size={24} />
      </>,
    )
    const [plain, named] = [...container.querySelectorAll("svg")]
    expect(plain.getAttribute("aria-hidden")).toBe("true")
    expect(plain.getAttribute("width")).toBe("16")
    expect(plain.getAttribute("stroke-width")).toBe("2.5")
    expect(screen.getByRole("img", { name: "Warnung" })).toBe(named)
    expect(named.getAttribute("width")).toBe("24")
    expect(named.getAttribute("stroke-width")).toBe("2")
  })

  it("Section rotates a Lucide chevron when open and reports the toggle", () => {
    const onToggle = vi.fn()
    const { container } = render(
      <Section title="Variablen" count={2} onToggle={onToggle}>
        x
      </Section>,
    )
    const chevron = container.querySelector("summary svg.lucide-chevron-right")!
    expect(chevron.getAttribute("class")).toContain("[[open]>summary>&]:rotate-90")
    const details = container.querySelector("details")!
    details.open = true
    fireEvent(details, new Event("toggle"))
    expect(onToggle).toHaveBeenCalledWith(true)
  })
})
