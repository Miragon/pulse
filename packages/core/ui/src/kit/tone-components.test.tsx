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

describe("selection (CI §8: the hover fill with an --interaction edge, text in the foreground)", () => {
  it("SegmentedControl: the pressed segment takes the hover fill, a 2 px --interaction border and 600", () => {
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
        "bg-accent",
        "text-foreground",
        "font-semibold",
        "border-2",
        "border-interaction",
      ]),
    )
    // A border, not a ring, so a Windows contrast theme keeps it; the focus ring sits inside.
    expect(classes(pressed).some((c) => /^ring-/.test(c))).toBe(false)
    expect(classes(pressed)).toEqual(
      expect.arrayContaining(["focus-visible:ring-focus", "focus-visible:ring-inset"]),
    )
    const other = classes(screen.getByRole("button", { name: "Frequenz" }))
    expect(other).toEqual(
      expect.arrayContaining([
        "border-2",
        "border-transparent",
        "font-normal",
        "text-muted-foreground",
        "hover:bg-accent",
      ]),
    )
    expect(other).not.toContain("border-interaction")
  })

  it("SegmentedControl: a count is compact on screen and exact for a screen reader; an alarming one adds a tone icon of its own shape, the number neutral", () => {
    const { container } = render(
      <SegmentedControl
        options={[
          { value: "all", label: "All", count: 12_345 },
          {
            value: "incident",
            label: "With incident",
            count: 9,
            tone: "danger",
            countLabel: "9 with incident",
          },
        ]}
        value="all"
        onChange={() => {}}
      />,
    )
    // The compact figure is hidden from the name, which says the exact count once.
    const all = screen.getByRole("button", { name: /^All\s*12,345$/ })
    expect(all.textContent).toContain("12.3k")
    const alarming = screen.getByRole("button", { name: /9 with incident$/ })
    const icon = alarming.querySelector("svg")!
    expect(icon.getAttribute("class")).toContain("lucide-circle-x")
    expect(icon.getAttribute("class")).toContain("text-danger")
    expect(icon.getAttribute("width")).toBe("12")
    expect(icon.getAttribute("aria-hidden")).toBe("true")
    // The number itself carries no tone.
    const number = [...alarming.querySelectorAll("span")].find((s) => s.textContent === "9")!
    expect(number.closest("[class*='text-danger']")).toBeNull()
    expect(container.querySelectorAll("svg")).toHaveLength(1)
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
    expect(classes(track)).toEqual(
      expect.arrayContaining(["p-0.5", "gap-0.5", "rounded-sm", "bg-background"]),
    )
    expect(classes(track)).not.toContain("overflow-hidden")
    for (const segment of screen.getAllByRole("button")) {
      expect(classes(segment)).toEqual(
        expect.arrayContaining(["min-h-segment", "rounded-[calc(var(--radius-sm)-2px)]"]),
      )
      expect(classes(segment).some((c) => c.includes("border-r"))).toBe(false)
    }
  })
})

describe("icons", () => {
  it("Icon: decorative 16 px at the CI stroke by default, named when it stands alone, dense 12 px at the same stroke", () => {
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
    expect(named.getAttribute("width")).toBe("12")
    expect(named.getAttribute("stroke-width")).toBe("2.5")
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
