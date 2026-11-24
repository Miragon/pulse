// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { LocaleProvider } from "../../locale/locale-provider.js"
import { placeTip } from "./chart-parts.js"
import { MeterRows } from "./MeterRows.js"
import { Sparkline, type SparklinePoint } from "./Sparkline.js"

const NBSP = "\u00a0"

/** Sparkline, a KPI tile's trend, and MeterRows, the shares of a whole. */

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({ width: 112, height: 0, left: 0, top: 0, right: 112, bottom: 0, x: 0, y: 0 }) as DOMRect,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const POINTS: SparklinePoint[] = [
  { key: "a", label: "Nov 22", value: 3 },
  { key: "b", label: "Nov 23", value: 8 },
  { key: "c", label: "Nov 24", value: null },
]

describe("Sparkline", () => {
  const line = () => <Sparkline label="Started per day" categoryLabel="Day" points={POINTS} />

  it("draws the ramp's first step at its width with a dot on the latest value", () => {
    const { container } = render(line())
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("width")).toBe("112")
    const path = container.querySelector('[data-slot="chart-mark"]')!
    expect(path.getAttribute("class")).toContain("stroke-chart-1")
    expect(path.getAttribute("d")?.match(/[ML]/g)).toEqual(["M", "L"])
    // The latest point has no value: the dot sits on the one before it.
    const dot = container.querySelector('[data-slot="chart-dot"]')!
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(5 + (1.5 * 102) / 3)
  })

  it("shows a point's figure above it on hover", () => {
    const { container } = render(line())
    const surface = container.querySelector<HTMLElement>('[data-slot="sparkline"] > span')!
    fireEvent.pointerMove(surface, { clientX: 10 })
    const tip = document.querySelector('[data-slot="chart-tooltip"]')!
    expect(tip.textContent).toContain("Nov 22")
    expect(tip.textContent).toContain("3")
    fireEvent.pointerLeave(surface)
    expect(document.querySelector('[data-slot="chart-tooltip"]')).toBeNull()
  })

  it("places its tooltip in the window, out of every box that clips it, never past a side", () => {
    // The line in a KPI tile at the window's right edge, inside a strip that clips its content.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const rect = this.matches('[data-slot="chart-tooltip"]')
        ? { left: 0, top: 0, width: 200, height: 40 }
        : { left: 230, top: 60, width: 112, height: 24 }
      return {
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
      } as DOMRect
    })
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(360)
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(640)
    const { container } = render(
      <div className="overflow-hidden" data-testid="strip">
        {line()}
      </div>,
    )
    const surface = container.querySelector<HTMLElement>('[data-slot="sparkline"] > span')!
    fireEvent.pointerMove(surface, { clientX: 330 })
    const tip = document.querySelector<HTMLElement>('[data-slot="chart-tooltip"]')!
    expect(screen.getByTestId("strip").contains(tip)).toBe(false)
    expect(tip.className).toContain("fixed")
    // Above the line (60 - 4 - 40), its right edge 4 px inside the window (360 - 4 - 200).
    expect([tip.style.top, tip.style.left, tip.style.visibility]).toEqual(["16px", "156px", ""])
    expect(tip.textContent).toContain("Nov 24")
    // A scroll moves the line from under it: it closes.
    fireEvent.scroll(window)
    expect(document.querySelector('[data-slot="chart-tooltip"]')).toBeNull()
  })

  it("reads as its table, but leaves it out inside a button, whose name it would join", () => {
    const { unmount } = render(line())
    const table = screen.getByRole("table", { name: "Started per day" })
    expect(
      within(table)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["3", "8", "count unknown"])
    unmount()
    render(<button type="button">Started 11 {line()}</button>)
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.getByRole("button").textContent).toContain("Started 11")
    expect(screen.getByRole("button", { name: "Started 11" })).toBeDefined()
  })
})

describe("placeTip", () => {
  const view = { width: 360, height: 640 }
  const tip = { width: 200, height: 56 }

  it("goes above the line from its start where the window has room", () => {
    expect(placeTip({ left: 20, top: 100, bottom: 124 }, tip, view)).toEqual({ top: 40, left: 20 })
  })

  it("goes below the line where the window has no room above, never past a side", () => {
    expect(placeTip({ left: 300, top: 12, bottom: 36 }, tip, view)).toEqual({ top: 40, left: 156 })
    expect(placeTip({ left: -30, top: 12, bottom: 36 }, tip, view).left).toBe(4)
  })
})

describe("MeterRows", () => {
  it("shows each part's count and share of the parts' sum, its bar that long", () => {
    const { container } = render(
      <MeterRows
        label="Outcomes"
        rows={[
          { key: "approved", label: "Approved", value: 30 },
          { key: "rejected", label: "Rejected", value: 10 },
        ]}
      />,
    )
    const list = screen.getByRole("list", { name: "Outcomes" })
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Approved303075%", "Rejected101025%"])
    const fills = [...container.querySelectorAll<HTMLElement>('[data-slot="meter-fill"]')]
    expect(fills.map((f) => f.style.width)).toEqual(["75%", "25%"])
    expect(fills[0]?.getAttribute("class")).toContain("bg-chart-1")
  })

  it("takes the whole it is given, fills a share above it to the end, and draws no bar for none", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <MeterRows
          label="Trichter"
          total={200}
          rows={[
            { key: "in", label: "Eingegangen", value: 200 },
            { key: "more", label: "Nachgereicht", value: 250 },
            { key: "small", label: "Eskaliert", value: { atLeast: 9 } },
            { key: "none", label: "Unbekannt", value: null },
            { key: "inc", label: "Offene Incidents", value: 4, kind: "incident" },
          ]}
        />
      </LocaleProvider>,
    )
    const fills = [...container.querySelectorAll<HTMLElement>('[data-slot="meter-fill"]')]
    expect(fills.map((f) => f.style.width)).toEqual(["100%", "100%", "4.5%", "2%"])
    expect(fills.at(-1)?.getAttribute("class")).toContain("bg-danger")
    const rows = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(rows[2]?.textContent).toContain("mindestens 9")
    expect(rows[3]?.textContent).toContain("Anzahl unbekannt")
    expect(rows[3]?.querySelector('[data-slot="meter-fill"]')).toBeNull()
  })

  /** Each row's text as a screen reader reads it: the hidden signs out, the words in. */
  const spoken = (li: HTMLElement) =>
    [...li.querySelectorAll<HTMLElement>("span")]
      .filter((span) => span.children.length === 0 && !span.closest('[aria-hidden="true"]'))
      .map((span) => span.textContent)
      .join(" ")

  it("says a lower bound's share of an exact whole as a bound, on screen and in words", () => {
    render(
      <MeterRows
        label="Funnel"
        total={100}
        rows={[
          { key: "in", label: "Received", value: 60 },
          { key: "bound", label: "Escalated", value: { atLeast: 40 } },
        ]}
      />,
    )
    const rows = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(rows.map((li) => li.textContent)).toEqual([
      "Received606060%",
      `Escalated≥${NBSP}40at least 40≥${NBSP}40%at least 40%`,
    ])
    expect(spoken(rows[1])).toBe("Escalated at least 40 at least 40%")
  })

  it.each([
    ["the rows' sum, one row a lower bound", undefined, { atLeast: 40 }],
    ["the rows' sum, one row unknown", undefined, null],
    ["a whole that is a lower bound", { atLeast: 400 }, 40],
    ["an unknown whole", null, 40],
  ] as const)("says no share of %s, and compares the rows by their bars", (_, total, second) => {
    const { container } = render(
      <MeterRows
        label="Outcomes"
        total={total}
        rows={[
          { key: "approved", label: "Approved", value: 312 },
          { key: "second", label: "Second", value: second },
          { key: "incidents", label: "Open incidents", value: 3, kind: "incident" },
        ]}
      />,
    )
    expect(container.textContent).not.toContain("%")
    const fills = [...container.querySelectorAll<HTMLElement>('[data-slot="meter-fill"]')]
    expect(fills[0]?.style.width).toBe("100%")
    expect(fills.at(-1)?.style.width).toBe(`${String((3 / 312) * 100)}%`)
  })

  it("never reads a part as none or as all unless it is", () => {
    render(
      <MeterRows
        label="Incidents"
        rows={[
          { key: "ended", label: "Ended", value: 2999 },
          { key: "open", label: "Open", value: 1 },
          { key: "none", label: "None", value: 0 },
        ]}
      />,
    )
    const rows = within(screen.getByRole("list")).getAllByRole("listitem")
    expect(rows.map((li) => li.textContent)).toEqual([
      "Ended2,9992,99999.97%",
      "Open110.03%",
      "None000%",
    ])
  })
})
