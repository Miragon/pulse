import { describe, expect, it } from "vitest"
import {
  barPath,
  barSlot,
  gutterWidth,
  linePath,
  placeLabels,
  scaleY,
  slots,
  textWidth,
} from "./chart-layout.js"

/** The widths the acceptance names: a phone, a tablet column, a wide page. */
const WIDTHS = [360, 720, 1240]

/** Dates as a dashboard writes them, the widest the formatters give (German, English). */
const DAY_LABELS = (n: number) =>
  Array.from({ length: n }, (_, i) => `${String((i % 28) + 1)}.${String((i % 12) + 1)}.2026`)

function boxes(labels: string[], width: number) {
  const left = gutterWidth(["10,000"])
  const s = slots(labels.length, left, width)
  return placeLabels(labels, s.center, s.step, 0, width).map((label) => {
    const w = textWidth(labels[label.index] ?? "")
    const start =
      label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - w : label.x - w / 2
    return { index: label.index, start, end: start + w }
  })
}

describe("the point axis keeps the labels that fit", () => {
  it.each(WIDTHS.flatMap((width) => [7, 14, 30, 90].map((n) => [width, n] as const)))(
    "at %i px with %i points: no label touches its neighbour or leaves the chart",
    (width, n) => {
      const kept = boxes(DAY_LABELS(n), width)
      expect(kept.length).toBeGreaterThan(0)
      for (const box of kept) {
        expect(box.start).toBeGreaterThanOrEqual(0)
        expect(box.end).toBeLessThanOrEqual(width)
      }
      for (let i = 1; i < kept.length; i++) {
        expect(
          kept[i].start - kept[i - 1].end,
          `${String(width)}px, ${String(n)}`,
        ).toBeGreaterThanOrEqual(12)
      }
    },
  )

  it("always names the latest point and keeps every label where there is room", () => {
    const labels = DAY_LABELS(7)
    expect(boxes(labels, 1240).map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(boxes(DAY_LABELS(30), 360).at(-1)?.index).toBe(29)
  })

  it("keeps the end labels inside the chart by their own end", () => {
    const s = slots(3, 40, 200)
    const placed = placeLabels(["Monday 23", "Tue", "Wednesday 25"], s.center, s.step, 0, 200)
    expect(placed.at(-1)).toMatchObject({ index: 2, x: 200, anchor: "end" })
  })

  it("skips a point without a label", () => {
    const s = slots(3, 0, 600)
    expect(placeLabels(["a", "", "c"], s.center, s.step, 0, 600).map((l) => l.index)).toEqual([
      0, 2,
    ])
  })
})

describe("slots", () => {
  it("splits the plot evenly and finds the slot under a position, clamped", () => {
    const s = slots(4, 40, 440)
    expect(s.step).toBe(100)
    expect(s.center(0)).toBe(90)
    expect(s.indexAt(39)).toBe(0)
    expect(s.indexAt(141)).toBe(1)
    expect(s.indexAt(10_000)).toBe(3)
  })
})

describe("bars", () => {
  it("are at most 24 px wide with 2 px of the surface between them, centred in their slot", () => {
    const wide = barSlot(100, 2)
    expect(wide).toEqual({ width: 24, gap: 2, offset: 25 })
    const narrow = barSlot(20, 2)
    expect(narrow.width).toBe(7)
    expect(narrow.gap).toBe(2)
    expect(narrow.offset * 2 + narrow.width * 2 + narrow.gap).toBeCloseTo(20)
  })

  it("keep a pixel each and lose the gap when a slot is too narrow for it", () => {
    expect(barSlot(4, 2)).toMatchObject({ gap: 0 })
    expect(barSlot(1, 3).width).toBe(1)
    expect(barSlot(30, 1)).toMatchObject({ gap: 0, width: 24 })
  })

  it("round the data end by 4 px at most, square at the zero line", () => {
    expect(barPath(10, 20, 50, 150)).toBe(
      "M10 150 V54 A4 4 0 0 1 14 50 H26 A4 4 0 0 1 30 54 V150 Z",
    )
    // A thin or short bar rounds by what it has.
    expect(barPath(0, 4, 148, 150)).toContain("A2 2 0 0 1 2 148")
  })
})

describe("lines", () => {
  it("break where a point has no value", () => {
    expect(linePath([{ x: 0, y: 5 }, { x: 10, y: 6 }, null, { x: 30, y: 2 }])).toBe(
      "M0 5 L10 6 M30 2",
    )
  })

  it("scale from the zero line to the top tick, never below zero", () => {
    const y = scaleY(100, 170, 160)
    expect(y(0)).toBe(170)
    expect(y(100)).toBe(10)
    expect(y(-5)).toBe(170)
    expect(scaleY(0, 170, 160)(0)).toBe(170)
  })
})
