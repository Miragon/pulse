// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { buttonVariants, LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { HostBridgeProvider, type HostBridge } from "@miragon/mcp-toolkit-ui/app"
import { TriangleAlert } from "lucide-react"
import { Icon } from "./icon.js"
import { OpenInCockpitLink } from "./open-in-cockpit-link.js"
import { Section } from "./section.js"
import { SegmentedControl } from "./segmented-control.js"
import { DEFAULT_HEATMAP_LABELS } from "./bpmn-heatmap-labels.js"

/** The kit's OWN tone-aware pieces; the toolkit's components are pinned by its own suites since 2.8. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("heatmap defaults", () => {
  it("pins the English fallback strings", () => {
    expect(DEFAULT_HEATMAP_LABELS).toEqual({
      title: "BPMN heatmap",
      window: "window:",
      frequency: "Frequency",
      duration: "Duration",
      frequencyLegend: "Executions per element",
      durationLegend: "Avg duration per element",
      noData: "No heatmap data.",
      noHeat: "No metric data in this window.",
      bpmnUnavailable:
        "The BPMN diagram is not available. Ask in the chat for the figures per element instead.",
      less: "Less",
      more: "More",
      diagramAriaLabel: "BPMN process diagram with an execution heat overlay",
      errorTitle: "Diagram could not be rendered",
    })
  })
})

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

describe("OpenInCockpitLink", () => {
  function renderLink(
    locale: string,
    props: { vendor?: string; label?: string; variant?: "outline" | "menuitem" },
  ) {
    const openExternal = vi.fn()
    const bridge: HostBridge = {
      callTool: vi.fn(),
      sendFollowup: vi.fn(),
      openExternal,
      getWidgetData: () => null,
    }
    render(
      <HostBridgeProvider bridge={bridge}>
        <LocaleProvider locale={locale}>
          <OpenInCockpitLink url="https://engine.example/cockpit" {...props} />
        </LocaleProvider>
      </HostBridgeProvider>,
    )
    return openExternal
  }

  it("is named after the vendor and says that it opens a new tab", () => {
    renderLink("de", { vendor: "CIB seven" })
    const link = screen.getByRole("link", { name: "In CIB seven öffnen, öffnet in neuem Tab" })
    expect(link.textContent).toBe("In CIB seven öffnen")
    expect(link.querySelector("svg.lucide-external-link")?.getAttribute("aria-hidden")).toBe("true")
    expect(link.className).not.toContain("text-muted-foreground")
    // One action size with the buttons beside it: the toolkit's outline button, sm.
    expect(link.className).toBe(buttonVariants({ variant: "outline", size: "sm" }))
  })

  it("falls back to the engine cockpit and honours a caller's label, in English", () => {
    renderLink("en", {})
    expect(
      screen.getByRole("link", { name: "Open in engine cockpit (opens in a new tab)" }),
    ).toBeTruthy()
    cleanup()
    const openExternal = renderLink("en", {
      label: "Open instance in Camunda 7",
      vendor: "Camunda 7",
    })
    const link = screen.getByRole("link", {
      name: "Open instance in Camunda 7 (opens in a new tab)",
    })
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith("https://engine.example/cockpit")
  })

  it("as a menu entry: the same link and name, its icon in front, no outline", () => {
    const openExternal = renderLink("de", { vendor: "CIB seven", variant: "menuitem" })
    const item = screen.getByRole("menuitem", { name: "In CIB seven öffnen, öffnet in neuem Tab" })
    expect(item.tagName).toBe("A")
    expect(item.getAttribute("href")).toBe("https://engine.example/cockpit")
    expect(item.getAttribute("tabindex")).toBe("-1")
    expect(item.firstElementChild?.getAttribute("class")).toContain("lucide-external-link")
    expect(item.className).not.toContain("border-border")
    fireEvent.click(item)
    expect(openExternal).toHaveBeenCalledWith("https://engine.example/cockpit")
  })
})
