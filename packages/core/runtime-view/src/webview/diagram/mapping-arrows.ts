const SVG = "http://www.w3.org/2000/svg"
const HEAD_GAP = 3
const BEND = 0.2
const MAX_BEND = 140

export type ArrowTone = "info" | "danger"

export interface ArrowPair {
  readonly sourceElementId: string
  readonly targetElementId: string
  readonly tone: ArrowTone
  readonly focused: boolean
}

interface LineStyle {
  readonly tone: ArrowTone
  readonly focused: boolean
  readonly drawing: boolean
}

export interface ArrowScene {
  readonly pairs: readonly ArrowPair[]
  readonly drawing?: { readonly from: string; readonly to?: string | undefined } | undefined
}

export interface ArrowSides {
  readonly source: () => HTMLElement | null
  readonly target: () => HTMLElement | null
}

interface Point {
  readonly x: number
  readonly y: number
}

interface Box {
  readonly center: Point
  readonly halfWidth: number
  readonly halfHeight: number
}

export class MappingArrows {
  private scene: ArrowScene = { pairs: [] }
  private pointer: Point | undefined
  private frame: number | undefined

  constructor(
    private readonly group: SVGGElement,
    private readonly sides: ArrowSides,
    private readonly markerId: (tone: ArrowTone) => string,
  ) {}

  show(scene: ArrowScene): void {
    this.scene = scene
    this.redraw()
  }

  follow(pointer: Point | undefined): void {
    this.pointer = pointer
    this.redraw()
  }

  redraw(): void {
    this.frame ??= requestAnimationFrame(() => {
      this.frame = undefined
      this.draw()
    })
  }

  destroy(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame)
    }
    this.frame = undefined
  }

  private draw(): void {
    const origin = (this.group.ownerSVGElement ?? this.group).getBoundingClientRect()
    const lines = this.scene.pairs.flatMap((pair) => {
      const from = this.boxOf(this.sides.source(), pair.sourceElementId)
      const to = this.boxOf(this.sides.target(), pair.targetElementId)
      return from === undefined || to === undefined
        ? []
        : [this.line(origin, { from, to }, { ...pair, drawing: false })]
    })
    const drawn = this.drawnLine(origin)
    this.group.replaceChildren(...lines, ...(drawn === undefined ? [] : [drawn]))
  }

  private drawnLine(origin: DOMRect): SVGPathElement | undefined {
    const drawing = this.scene.drawing
    const from = drawing === undefined ? undefined : this.boxOf(this.sides.source(), drawing.from)
    if (drawing === undefined || from === undefined) {
      return undefined
    }
    const snapped =
      drawing.to === undefined ? undefined : this.boxOf(this.sides.target(), drawing.to)
    const to =
      snapped ??
      (this.pointer === undefined
        ? undefined
        : { center: this.pointer, halfWidth: 0, halfHeight: 0 })
    return to === undefined
      ? undefined
      : this.line(origin, { from, to }, { tone: "info", focused: true, drawing: true })
  }

  private line(
    origin: DOMRect,
    { from, to }: { readonly from: Box; readonly to: Box },
    style: LineStyle,
  ): SVGPathElement {
    const bend = MappingArrows.bendOf(from.center, to.center)
    const start = MappingArrows.edgeOf(from, bend, 0)
    const end = MappingArrows.edgeOf(to, bend, HEAD_GAP)
    const at = (point: Point) => `${String(point.x - origin.left)} ${String(point.y - origin.top)}`
    const path = document.createElementNS(SVG, "path")
    path.setAttribute("d", `M ${at(start)} Q ${at(bend)} ${at(end)}`)
    path.setAttribute("class", "mapping-arrow")
    path.setAttribute("data-tone", style.tone)
    path.setAttribute("marker-end", `url(#${this.markerId(style.tone)})`)
    for (const [flag, on] of [
      ["data-drawing", style.drawing],
      ["data-focused", style.focused],
    ] as const) {
      if (on) {
        path.setAttribute(flag, "")
      }
    }
    return path
  }

  private static bendOf(from: Point, to: Point): Point {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return from
    }
    const lift = Math.min(length * BEND, MAX_BEND) / length
    return { x: (from.x + to.x) / 2 + dy * lift, y: (from.y + to.y) / 2 - dx * lift }
  }

  private boxOf(side: HTMLElement | null, elementId: string): Box | undefined {
    const shape = side?.querySelector(
      `g.djs-element[data-element-id="${CSS.escape(elementId)}"] > .djs-visual`,
    )
    if (side === null || shape === undefined || shape === null) {
      return undefined
    }
    const box = shape.getBoundingClientRect()
    const area = side.getBoundingClientRect()
    const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const inside =
      center.x >= area.left &&
      center.x <= area.right &&
      center.y >= area.top &&
      center.y <= area.bottom
    return inside ? { center, halfWidth: box.width / 2, halfHeight: box.height / 2 } : undefined
  }

  private static edgeOf(box: Box, toward: Point, gap: number): Point {
    const dx = toward.x - box.center.x
    const dy = toward.y - box.center.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return box.center
    }
    const reach = Math.min(
      dx === 0 ? Number.POSITIVE_INFINITY : box.halfWidth / Math.abs(dx),
      dy === 0 ? Number.POSITIVE_INFINITY : box.halfHeight / Math.abs(dy),
    )
    const scale = Math.min(reach, 1) + gap / length
    return { x: box.center.x + dx * scale, y: box.center.y + dy * scale }
  }
}
