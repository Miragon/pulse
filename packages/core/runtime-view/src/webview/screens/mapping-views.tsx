import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { Decorations, DrawStart, MappingDecoration } from "../diagram/decorations.js"
import { MappingArrows, type ArrowScene, type ArrowTone } from "../diagram/mapping-arrows.js"
import { ViewLink, type LinkedView } from "../diagram/view-link.js"
import { useHost } from "../host/host-context.js"
import { UiStateStore } from "../host/ui-state-store.js"
import type { Drawing } from "./mapping-draw.js"
import { MappingScene, type DiagramRow, type Hovered } from "./mapping-scene.js"

export type DiagramSideName = "source" | "target"

export interface LinkedViews {
  readonly linked: boolean
  readonly link: (linked: boolean) => void
  readonly offer: (side: DiagramSideName, view: LinkedView | undefined) => void
  readonly drawn: (side: DiagramSideName) => void
  readonly touch: (side: DiagramSideName) => void
  readonly changed: (side: DiagramSideName) => void
}

const TOUCH_MS = 800

interface Touched {
  readonly side: DiagramSideName
  readonly until: number
}

export function useArrowLayer(
  group: RefObject<SVGGElement | null>,
  source: RefObject<HTMLElement | null>,
  target: RefObject<HTMLElement | null>,
  markerOf: (tone: ArrowTone) => string,
): RefObject<MappingArrows | null> {
  const layer = useRef<MappingArrows | null>(null)
  useEffect(() => {
    const element = group.current
    if (element === null) {
      return undefined
    }
    const created = new MappingArrows(
      element,
      { source: () => source.current, target: () => target.current },
      markerOf,
    )
    layer.current = created
    const observer = new ResizeObserver(() => {
      created.redraw()
    })
    const svg = element.ownerSVGElement
    if (svg !== null) {
      observer.observe(svg)
    }
    return () => {
      observer.disconnect()
      created.destroy()
      layer.current = null
    }
  }, [group, source, target, markerOf])
  return layer
}

export function useArrowScene(layer: RefObject<MappingArrows | null>, scene: ArrowScene): void {
  useEffect(() => {
    layer.current?.show(scene)
  }, [layer, scene])
}

export function useLinkedViews(onChanged: () => void): LinkedViews {
  const { api } = useHost()
  const [linked, setLinked] = useState(() => UiStateStore.read(api).diagramsApart !== true)
  const views = useRef<Partial<Record<DiagramSideName, LinkedView>>>({})
  const shown = useRef<ReadonlySet<DiagramSideName>>(new Set())
  const touched = useRef<Touched | undefined>(undefined)
  const guard = useRef<ViewLink | null>(null)
  useEffect(() => {
    guard.current = new ViewLink()
    return () => {
      guard.current = null
    }
  }, [])
  const offer = useCallback((side: DiagramSideName, view: LinkedView | undefined) => {
    views.current = { ...views.current, [side]: view }
    shown.current = new Set([...shown.current].filter((known) => known !== side))
  }, [])
  const drawn = useCallback((side: DiagramSideName) => {
    shown.current = new Set([...shown.current, side])
  }, [])
  const touch = useCallback((side: DiagramSideName) => {
    touched.current = { side, until: performance.now() + TOUCH_MS }
  }, [])
  const changed = (side: DiagramSideName): void => {
    onChanged()
    const byYou = touched.current?.side === side && performance.now() <= touched.current.until
    if (byYou) {
      touch(side)
    }
    if (linked && byYou && shown.current.size === 2) {
      const other = side === "source" ? "target" : "source"
      guard.current?.follow(views.current[side], views.current[other])
    }
  }
  const link = (wanted: boolean): void => {
    setLinked(wanted)
    UiStateStore.write(api, { diagramsApart: !wanted })
    if (wanted) {
      guard.current?.follow(views.current.source, views.current.target)
    }
  }
  return { linked, link, offer, drawn, touch, changed }
}

interface ShownMapping {
  readonly rows: readonly DiagramRow[]
  readonly focused: string | undefined
  readonly stale: boolean
  readonly hovered: Hovered | undefined
  readonly drawing: Drawing | undefined
}

export function useMigrationDecorations(
  shown: ShownMapping,
  mapping: MappingDecoration | undefined,
): { readonly source: Decorations; readonly target: Decorations } {
  const { rows, stale, hovered, drawing } = shown
  const focused = drawing?.from ?? shown.focused
  const focusedRow = rows.find((row) => row.sourceElementId === focused)
  const fromTarget = hovered?.side === "target" ? hovered : undefined
  const fromSource = hovered?.side === "source" ? hovered : undefined
  const source = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: focused,
      unmapped: rows.filter((row) => row.unmappedTokens === true).map((row) => row.sourceElementId),
      mapping,
      counterparts: MappingScene.inSource(rows, fromTarget),
    }),
    [stale, focused, rows, mapping, fromTarget],
  )
  const target = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: focusedRow?.targetElementId,
      candidates: focusedRow?.candidates.map((candidate) => candidate.elementId) ?? [],
      counterparts: MappingScene.inTarget(rows, fromSource),
      dropTarget: drawing?.over,
    }),
    [stale, focusedRow, rows, fromSource, drawing],
  )
  return { source, target }
}

export function useMappingDecoration(
  rows: readonly DiagramRow[],
  version: number | undefined,
  shown: string | undefined,
  start: (from: string, at: DrawStart) => void,
): MappingDecoration | undefined {
  const host = useHost()
  const onStart = useCallback(
    (from: string, at: DrawStart) => {
      host.post({ type: "focusMapping", sourceElementId: from })
      if (at.pointer) {
        start(from, at)
        return
      }
      document.querySelector<HTMLElement>(`[data-map-select="${CSS.escape(from)}"]`)?.focus()
    },
    [host, start],
  )
  const onUnmap = useCallback(
    (from: string) => {
      host.post({ type: "unmapElement", sourceElementId: from })
    },
    [host],
  )
  const handles = useMemo(() => MappingScene.handles(rows), [rows])
  return useMemo(
    () =>
      version === undefined
        ? undefined
        : { handles, targetVersion: version, shown, onStart, onUnmap },
    [handles, version, shown, onStart, onUnmap],
  )
}

export function useAllMappings(): readonly [boolean, (shown: boolean) => void] {
  const { api } = useHost()
  const [shown, setShown] = useState(() => UiStateStore.read(api).allMappings === true)
  const show = (wanted: boolean): void => {
    setShown(wanted)
    UiStateStore.write(api, { allMappings: wanted })
  }
  return [shown, show]
}
