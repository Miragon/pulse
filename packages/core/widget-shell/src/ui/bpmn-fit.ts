/** A rectangle: in diagram units for the diagram's bounds, else in the canvas's own pixels. */
export interface FitRect {
  x: number
  y: number
  width: number
  height: number
}

interface FitSize {
  width: number
  height: number
}

/** The diagram takes 95 % of the room it is fitted into, as bpmn-js's `fit-viewport` then 0.95. */
const FIT_MARGIN = 0.95
/** What the diagram keeps between itself and what lies over the canvas, in pixels. */
export const KEEP_CLEAR_GAP = 8

interface Placement extends FitRect {
  scale: number
}

/** The diagram as large as `region` holds it (never past 1:1, with the margin), centred in it. */
function placeIn(region: FitRect, diagram: FitSize): Placement | null {
  if (!(region.width > 0) || !(region.height > 0)) return null
  const scale =
    FIT_MARGIN * Math.min(1, region.width / diagram.width, region.height / diagram.height)
  const width = diagram.width * scale
  const height = diagram.height * scale
  return {
    scale,
    width,
    height,
    x: region.x + (region.width - width) / 2,
    y: region.y + (region.height - height) / 2,
  }
}

/** Whether two rectangles share an area; touching edges share none. */
function overlaps(a: FitRect, b: FitRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function grown(rect: FitRect, by: number): FitRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by,
  }
}

/** What lies over the canvas, cut to it; what lies beside it takes no room. */
function onCanvas(rects: ReadonlyArray<FitRect>, outer: FitSize): FitRect[] {
  return rects.flatMap((rect) => {
    const x = Math.max(0, rect.x)
    const y = Math.max(0, rect.y)
    const width = Math.min(outer.width, rect.x + rect.width) - x
    const height = Math.min(outer.height, rect.y + rect.height) - y
    return width > 0 && height > 0 ? [{ x, y, width, height }] : []
  })
}

/**
 * Every room bounded by the canvas's edges and the kept-clear rectangles' sides that holds none of
 * them: left of the zoom bar, below it, above bpmn.io's link, between the two.
 */
function freeRooms(outer: FitSize, kept: ReadonlyArray<FitRect>): FitRect[] {
  const lefts = [0, ...kept.map((rect) => rect.x + rect.width)]
  const rights = [outer.width, ...kept.map((rect) => rect.x)]
  const tops = [0, ...kept.map((rect) => rect.y + rect.height)]
  const bottoms = [outer.height, ...kept.map((rect) => rect.y)]
  const rooms: FitRect[] = []
  for (const x of lefts) {
    for (const right of rights) {
      for (const y of tops) {
        for (const bottom of bottoms) {
          const room = { x, y, width: right - x, height: bottom - y }
          if (room.width > 0 && room.height > 0 && !kept.some((rect) => overlaps(room, rect))) {
            rooms.push(room)
          }
        }
      }
    }
  }
  return rooms
}

/** The larger placement; between two as large, the one nearer the canvas's centre. */
function better(a: Placement, b: Placement, outer: FitSize): Placement {
  if (Math.abs(a.scale - b.scale) > 1e-9) return a.scale > b.scale ? a : b
  const off = (p: Placement) =>
    Math.hypot(p.x + p.width / 2 - outer.width / 2, p.y + p.height / 2 - outer.height / 2)
  return off(b) < off(a) ? b : a
}

/**
 * Where the fit draws the diagram (`inner`, its bounds in diagram units) on a canvas of `outer`
 * pixels with `keepClear` lying over it (the zoom bar, bpmn.io's link; in the canvas's pixels): as
 * large as it fits, never past 1:1, centred, as bpmn-js's fit draws it, where that keeps it
 * `KEEP_CLEAR_GAP` clear of each of them. Where the centred fit would reach under one, it takes the
 * free room that draws it largest (left of the zoom bar, below it, above the link), centred in that
 * room. Null for an empty diagram or canvas.
 */
export function clearFitPlacement(
  inner: FitSize,
  outer: FitSize,
  keepClear: ReadonlyArray<FitRect>,
): Placement | null {
  if (!(inner.width > 0) || !(inner.height > 0)) return null
  const whole = placeIn({ x: 0, y: 0, ...outer }, inner)
  if (!whole) return null
  const kept = onCanvas(keepClear, outer).map((rect) => grown(rect, KEEP_CLEAR_GAP))
  if (!kept.some((rect) => overlaps(whole, rect))) return whole
  let best: Placement | null = null
  for (const room of freeRooms(outer, kept)) {
    const placed = placeIn(room, inner)
    if (placed) best = best ? better(best, placed, outer) : placed
  }
  return best ?? whole
}

/**
 * The viewbox (diagram-js's `canvas.viewbox(box)`) that draws the diagram where
 * {@link clearFitPlacement} puts it; null where it puts nothing.
 */
export function clearFitViewbox(
  inner: FitRect,
  outer: FitSize,
  keepClear: ReadonlyArray<FitRect>,
): FitRect | null {
  const placed = clearFitPlacement(inner, outer, keepClear)
  if (!placed) return null
  return {
    x: inner.x - placed.x / placed.scale,
    y: inner.y - placed.y / placed.scale,
    width: outer.width / placed.scale,
    height: outer.height / placed.scale,
  }
}

/** The zoom bar's mark: the fit keeps the diagram clear of it. */
export const ZOOM_CONTROLS_SLOT = "bpmn-zoom-controls"
/** bpmn-js's link to bpmn.io, which its licence keeps in sight at the canvas's bottom right. */
const POWERED_BY = ".bjs-powered-by"

/**
 * What lies over the canvas (`canvas`, diagram-js's container) in its frame (`frame`, the element
 * the viewer was handed, whose parent holds the zoom bar): the zoom bar and bpmn.io's link, in the
 * canvas's pixels, measured as drawn.
 */
export function keptClearOf(canvas: Element, frame: Element): FitRect[] {
  const origin = canvas.getBoundingClientRect()
  const over = [
    ...(frame.parentElement?.querySelectorAll(`[data-slot="${ZOOM_CONTROLS_SLOT}"]`) ?? []),
    ...frame.querySelectorAll(POWERED_BY),
  ]
  return over.map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left - origin.left - canvas.clientLeft,
      y: rect.top - origin.top - canvas.clientTop,
      width: rect.width,
      height: rect.height,
    }
  })
}
