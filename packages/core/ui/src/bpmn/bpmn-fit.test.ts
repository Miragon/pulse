// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import {
  clearFitPlacement,
  clearFitViewbox,
  type FitRect,
  KEEP_CLEAR_GAP,
  keptClearOf,
  ZOOM_CONTROLS_SLOT,
} from "./bpmn-fit.js"

/** The test-host's invoice diagram as drawn: 461 × 217 units. */
const INVOICE = { x: 129, y: 102, width: 461, height: 217 }
/** The zoom bar as the cockpit draws it: 12 px from the frame's top right, 34 × 100 px. */
const barOf = (width: number): FitRect => ({ x: width - 45, y: 11, width: 34, height: 100 })
/** bpmn.io's link: 15 px from the canvas's bottom right. */
const logoOf = (width: number, height: number): FitRect => ({
  x: width - 67,
  y: height - 37,
  width: 52,
  height: 22,
})

function overlaps(a: FitRect, b: FitRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

const grown = (rect: FitRect): FitRect => ({
  x: rect.x - KEEP_CLEAR_GAP,
  y: rect.y - KEEP_CLEAR_GAP,
  width: rect.width + 2 * KEEP_CLEAR_GAP,
  height: rect.height + 2 * KEEP_CLEAR_GAP,
})

describe("clearFitPlacement: bpmn-js's fit, clear of what lies over the canvas", () => {
  it("draws the diagram as bpmn-js's fit does where nothing lies over it: 95 %, centred, never past 1:1", () => {
    expect(clearFitPlacement(INVOICE, { width: 734, height: 263 }, [])).toEqual({
      scale: 0.95,
      width: 461 * 0.95,
      height: 217 * 0.95,
      x: (734 - 461 * 0.95) / 2,
      y: (263 - 217 * 0.95) / 2,
    })
    const narrow = clearFitPlacement(INVOICE, { width: 294, height: 238 }, [])
    expect(narrow?.scale).toBeCloseTo((0.95 * 294) / 461, 9)
  })

  it("keeps bpmn-js's fit where the zoom bar and the link lie beside the drawing (a 760 px card)", () => {
    const outer = { width: 734, height: 263 }
    expect(clearFitPlacement(INVOICE, outer, [barOf(734), logoOf(734, 263)])).toEqual(
      clearFitPlacement(INVOICE, outer, []),
    )
  })

  for (const [width, scale] of [
    [294, (0.95 * (294 - 45 - KEEP_CLEAR_GAP)) / 461],
    [374, (0.95 * (374 - 45 - KEEP_CLEAR_GAP)) / 461],
  ] as const) {
    it(`a ${width} px canvas draws it left of the zoom bar and above the link, as large as that room holds it`, () => {
      const outer = { width, height: 238 }
      const kept = [barOf(width), logoOf(width, 238)]
      const placed = clearFitPlacement(INVOICE, outer, kept)!

      for (const rect of kept) expect(overlaps(placed, grown(rect))).toBe(false)
      expect(placed.scale).toBeCloseTo(scale, 9)
      expect(placed.x).toBeGreaterThanOrEqual(0)
      expect(placed.y).toBeGreaterThanOrEqual(0)
      expect(placed.x + placed.width).toBeLessThanOrEqual(width - 45 - KEEP_CLEAR_GAP)
      expect(placed.y + placed.height).toBeLessThanOrEqual(238 - 37 - KEEP_CLEAR_GAP)
    })
  }

  it("draws a wide diagram below the zoom bar at the canvas's width where the room under it holds it", () => {
    const diagram = { width: 1400, height: 200 }
    const placed = clearFitPlacement(diagram, { width: 710, height: 265 }, [barOf(710)])!

    expect(placed.scale).toBeCloseTo((0.95 * 710) / 1400, 9)
    expect(placed.y).toBeGreaterThanOrEqual(11 + 100 + KEEP_CLEAR_GAP)
    expect(placed.y + placed.height).toBeLessThanOrEqual(265)
  })

  it("between two rooms that draw it as large, takes the one nearer the canvas's centre", () => {
    // A post left of the middle: either side draws a small diagram at 95 %, the right one nearer.
    const placed = clearFitPlacement({ width: 100, height: 100 }, { width: 600, height: 120 }, [
      { x: 220, y: 0, width: 40, height: 120 },
    ])!
    expect(placed.scale).toBeCloseTo(0.95, 9)
    const right = 260 + KEEP_CLEAR_GAP
    expect(placed.x + placed.width / 2).toBeCloseTo(right + (600 - right) / 2, 9)
  })

  it("ignores what lies beside the canvas, outside it", () => {
    const outer = { width: 734, height: 263 }
    expect(clearFitPlacement(INVOICE, outer, [{ x: 800, y: 0, width: 40, height: 40 }])).toEqual(
      clearFitPlacement(INVOICE, outer, []),
    )
  })

  it("keeps bpmn-js's fit where no room is free", () => {
    const outer = { width: 300, height: 200 }
    const all = { x: -10, y: -10, width: 400, height: 400 }
    expect(clearFitPlacement(INVOICE, outer, [all])).toEqual(clearFitPlacement(INVOICE, outer, []))
  })

  it("places nothing for an empty diagram or canvas", () => {
    expect(clearFitPlacement({ width: 0, height: 10 }, { width: 300, height: 200 }, [])).toBeNull()
    expect(clearFitPlacement(INVOICE, { width: 0, height: 200 }, [])).toBeNull()
  })
})

describe("clearFitViewbox: the placement as diagram-js's viewbox", () => {
  it("shows the diagram's bounds where the placement puts them, at its scale", () => {
    const outer = { width: 294, height: 238 }
    const kept = [barOf(294), logoOf(294, 238)]
    const placed = clearFitPlacement(INVOICE, outer, kept)!
    const box = clearFitViewbox(INVOICE, outer, kept)!

    // diagram-js draws the box over the whole canvas: scale = canvas / box, the box's origin at 0.
    expect(Math.min(outer.width / box.width, outer.height / box.height)).toBeCloseTo(
      placed.scale,
      9,
    )
    expect((INVOICE.x - box.x) * placed.scale).toBeCloseTo(placed.x, 9)
    expect((INVOICE.y - box.y) * placed.scale).toBeCloseTo(placed.y, 9)
  })

  it("is null where nothing is placed", () => {
    expect(clearFitViewbox({ ...INVOICE, width: 0 }, { width: 300, height: 200 }, [])).toBeNull()
  })
})

describe("keptClearOf: the zoom bar in the frame and bpmn.io's link, in the canvas's pixels", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  function at(element: Element, left: number, top: number, width: number, height: number) {
    element.getBoundingClientRect = () =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect
  }

  it("measures the bar beside the viewer's container and the link inside it, from the canvas's corner", () => {
    document.body.innerHTML = `
      <div class="frame">
        <div class="viewer"><div class="bjs-container"><div class="djs-container"></div>
          <a class="bjs-powered-by"></a></div></div>
        <div data-slot="${ZOOM_CONTROLS_SLOT}"></div>
      </div>
      <div data-slot="${ZOOM_CONTROLS_SLOT}" class="elsewhere"></div>`
    const viewer = document.querySelector(".viewer")!
    const canvas = document.querySelector(".djs-container")!
    at(canvas, 21, 101, 294, 238)
    at(document.querySelector(".frame > [data-slot]")!, 270, 112, 34, 100)
    at(document.querySelector(".bjs-powered-by")!, 248, 303, 52, 22)
    at(document.querySelector(".elsewhere")!, 0, 0, 500, 500)

    expect(keptClearOf(canvas, viewer)).toEqual([
      { x: 249, y: 11, width: 34, height: 100 },
      { x: 227, y: 202, width: 52, height: 22 },
    ])
  })
})
