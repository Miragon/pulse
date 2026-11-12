import { BPMN_TOKENS, cdVar, type BpmnElement } from "@miragon/pulse-widget-shell/widgets"

/** The heat layer's math, free of React and viewer state so it is testable. */

export interface HeatPoint {
  x: number
  y: number
  weight: number
}

/** Elements that would blanket the diagram, never an element the counts name. */
const SKIP_TYPES = new Set([
  "bpmn:Process",
  "bpmn:Collaboration",
  "bpmn:Participant",
  "bpmn:Lane",
  "bpmn:LaneSet",
  "bpmn:TextAnnotation",
  "bpmn:Association",
  "bpmn:Group",
  "bpmn:SequenceFlow",
])

/** So a rarely taken path still shows instead of fading to "never" (U16). */
export const MIN_HEAT_INTENSITY = 0.3

/** Linear from the smallest value above zero to the largest, so the legend's ends are the values they encode. */
export function heatIntensity(weight: number, range: { min: number; max: number }): number {
  if (!(range.max > range.min)) return 1
  const t = Math.max(0, Math.min(1, (weight - range.min) / (range.max - range.min)))
  return MIN_HEAT_INTENSITY + (1 - MIN_HEAT_INTENSITY) * t
}

/** Below 1 on purpose: at 0.75 the darkest step keeps a black task label above 4.5:1. */
export const HEAT_PEAK_ALPHA = 0.75

/** Intensity at which the opacity reaches its peak: the soft rim of a blob below it. */
const HEAT_RIM = 0.2

type Rgb = readonly [number, number, number]

/** The ramp's two ends: `BPMN_TOKENS.heat`, as the theme declares them. */
export interface HeatRamp {
  from: Rgb
  to: Rgb
}

/** A colour as the vendored tokens declare it (`#RRGGBB`); null for anything else. */
export function parseColor(value: string): Rgb | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!hex) return null
  const n = Number.parseInt(hex[1] ?? "", 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/**
 * The ramp from the theme's `--cd-*` variables where the diagram sits: the one source the legend's
 * gradient reads too, never a forked hex value. Null when the page declares no theme.
 */
export function readHeatRamp(element: Element): HeatRamp | null {
  const style = getComputedStyle(element)
  const from = parseColor(style.getPropertyValue(`--cd-${BPMN_TOKENS.heat.from}`))
  const to = parseColor(style.getPropertyValue(`--cd-${BPMN_TOKENS.heat.to}`))
  return from && to ? { from, to } : null
}

/** ONE hue (owner decision 2j), never a rainbow and never red: red is for incidents. */
export function heatColor(t: number, { from, to }: HeatRamp): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const mix = (i: 0 | 1 | 2) => Math.round(from[i] + (to[i] - from[i]) * clamped)
  const alpha = HEAT_PEAK_ALPHA * Math.min(1, clamped / HEAT_RIM)
  return [mix(0), mix(1), mix(2), Math.round(alpha * 255)]
}

/** Index = the stamped alpha, so the colorize pass maps a pixel in O(1). */
export function buildGradientLut(ramp: HeatRamp): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) lut.set(heatColor(i / 255, ramp), i * 4)
  return lut
}

/** Painted at HEAT_PEAK_ALPHA on the light paper, it matches the diagram. */
export const HEAT_GRADIENT_CSS = `linear-gradient(to right, color-mix(in srgb, ${cdVar(BPMN_TOKENS.heat.to)} ${String(
  Math.round(MIN_HEAT_INTENSITY * 100),
)}%, ${cdVar(BPMN_TOKENS.heat.from)}), ${cdVar(BPMN_TOKENS.heat.to)})`

function buildBrush(radius: number, blur: number): HTMLCanvasElement {
  const r2 = radius + blur
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = r2 * 2
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D canvas context unavailable")
  ctx.shadowOffsetX = ctx.shadowOffsetY = r2 * 2
  ctx.shadowBlur = blur
  ctx.shadowColor = "black"
  ctx.beginPath()
  ctx.arc(-r2, -r2, radius, 0, Math.PI * 2, true)
  ctx.closePath()
  ctx.fill()
  return canvas
}

/**
 * One centred point per element that carries a positive value; the counts are per element, so a
 * sequence flow stays cold. A key matching no element gives an uncoloured diagram, not an error.
 */
export function buildHeatPoints(
  elements: readonly BpmnElement[],
  values: Readonly<Record<string, number>>,
): HeatPoint[] {
  const points: HeatPoint[] = []
  for (const el of elements) {
    // A label shares its target's id and would stamp a second blob over the activity's text.
    if (el.type === "label" || el.labelTarget) continue
    const bo = el.businessObject
    if (!bo?.id || !bo.$type || SKIP_TYPES.has(bo.$type)) continue
    const weight = Object.hasOwn(values, bo.id) ? values[bo.id] : 0
    if (!weight || weight <= 0) continue
    if (el.x == null || el.y == null || el.width == null || el.height == null) continue
    points.push({ x: el.x + el.width / 2, y: el.y + el.height / 2, weight })
  }
  return points
}

export function drawHeatLayer(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number; rawWidth: number; rawHeight: number },
  points: readonly HeatPoint[],
  /** The smallest and largest weight of `points` (the legend's ends). */
  range: { min: number; max: number },
  radiusPx: number,
  gradientLut: Uint8ClampedArray,
) {
  const { width, height } = size
  ctx.clearRect(0, 0, width, height)
  if (points.length === 0 || range.max <= 0) return

  const blur = Math.max(8, radiusPx * 0.6)
  const brush = buildBrush(radiusPx, blur)
  const r2 = radiusPx + blur

  for (const p of points) {
    if (p.x < -r2 || p.y < -r2 || p.x > width + r2 || p.y > height + r2) continue
    ctx.globalAlpha = heatIntensity(p.weight, range)
    ctx.drawImage(brush, p.x - r2, p.y - r2)
  }
  ctx.globalAlpha = 1

  // getImageData ignores the dpr transform: the raw size, or only the top-left quadrant is coloured on retina.
  const img = ctx.getImageData(0, 0, size.rawWidth, size.rawHeight)
  const data = img.data
  for (let i = 0, n = data.length; i < n; i += 4) {
    const a = data[i + 3]
    if (!a) continue
    const j = a * 4
    data[i] = gradientLut[j]
    data[i + 1] = gradientLut[j + 1]
    data[i + 2] = gradientLut[j + 2]
    data[i + 3] = gradientLut[j + 3]
  }
  ctx.putImageData(img, 0, 0)
}

/** The smallest value above zero and the largest, or null when nothing is above zero. */
export function weightRange(weights: readonly number[]): { min: number; max: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const w of weights) {
    if (!Number.isFinite(w) || w <= 0) continue
    if (w < min) min = w
    if (w > max) max = w
  }
  return max > 0 ? { min, max } : null
}
