/**
 * The geometry of a chart in CSS pixels at the width its container measured: where the plot
 * starts after the axis' labels, where each point sits, how wide a bar is and which labels the
 * axis keeps so none collides with another. Pure, so it is tested at 360, 720 and 1240 px without
 * a browser.
 */

/** The axis labels' size: the type scale's small step. */
const LABEL_PX = 13
/** An em of Geist's widest digits and letters at that size, rounded up: a label never runs over. */
const EM_PER_CHAR = 0.62
/** The space a label keeps to the next one on the axis. */
const LABEL_GAP = 12
/** Between the axis' labels and the plot. */
const GUTTER_GAP = 8

/** The widest a text of `text.length` characters sets at the labels' size, never less. */
export function textWidth(text: string): number {
  return Math.ceil(text.length * LABEL_PX * EM_PER_CHAR)
}

/** The width the value axis takes on the left: its widest label and the gap to the plot. */
export function gutterWidth(labels: readonly string[]): number {
  return Math.max(0, ...labels.map(textWidth)) + GUTTER_GAP
}

/** The plot's horizontal layout: `count` even slots from `left` to `right`. */
export interface Slots {
  left: number
  /** One slot's width. */
  step: number
  /** The centre of slot `index`. */
  center: (index: number) => number
  /** The slot under the horizontal position `x`, clamped to the slots. */
  indexAt: (x: number) => number
}

export function slots(count: number, left: number, right: number): Slots {
  const n = Math.max(1, count)
  const step = Math.max(0, right - left) / n
  return {
    left,
    step,
    center: (index) => left + (index + 0.5) * step,
    indexAt: (x) => Math.min(n - 1, Math.max(0, Math.floor((x - left) / (step || 1)))),
  }
}

/** A label the axis keeps: its slot, its anchor point and which of its ends sits there. */
export interface PlacedLabel {
  index: number
  x: number
  anchor: "start" | "middle" | "end"
}

function placed(index: number, center: number, width: number, left: number, right: number) {
  if (center - width / 2 < left) return { index, x: left, anchor: "start" as const }
  if (center + width / 2 > right) return { index, x: right, anchor: "end" as const }
  return { index, x: center, anchor: "middle" as const }
}

function boxOf(label: PlacedLabel, width: number): [number, number] {
  if (label.anchor === "start") return [label.x, label.x + width]
  if (label.anchor === "end") return [label.x - width, label.x]
  return [label.x - width / 2, label.x + width / 2]
}

interface Axis {
  labels: readonly string[]
  center: (index: number) => number
  left: number
  right: number
}

/** Every `every`-th label from the last one backwards, and whether one had to be left out. */
function everyNth(axis: Axis, every: number): { kept: PlacedLabel[]; dropped: boolean } {
  const kept: PlacedLabel[] = []
  let dropped = false
  let edge = Number.POSITIVE_INFINITY
  for (let index = axis.labels.length - 1; index >= 0; index -= every) {
    const width = textWidth(axis.labels[index] ?? "")
    if (width === 0) continue
    const label = placed(index, axis.center(index), width, axis.left, axis.right)
    const [start, end] = boxOf(label, width)
    if (end + LABEL_GAP > edge) {
      dropped = true
      continue
    }
    kept.push(label)
    edge = start
  }
  return { kept: kept.reverse(), dropped }
}

/**
 * The labels an axis keeps between `left` and `right`: every n-th from the last one backwards
 * (the latest point is always named), n so the widest label and its gap fit between two
 * neighbours and an end label held inside the axis touches none, so the kept labels stay evenly
 * apart. Where even the latest alone is all that fits, it alone.
 */
export function placeLabels(
  labels: readonly string[],
  center: (index: number) => number,
  step: number,
  left: number,
  right: number,
): PlacedLabel[] {
  const axis = { labels, center, left, right }
  const widest = Math.max(0, ...labels.map(textWidth))
  let every = Math.max(1, Math.ceil((widest + LABEL_GAP) / Math.max(step, 1)))
  let result = everyNth(axis, every)
  while (result.dropped && every < labels.length) {
    every += 1
    result = everyNth(axis, every)
  }
  return result.kept
}

/** Bars of one slot: their width, the gap between them and where the first one starts. */
export interface BarSlot {
  width: number
  gap: number
  offset: number
}

/** A bar's widest: thin marks, the air of a slot left as air. */
const BAR_MAX = 24

/**
 * The bars of `count` series side by side in a slot `step` wide: at most 24 px each, a fifth of
 * the slot left as air, 2 px of the surface between neighbours where there is room (1 px in a
 * narrow slot, none in a slot too narrow for it), centred in the slot.
 */
export function barSlot(step: number, count: number): BarSlot {
  const n = Math.max(1, count)
  const gap = n === 1 ? 0 : step >= 12 ? 2 : step >= 6 ? 1 : 0
  const room = step >= 6 ? step * 0.8 : step
  const width = Math.max(1, Math.min(BAR_MAX, (room - gap * (n - 1)) / n))
  const used = width * n + gap * (n - 1)
  return { width, gap, offset: (step - used) / 2 }
}

/** A bar's data end: rounded 4 px (less on a thin or a short bar), square at the zero line. */
const BAR_RADIUS = 4

/** The outline of a bar from the zero line `base` up to `top`, its top corners rounded. */
export function barPath(x: number, width: number, top: number, base: number): string {
  const height = base - top
  const r = Math.max(0, Math.min(BAR_RADIUS, width / 2, height))
  return [
    `M${String(x)} ${String(base)}`,
    `V${String(top + r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(x + r)} ${String(top)}`,
    `H${String(x + width - r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(x + width)} ${String(top + r)}`,
    `V${String(base)}`,
    "Z",
  ].join(" ")
}

/**
 * A line through `points`, broken where a point has no value (`null`): a gap, never a line
 * drawn through a number nobody read. A point alone between two gaps is a dot of its own.
 */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  const parts: string[] = []
  let drawing = false
  for (const point of points) {
    if (!point) {
      drawing = false
      continue
    }
    parts.push(`${drawing ? "L" : "M"}${String(point.x)} ${String(point.y)}`)
    drawing = true
  }
  return parts.join(" ")
}

/** The plot's value axis: a value's height from the zero line `base` with `top` at `height`. */
export function scaleY(top: number, base: number, height: number): (value: number) => number {
  const span = top > 0 ? top : 1
  return (value) => base - (Math.max(0, value) / span) * height
}
