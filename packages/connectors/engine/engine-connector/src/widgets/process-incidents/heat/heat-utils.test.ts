// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { CD_TOKENS } from "@miragon/pulse-ui"
import {
  composite,
  contrastRatio,
  parseThemeVariables,
  resolveColor,
  themeStylesheets,
  type Rgba,
} from "@miragon/pulse-ui/testing"
import { BPMN_CANVAS_VARS, type BpmnElement } from "@miragon/pulse-widget-shell/widgets"
import {
  buildGradientLut,
  parseColor,
  readHeatPaint,
  type HeatRamp,
  buildHeatPoints,
  drawHeatLayer,
  HEAT_BLEND_CSS,
  HEAT_GRADIENT_CSS,
  HEAT_PEAK_ALPHA,
  heatColor,
  heatIntensity,
  MIN_HEAT_INTENSITY,
  weightRange,
} from "./heat-utils.js"

const channels = (hex: string) => parseColor(hex)!
const rgba = ([r, g, b, a]: readonly number[]): Rgba => ({
  r: (r ?? 0) / 255,
  g: (g ?? 0) / 255,
  b: (b ?? 0) / 255,
  a: (a ?? 0) / 255,
})
const hex = (value: string): Rgba => rgba([...channels(value), 255])
const WHITE = hex(CD_TOKENS.weiss)
/** The light canvas's ramp: widget-shell's BPMN_TOKENS.heat over the vendored tokens. */
const RAMP: HeatRamp = { from: channels(CD_TOKENS["info-soft"]), to: channels(CD_TOKENS.blau) }
/** The dark canvas's ramp, screened into the drawing. */
const DARK_RAMP: HeatRamp = { from: channels(CD_TOKENS.schwarz), to: channels(CD_TOKENS.blau) }
/** The dark paper and ink: pulse-ui's dark ground and text, the canvas's dark paper and ink. */
const DARK = parseThemeVariables(...themeStylesheets()).dark
const DARK_PAPER = resolveColor("var(--background)", DARK)
const DARK_INK = resolveColor("var(--foreground)", DARK)

/** `fg` screened into `bg` at its alpha (mix-blend-mode: screen): white stays white. */
function screened(fg: Rgba, bg: Rgba): Rgba {
  const screen = (s: number, b: number) => 1 - (1 - s) * (1 - b)
  return composite(
    { r: screen(fg.r, bg.r), g: screen(fg.g, bg.g), b: screen(fg.b, bg.b), a: fg.a },
    bg,
  )
}

/** An element on a canvas, its variables declared as the frame's stylesheet would. */
function onCanvas(from: string, to: string, blend: string): HTMLElement {
  const element = document.createElement("div")
  element.style.setProperty(BPMN_CANVAS_VARS.heatFrom, from)
  element.style.setProperty(BPMN_CANVAS_VARS.heatTo, ` ${to}`)
  element.style.setProperty(BPMN_CANVAS_VARS.heatBlend, ` ${blend}`)
  document.body.append(element)
  return element
}

describe("readHeatPaint", () => {
  it("reads the ramp's ends and the blend from the canvas's variables where the diagram sits", () => {
    const light = onCanvas(CD_TOKENS["info-soft"], CD_TOKENS.blau, "multiply")
    expect(readHeatPaint(light)).toEqual({ ramp: RAMP, blend: "multiply" })
    const dark = onCanvas(CD_TOKENS.schwarz, CD_TOKENS.blau, "screen")
    expect(readHeatPaint(dark)).toEqual({ ramp: DARK_RAMP, blend: "screen" })
    light.remove()
    dark.remove()
  })

  it("is null on a page without the canvas, or with a blend it does not paint: no forked fallback", () => {
    const element = document.createElement("div")
    document.body.append(element)
    expect(readHeatPaint(element)).toBeNull()
    const odd = onCanvas(CD_TOKENS["info-soft"], CD_TOKENS.blau, "overlay")
    expect(readHeatPaint(odd)).toBeNull()
    element.remove()
    odd.remove()
  })
})

describe("the heat ramp (owner decision 2j: one hue, --cd-info-soft to --cd-blau)", () => {
  it("starts on the info tint and ends on full blue", () => {
    expect(heatColor(0, RAMP).slice(0, 3)).toEqual(RAMP.from)
    expect(heatColor(1, RAMP).slice(0, 3)).toEqual(RAMP.to)
    expect(heatColor(-1, RAMP)).toEqual(heatColor(0, RAMP))
    expect(heatColor(2, RAMP)).toEqual(heatColor(1, RAMP))
  })

  it("never turns red: every step is bluer than it is red (red is for incidents)", () => {
    for (let i = 0; i <= 10; i++) {
      const [r, , b] = heatColor(i / 10, RAMP)
      expect(b).toBeGreaterThan(r)
    }
  })

  it("fades in over the rim, then holds the peak opacity", () => {
    expect(heatColor(0, RAMP)[3]).toBe(0)
    expect(heatColor(0.1, RAMP)[3]).toBe(Math.round(HEAT_PEAK_ALPHA * 0.5 * 255))
    expect(heatColor(0.2, RAMP)[3]).toBe(Math.round(HEAT_PEAK_ALPHA * 255))
    expect(heatColor(1, RAMP)[3]).toBe(Math.round(HEAT_PEAK_ALPHA * 255))
  })

  it("is a 256-step RGBA table the colorize pass indexes by alpha", () => {
    const lut = buildGradientLut(RAMP)
    expect(lut).toHaveLength(256 * 4)
    expect([...lut.slice(0, 4)]).toEqual(heatColor(0, RAMP))
    expect([...lut.slice(255 * 4)]).toEqual(heatColor(1, RAMP))
  })

  it("the faintest value above zero still shows on the paper (U16)", () => {
    const faintest = composite(rgba(heatColor(MIN_HEAT_INTENSITY, RAMP)), WHITE)
    expect(contrastRatio(faintest, WHITE)).toBeGreaterThan(1.3)
  })

  it("keeps a black task label readable under the strongest heat (4.5:1)", () => {
    const strongest = composite(rgba(heatColor(1, RAMP)), WHITE)
    expect(contrastRatio(hex(CD_TOKENS.schwarz), strongest)).toBeGreaterThanOrEqual(4.5)
  })

  it("draws its legend from the canvas's variables, starting at the minimum intensity, in its blend", () => {
    expect(HEAT_GRADIENT_CSS).toBe(
      "linear-gradient(to right, color-mix(in srgb, var(--bpmn-heat-to) 30%, var(--bpmn-heat-from)), var(--bpmn-heat-to))",
    )
    expect(HEAT_BLEND_CSS).toBe("var(--bpmn-heat-blend)")
  })
})

describe("the heat ramp on the dark canvas (derived from D10, point 7; awaits the owner's confirmation)", () => {
  it("never turns red: from the paper's own black (transparent there) every step is bluer than red", () => {
    expect(heatColor(0, DARK_RAMP)[3]).toBe(0)
    for (let i = 1; i <= 10; i++) {
      const [r, , b] = heatColor(i / 10, DARK_RAMP)
      expect(b).toBeGreaterThan(r)
    }
  })

  it("the faintest value above zero still shows on the dark paper (U16)", () => {
    const faintest = screened(rgba(heatColor(MIN_HEAT_INTENSITY, DARK_RAMP)), DARK_PAPER)
    expect(contrastRatio(faintest, DARK_PAPER)).toBeGreaterThan(1.3)
  })

  it("keeps the white label readable under the strongest heat (4.5:1): screened, white stays white", () => {
    const strongest = screened(rgba(heatColor(1, DARK_RAMP)), DARK_PAPER)
    expect(contrastRatio(DARK_INK, strongest)).toBeGreaterThanOrEqual(4.5)
    expect(screened(rgba(heatColor(1, DARK_RAMP)), DARK_INK)).toEqual(DARK_INK)
  })
})

const shape = (id: string, type = "bpmn:ServiceTask"): BpmnElement => ({
  id,
  x: 100,
  y: 100,
  width: 100,
  height: 80,
  businessObject: { id, $type: type },
})

/** A key matching nothing gives an UNCOLORED diagram, not an error, so the id matching is pinned here. */
describe("buildHeatPoints", () => {
  it("stamps one centred point per element carrying a positive value", () => {
    expect(buildHeatPoints([shape("Activity_A")], { Activity_A: 2548 })).toEqual([
      { x: 150, y: 140, weight: 2548 },
    ])
  })

  it("produces nothing when no key matches a diagram element, or for a zero", () => {
    expect(buildHeatPoints([shape("Activity_A")], { Other: 100 })).toEqual([])
    expect(buildHeatPoints([shape("Activity_A")], { Activity_A: 0 })).toEqual([])
  })

  it("skips label elements so an activity is not stamped twice", () => {
    const target = shape("Activity_A")
    const label: BpmnElement = { ...target, type: "label", y: 190, labelTarget: target }
    expect(buildHeatPoints([target, label], { Activity_A: 5 })).toHaveLength(1)
  })

  it("skips structural elements and flows: the counts are per element", () => {
    const pool = shape("Participant_1", "bpmn:Participant")
    const flow = shape("Flow_1", "bpmn:SequenceFlow")
    expect(buildHeatPoints([pool, flow], { Participant_1: 999, Flow_1: 3 })).toEqual([])
  })
})

describe("drawHeatLayer", () => {
  it("stamps the smallest value at the minimum intensity, the largest at full, linear between", () => {
    const alphas: number[] = []
    const ctx = {
      globalAlpha: 1,
      clearRect: () => {},
      drawImage() {
        alphas.push(ctx.globalAlpha)
      },
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]) }),
      putImageData: () => {},
    }
    // The brush is a canvas of its own; a stub stands in for happy-dom's.
    const brush = {
      width: 10,
      height: 10,
      getContext: () => ({ arc() {}, beginPath() {}, closePath() {}, fill() {} }),
    }
    const original = document.createElement.bind(document)
    const spy = (tag: string): unknown => (tag === "canvas" ? brush : original(tag))
    document.createElement = spy as typeof document.createElement
    try {
      drawHeatLayer(
        ctx as unknown as CanvasRenderingContext2D,
        { width: 100, height: 100, rawWidth: 100, rawHeight: 100 },
        [
          { x: 10, y: 10, weight: 1 },
          { x: 30, y: 30, weight: 500.5 },
          { x: 50, y: 50, weight: 1000 },
        ],
        { min: 1, max: 1000 },
        20,
        buildGradientLut(RAMP),
      )
    } finally {
      document.createElement = original
    }
    expect(alphas).toHaveLength(3)
    expect(alphas[0]).toBe(MIN_HEAT_INTENSITY)
    expect(alphas[1]).toBeCloseTo(0.65, 6)
    expect(alphas[2]).toBe(1)
  })
})

describe("heatIntensity (the legend's ends are the values they encode)", () => {
  it("maps the range linearly onto the minimum intensity … 1", () => {
    const range = { min: 1, max: 1000 }
    expect(heatIntensity(1, range)).toBe(MIN_HEAT_INTENSITY)
    expect(heatIntensity(1000, range)).toBe(1)
    expect(heatIntensity(500.5, range)).toBeCloseTo(0.65)
  })

  it("paints a single value at full intensity and clamps what lies outside the range", () => {
    expect(heatIntensity(7, { min: 7, max: 7 })).toBe(1)
    expect(heatIntensity(0, { min: 1, max: 10 })).toBe(MIN_HEAT_INTENSITY)
    expect(heatIntensity(20, { min: 1, max: 10 })).toBe(1)
  })

  it("takes its range from the drawn weights: above zero, finite", () => {
    expect(weightRange([0, 3, 12, -1, Number.NaN, Infinity])).toEqual({ min: 3, max: 12 })
    expect(weightRange([0, -2])).toBeNull()
  })
})
