// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { LocaleProvider } from "../../locale/locale-provider.js"
import { BarChart } from "./BarChart.js"
import type { ChartPoint, ChartSeries } from "./chart-types.js"
import { LineChart } from "./LineChart.js"

/**
 * BarChart and LineChart at a measured width: what they draw, where, and how a reader reaches
 * the figures (the tooltip by pointer and keys, the table by a screen reader). happy-dom lays
 * nothing out, so each test sets the width the container measures.
 */

let width = 360

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => ({ width, height: 0, left: 0, top: 0, right: width, bottom: 0, x: 0, y: 0 }) as DOMRect,
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  width = 360
})

const SERIES: ChartSeries[] = [
  { key: "started", label: "Started" },
  { key: "ended", label: "Ended" },
]

const days = (n: number): ChartPoint[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `d${String(i)}`,
    label: `Nov ${String(i + 1)}`,
    description: `Monday, Nov ${String(i + 1)}`,
    values: { started: (i % 5) * 10 + 3, ended: (i % 3) * 7 },
  }))

const svgOf = (container: HTMLElement) => container.querySelector('[role="group"] > svg')!
const marks = (container: HTMLElement) => [
  ...container.querySelectorAll<SVGElement>('[data-slot="chart-mark"]'),
]
const plot = () => screen.getByRole("group", { name: "Started and ended per day" })
const tooltip = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="chart-tooltip"]')

/** Every x a path's outline reaches (its M, H and A end points, its line points). */
function xsOf(d: string): number[] {
  const xs: number[] = []
  for (const [, cmd, args] of d.matchAll(/([MLHVAZ])([^MLHVAZ]*)/g)) {
    const n = (args ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (cmd === "M" || cmd === "L") xs.push(n[0])
    if (cmd === "H") xs.push(n[0])
    if (cmd === "A") xs.push(n[5])
  }
  return xs
}

function bars(points = days(14)) {
  return render(
    <BarChart
      label="Started and ended per day"
      categoryLabel="Day"
      series={SERIES}
      points={points}
    />,
  )
}

describe("BarChart", () => {
  it.each([360, 720, 1240])("draws inside a %i px container, never wider", (w) => {
    width = w
    const { container } = bars(days(30))
    const svg = svgOf(container)
    expect(svg.getAttribute("width")).toBe(String(w))
    expect(svg.getAttribute("class")).toContain("max-w-full")
    const xs = marks(container).flatMap((m) => xsOf(m.getAttribute("d") ?? ""))
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(w)
    // The latest day is always named on the axis.
    const labels = [...container.querySelectorAll('[data-slot="chart-point-axis"] text')]
    expect(labels.at(-1)?.textContent).toBe("Nov 30")
  })

  it("draws one bar per value above zero, the series in their slots, nothing for none", () => {
    const { container } = bars([
      { key: "a", label: "a", values: { started: 4, ended: 0 } },
      { key: "b", label: "b", values: { started: { atLeast: 9 }, ended: null } },
      { key: "c", label: "c", values: { started: 2 } },
    ])
    expect(marks(container).map((m) => m.dataset.series)).toEqual(["first", "first", "first"])
    expect(marks(container)[0]?.getAttribute("class")).toContain("fill-chart-1")
  })

  it("paints an incident series in the danger tone and the second in the ramp's second step", () => {
    const { container } = render(
      <BarChart
        label="Started and ended per day"
        categoryLabel="Day"
        series={[...SERIES, { key: "incidents", label: "Incidents", kind: "incident" }]}
        points={[{ key: "a", label: "a", values: { started: 4, ended: 2, incidents: 1 } }]}
      />,
    )
    expect(marks(container).map((m) => [m.dataset.series, m.getAttribute("class")])).toEqual([
      ["first", expect.stringContaining("fill-chart-1")],
      ["second", expect.stringContaining("fill-chart-2")],
      ["incident", expect.stringContaining("fill-danger")],
    ])
  })

  it("names two series or more in a legend above the plot, one series in none", () => {
    const { container, unmount } = bars()
    const legend = container.querySelector('[data-slot="chart-legend"]')
    expect(legend?.getAttribute("aria-hidden")).toBe("true")
    expect(legend?.textContent).toBe("StartedEnded")
    unmount()
    const single = render(
      <BarChart label="Started" categoryLabel="Day" series={[SERIES[0]]} points={days(3)} />,
    )
    expect(single.container.querySelector('[data-slot="chart-legend"]')).toBeNull()
  })

  it("throws for a third series on the ramp, which would fall under 3:1 on light", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    expect(() =>
      render(
        <BarChart
          label="Three"
          categoryLabel="Day"
          series={[...SERIES, { key: "third", label: "Third" }]}
          points={days(2)}
        />,
      ),
    ).toThrow(/at most 2 series on the blue ramp/)
  })

  it("shows a group's figures on hover, beside it on the side with room, and hides them on leave", () => {
    width = 400
    const { container } = bars()
    // 14 days over the plot right of the axis labels: the pointer near the right end.
    fireEvent.pointerMove(plot(), { clientX: 390 })
    const tip = tooltip(container)!
    expect(tip.textContent).toContain("Monday, Nov 14")
    expect(tip.textContent).toContain("Started")
    expect(tip.style.right).not.toBe("")
    expect(tip.getAttribute("aria-hidden")).toBe("true")
    expect(container.querySelector('[data-slot="chart-band"]')).not.toBeNull()
    fireEvent.pointerMove(plot(), { clientX: 30 })
    expect(tooltip(container)?.textContent).toContain("Monday, Nov 1")
    expect(tooltip(container)?.style.left).not.toBe("")
    fireEvent.pointerLeave(plot(), { pointerType: "mouse" })
    expect(tooltip(container)).toBeNull()
  })

  it("is one tab stop whose arrow keys, Home and End move the tooltip, Escape and leaving close it", () => {
    const { container } = bars(days(5))
    const target = plot()
    expect(target.tabIndex).toBe(0)
    fireEvent.focus(target)
    expect(tooltip(container)?.textContent).toContain("Nov 5")
    fireEvent.keyDown(target, { key: "ArrowLeft" })
    expect(tooltip(container)?.textContent).toContain("Nov 4")
    fireEvent.keyDown(target, { key: "Home" })
    fireEvent.keyDown(target, { key: "ArrowLeft" })
    expect(tooltip(container)?.textContent).toContain("Nov 1")
    fireEvent.keyDown(target, { key: "End" })
    expect(tooltip(container)?.textContent).toContain("Nov 5")
    fireEvent.keyDown(target, { key: "Escape" })
    expect(tooltip(container)).toBeNull()
    fireEvent.keyDown(target, { key: "ArrowRight" })
    expect(tooltip(container)?.textContent).toContain("Nov 5")
    fireEvent.blur(target)
    expect(tooltip(container)).toBeNull()
  })

  it("reads as its table to a screen reader, each value in words, in the kit's locale", () => {
    render(
      <LocaleProvider locale="de">
        <BarChart
          label="Gestartet und beendet pro Tag"
          categoryLabel="Tag"
          series={[
            { key: "started", label: "Gestartet" },
            { key: "ended", label: "Beendet" },
          ]}
          points={[
            { key: "a", label: "24.11.", values: { started: { atLeast: 2000 }, ended: null } },
          ]}
        />
      </LocaleProvider>,
    )
    const table = screen.getByRole("table", { name: "Gestartet und beendet pro Tag" })
    // Hidden by its box: an sr-only table would still widen the page by its columns.
    expect(table.parentElement?.getAttribute("class")).toBe("sr-only")
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Tag", "Gestartet", "Beendet"])
    expect(
      within(table)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["mindestens 2.000", "Anzahl unbekannt"])
  })

  it("keeps its height empty until measured, so nothing jumps once it draws", () => {
    width = 0
    const { container } = bars()
    expect(svgOf(container)).toBeNull()
    expect(plot().style.height).toBe("194px")
  })

  it("draws again at the width its container takes after a resize", () => {
    const observers: (() => void)[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    const { container } = bars()
    expect(svgOf(container).getAttribute("width")).toBe("360")
    width = 720
    act(() => {
      for (const resized of observers) resized()
    })
    expect(svgOf(container).getAttribute("width")).toBe("720")
    vi.unstubAllGlobals()
  })

  it("measures once where no ResizeObserver exists", () => {
    vi.stubGlobal("ResizeObserver", undefined)
    const { container } = bars()
    expect(svgOf(container).getAttribute("width")).toBe("360")
    vi.unstubAllGlobals()
  })

  it("keeps a touch's tooltip, and the focused plot's when the pointer leaves", () => {
    const { container } = bars(days(5))
    fireEvent.pointerMove(plot(), { clientX: 30 })
    fireEvent.pointerLeave(plot(), { pointerType: "touch" })
    expect(tooltip(container)?.textContent).toContain("Nov 1")
    plot().focus()
    fireEvent.pointerLeave(plot(), { pointerType: "mouse" })
    expect(tooltip(container)?.textContent).toContain("Nov 1")
    fireEvent.keyDown(plot(), { key: "Tab" })
    expect(tooltip(container)?.textContent).toContain("Nov 1")
  })

  it("draws its axis and nothing else for no points, and shows no tooltip", () => {
    const { container } = bars([])
    expect(marks(container)).toEqual([])
    fireEvent.focus(plot())
    fireEvent.keyDown(plot(), { key: "ArrowLeft" })
    fireEvent.pointerMove(plot(), { clientX: 30 })
    expect(tooltip(container)).toBeNull()
    expect(container.querySelectorAll('[data-slot="chart-value-axis"] line')).toHaveLength(2)
  })
})

describe("LineChart", () => {
  function lines(points = days(14)) {
    return render(
      <LineChart
        label="Started and ended per day"
        categoryLabel="Day"
        series={SERIES}
        points={points}
      />,
    )
  }

  const paths = (container: HTMLElement) => [
    ...container.querySelectorAll<SVGPathElement>('[data-slot="chart-mark"] path'),
  ]

  it.each([360, 720, 1240])("draws a line per series inside a %i px container", (w) => {
    width = w
    const { container } = lines(days(90))
    const [first, second] = paths(container)
    expect(first?.getAttribute("class")).toContain("stroke-chart-1")
    expect(second?.getAttribute("class")).toContain("stroke-chart-2")
    const xs = paths(container).flatMap((p) => xsOf(p.getAttribute("d") ?? ""))
    expect(Math.max(...xs)).toBeLessThanOrEqual(w)
    expect(Math.min(...xs)).toBeGreaterThan(0)
  })

  it("dashes the second series in every mode and breaks a line at a missing value", () => {
    const { container } = lines([
      { key: "a", label: "a", values: { started: 1, ended: 2 } },
      { key: "b", label: "b", values: { started: null, ended: 3 } },
      { key: "c", label: "c", values: { started: 4, ended: 1 } },
      { key: "d", label: "d", values: { started: 5, ended: 1 } },
    ])
    const [first, second] = paths(container)
    expect(first?.getAttribute("stroke-dasharray")).toBeNull()
    expect(second?.getAttribute("stroke-dasharray")).toBe("6 4")
    expect(first?.getAttribute("d")?.match(/M/g)).toHaveLength(2)
    // The first point stands alone between the edge and the gap: a dot of its own.
    expect(container.querySelectorAll('[data-series="first"] circle')).toHaveLength(1)
  })

  it("moves a crosshair to the hovered point with a dot on each series and every figure", () => {
    const { container } = lines(days(4))
    fireEvent.pointerMove(plot(), { clientX: 359 })
    expect(container.querySelector('[data-slot="chart-crosshair"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="chart-dot"]')).toHaveLength(2)
    const tip = tooltip(container)!
    // Hidden from a screen reader, which reads the table: the tooltip is a sighted view of it.
    expect(
      within(tip)
        .getAllByRole("listitem", { hidden: true })
        .map((li) => li.textContent),
    ).toEqual(["33Started", "0Ended"])
  })
})
