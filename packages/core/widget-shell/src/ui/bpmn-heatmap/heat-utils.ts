import { parseBpmnNames, readBpmnNames } from "../../bpmn-names.js"
import { BPMN_TOKENS, cdValue } from "../bpmn-tokens.js"

/** Kept free of React and viewer state so the math is testable. */

interface BusinessObject {
  id?: string
  $type?: string
  sourceRef?: { id?: string }
  targetRef?: { id?: string }
}

interface Waypoint {
  x: number
  y: number
}

export interface BpmnElement {
  id: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  waypoints?: Waypoint[]
  businessObject?: BusinessObject
  /** Set on label elements; points back at the shape they label. */
  labelTarget?: BpmnElement
}

export interface HeatPoint {
  x: number
  y: number
  weight: number
}

const SKIP_TYPES = new Set([
  "bpmn:Process",
  "bpmn:Collaboration",
  "bpmn:Participant",
  "bpmn:Lane",
  "bpmn:LaneSet",
  "bpmn:TextAnnotation",
  "bpmn:Association",
  "bpmn:Group",
])

/** So a rarely taken path still shows instead of fading to "never" (U16). */
export const MIN_HEAT_INTENSITY = 0.3

/** Linear from the smallest value above zero to the max, so the legend's ends are the values they encode. (A floor on `weight / max` painted everything up to 30 % like the minimum.) */
export function heatIntensity(weight: number, range: { min: number; max: number }): number {
  if (!(range.max > range.min)) return 1
  const t = Math.max(0, Math.min(1, (weight - range.min) / (range.max - range.min)))
  return MIN_HEAT_INTENSITY + (1 - MIN_HEAT_INTENSITY) * t
}

/** Below 1 on purpose: at 0.75 the darkest step keeps a black task label above 4.5:1. */
export const HEAT_PEAK_ALPHA = 0.75

/** Intensity at which the opacity reaches its peak — the soft rim of a blob below it. */
const HEAT_RIM = 0.2

export function hexChannels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** Owner decision 2j: ONE hue, never a rainbow and never red (red is for incidents). */
export function heatColor(t: number): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const from = hexChannels(cdValue(BPMN_TOKENS.heat.from))
  const to = hexChannels(cdValue(BPMN_TOKENS.heat.to))
  const mix = (i: number) => Math.round(from[i] + (to[i] - from[i]) * clamped)
  const alpha = HEAT_PEAK_ALPHA * Math.min(1, clamped / HEAT_RIM)
  return [mix(0), mix(1), mix(2), Math.round(alpha * 255)]
}

/** Index = the stamped alpha, so the colorize pass maps a pixel in O(1). */
export function buildGradientLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) lut.set(heatColor(i / 255), i * 4)
  return lut
}

/** Painted at HEAT_PEAK_ALPHA on the light paper, it matches the diagram. */
export const HEAT_GRADIENT_CSS = `linear-gradient(to right, color-mix(in srgb, var(--cd-${BPMN_TOKENS.heat.to}) ${String(
  Math.round(MIN_HEAT_INTENSITY * 100),
)}%, var(--cd-${BPMN_TOKENS.heat.from})), var(--cd-${BPMN_TOKENS.heat.to}))`

export function buildBrush(radius: number, blur: number): HTMLCanvasElement {
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

export function buildHeatPoints(
  elements: BpmnElement[],
  nodeFrequencies: Record<string, number>,
  edgeFrequencies: Record<string, number>,
): HeatPoint[] {
  const points: HeatPoint[] = []
  for (const el of elements) {
    // Skip label elements — they share their target's businessObject id and
    // would otherwise stamp a second heat blob over the activity's text.
    if (el.type === "label" || el.labelTarget) continue
    const bo = el.businessObject
    const type = bo?.$type
    if (!bo?.id || !type) continue
    if (SKIP_TYPES.has(type)) continue

    if (type === "bpmn:SequenceFlow") {
      points.push(...sequenceFlowHeatPoints(el, bo, edgeFrequencies))
      continue
    }

    const point = nodeHeatPoint(el, bo.id, nodeFrequencies)
    if (point) points.push(point)
  }
  return points
}

function sequenceFlowHeatPoints(
  el: BpmnElement,
  bo: BusinessObject,
  edgeFrequencies: Record<string, number>,
): HeatPoint[] {
  const srcId = bo.sourceRef?.id
  const tgtId = bo.targetRef?.id
  if (!srcId || !tgtId) return []
  const flow = edgeFrequencies[`${srcId}->${tgtId}`] ?? 0
  if (flow <= 0) return []
  const waypoints = el.waypoints
  if (!waypoints || waypoints.length < 2) return []
  const points: HeatPoint[] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    const segments = Math.max(2, Math.ceil(len / 30))
    for (let s = 0; s <= segments; s++) {
      const t = s / segments
      points.push({ x: a.x + dx * t, y: a.y + dy * t, weight: flow })
    }
  }
  return points
}

function nodeHeatPoint(
  el: BpmnElement,
  id: string,
  nodeFrequencies: Record<string, number>,
): HeatPoint | null {
  const freq = nodeFrequencies[id]
  if (!freq || freq <= 0) return null
  if (el.x == null || el.y == null || el.width == null || el.height == null) return null
  return {
    x: el.x + el.width / 2,
    y: el.y + el.height / 2,
    weight: freq,
  }
}

export function drawHeatLayer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rawWidth: number,
  rawHeight: number,
  points: HeatPoint[],
  /** The smallest and largest weight of `points` (the legend's ends). */
  range: { min: number; max: number },
  radiusPx: number,
  gradientLut: Uint8ClampedArray,
) {
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

  // getImageData ignores the dpr transform: use raw dimensions, or only the top-left quadrant gets colorized on retina.
  const img = ctx.getImageData(0, 0, rawWidth, rawHeight)
  const data = img.data
  for (let i = 0, n = data.length; i < n; i += 4) {
    const a = data[i + 3]
    if (a === 0) continue
    const j = a * 4
    data[i] = gradientLut[j]
    data[i + 1] = gradientLut[j + 1]
    data[i + 2] = gradientLut[j + 2]
    data[i + 3] = gradientLut[j + 3]
  }
  ctx.putImageData(img, 0, 0)
}

/** The smallest value above zero and the largest, or null when nothing is above zero. */
export function heatRange(values: Record<string, number>): { min: number; max: number } | null {
  return weightRange(Object.values(values))
}

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

/** Read by the shared rule (`readBpmnNames`); an unparsable document gives no names, the table falls back to ids. */
export function bpmnElementNames(xml: string): Record<string, string> {
  return readBpmnNames(xml).elements
}

/** Same rule as the server (`parseBpmnNames`): the process's own name, else its pool's (the Camunda Modeler names the pool only), else null. */
export function bpmnProcessName(xml: string, processDefinitionKey: string): string | null {
  return parseBpmnNames(xml, processDefinitionKey).name
}
