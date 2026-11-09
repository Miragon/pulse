interface DiagramPoint {
  readonly x: number
  readonly y: number
}

export interface DiagramElement {
  readonly id: string
  readonly type: string
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
  readonly waypoints?: readonly DiagramPoint[]
  readonly labelTarget?: DiagramElement
  readonly parent?: DiagramElement
  readonly businessObject?: {
    readonly name?: string
    readonly $instanceOf?: (type: string) => boolean
  }
}

export interface ElementRegistryLike {
  getAll(): DiagramElement[]
  get(id: string): DiagramElement | undefined
}

export interface DiagramBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export class DiagramElements {
  constructor(private readonly registry: ElementRegistryLike) {}

  static selectableTarget(element: DiagramElement): DiagramElement | undefined {
    const target = element.labelTarget ?? element
    return DiagramElements.isFlowNode(target) ? target : undefined
  }

  names(): ReadonlyMap<string, string> {
    const names = new Map<string, string>()
    for (const element of this.registry.getAll()) {
      const name = element.businessObject?.name?.trim()
      if (name !== undefined && name !== "" && element.labelTarget === undefined) {
        names.set(element.id, name.replace(/\s+/g, " "))
      }
    }
    return names
  }

  contentBounds(): DiagramBounds | undefined {
    const points = this.registry
      .getAll()
      .filter((element) => element.parent !== undefined)
      .flatMap((element) => DiagramElements.cornersOf(element))
    if (points.length === 0) {
      return undefined
    }
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }

  private static isFlowNode(element: DiagramElement): boolean {
    return element.businessObject?.$instanceOf?.("bpmn:FlowNode") === true
  }

  private static cornersOf(element: DiagramElement): readonly DiagramPoint[] {
    if (element.waypoints !== undefined) {
      return element.waypoints
    }
    const { x, y, width, height } = element
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return []
    }
    return [
      { x, y },
      { x: x + width, y: y + height },
    ]
  }
}
