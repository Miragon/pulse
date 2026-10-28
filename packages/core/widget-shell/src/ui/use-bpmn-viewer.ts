import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer"
import { type BpmnElement } from "./bpmn-heatmap/heat-utils.js"
import { BPMN_TOKENS, cdVar } from "./bpmn-tokens.js"
import { useInlineBudget } from "./inline-budget.js"

/** bpmn-js ships no usable types on `Viewer#get`; the slice the widgets use. */
export interface BpmnCanvas {
  /** Never zooms in past 1:1. */
  zoom(mode: "fit-viewport", center?: "auto"): void
  zoom(level: number): void
  zoom(): number
  addMarker(elementId: string, marker: string): void
  viewbox(): {
    x: number
    y: number
    width: number
    height: number
    scale: number
    inner?: { x: number; y: number; width: number; height: number }
  }
  getContainer(): HTMLElement
  /** Drops diagram-js's cached viewbox; a fit after a resize would scale against the old size. */
  resized(): void
}

export interface BpmnOverlays {
  add: (elementId: string, overlay: { position: object; html: string }) => void
}

export interface BpmnElementRegistry {
  getAll: () => BpmnElement[]
}

export interface BpmnEventBus {
  on: (event: string, fn: () => void) => void
  off: (event: string, fn: () => void) => void
}

export interface BpmnViewerWithGet {
  get: ((service: "canvas") => BpmnCanvas) &
    ((service: "overlays") => BpmnOverlays) &
    ((service: "elementRegistry") => BpmnElementRegistry) &
    ((service: "eventBus") => BpmnEventBus)
}

/**
 * The paper stays light in both themes: bpmn-js paints near-black strokes into
 * the SVG, unreadable on a dark card. Inline style beats any themed class.
 */
function paintLightCanvas(container: HTMLElement): void {
  container.setAttribute("data-theme-mode", "light")
  container.style.setProperty("background-color", cdVar(BPMN_TOKENS.paper))
  container.style.setProperty("color-scheme", "light")
}

export const DIAGRAM_MIN_HEIGHT = 240
export const DIAGRAM_MAX_HEIGHT = 560
export const DIAGRAM_DEFAULT_HEIGHT = 360
/** The fit's 0.95 margin plus the zoom bar's reach. */
const DIAGRAM_HEIGHT_PADDING = 48

export interface DiagramBounds {
  width: number
  height: number
}

/**
 * `fit-viewport` shrinks a wide diagram to the width but never zooms in past
 * 1:1, so a small diagram gets a frame just as tall, clamped to min/max.
 */
export function diagramHeight(bounds: DiagramBounds | null, width: number): number {
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0) || !(width > 0)) {
    return DIAGRAM_DEFAULT_HEIGHT
  }
  const scale = Math.min(1, width / bounds.width)
  const fitted = Math.ceil(bounds.height * scale) + DIAGRAM_HEIGHT_PADDING
  return Math.min(DIAGRAM_MAX_HEIGHT, Math.max(DIAGRAM_MIN_HEIGHT, fitted))
}

const BPMN_DI = "http://www.omg.org/spec/BPMN/20100524/DI"
const DD_DC = "http://www.omg.org/spec/DD/20100524/DC"
const DD_DI = "http://www.omg.org/spec/DD/20100524/DI"

function numberAttr(el: Element, name: string): number {
  const value = el.getAttribute(name)
  return value === null ? Number.NaN : Number(value)
}

/** Read from the DI before the import, so the frame has its height on the first paint. */
export function diagramBoundsFromXml(xml: string): DiagramBounds | null {
  if (!xml || typeof DOMParser === "undefined") return null
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  if (doc.getElementsByTagName("parsererror").length > 0) return null
  // Walking the elements: `getElementsByTagNameNS` is not reliable in every test DOM.
  const is = (el: Element, ns: string, name: string) =>
    el.namespaceURI === ns && el.localName === name
  const diagram = Array.from(doc.getElementsByTagName("*")).find((el) =>
    is(el, BPMN_DI, "BPMNDiagram"),
  )
  if (!diagram) return null
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const extend = (x: number, y: number, width: number, height: number) => {
    if (![x, y, width, height].every(Number.isFinite)) return
    box.minX = Math.min(box.minX, x)
    box.minY = Math.min(box.minY, y)
    box.maxX = Math.max(box.maxX, x + width)
    box.maxY = Math.max(box.maxY, y + height)
  }
  for (const el of Array.from(diagram.getElementsByTagName("*"))) {
    if (is(el, DD_DC, "Bounds")) {
      extend(
        numberAttr(el, "x"),
        numberAttr(el, "y"),
        numberAttr(el, "width"),
        numberAttr(el, "height"),
      )
    } else if (is(el, DD_DI, "waypoint")) {
      extend(numberAttr(el, "x"), numberAttr(el, "y"), 0, 0)
    }
  }
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  return width > 0 && height > 0 ? { width, height } : null
}

function drawnBounds(canvas: BpmnCanvas): DiagramBounds | null {
  try {
    const inner = canvas.viewbox().inner
    return inner && inner.width > 0 && inner.height > 0
      ? { width: inner.width, height: inner.height }
      : null
  } catch {
    return null
  }
}

const FALLBACK_IMPORT_ERROR = "Failed to render the BPMN diagram."

/** Matches bpmn-js's own navigation limits. */
const ZOOM_MIN = 0.2
const ZOOM_MAX = 4

export interface UseBpmnViewerOptions {
  bpmnXml: string
  /** Read at import time, so a new function identity alone never re-imports. */
  onImported?: (viewer: BpmnViewerWithGet) => void | (() => void)
  /** A new identity remounts the viewer: bpmn-js decoration is add-only. */
  reimportKey?: unknown
  /** Off by default: the heatmap preserves the operator's pan/zoom. */
  fitOnResize?: boolean
}

export interface UseBpmnViewerResult {
  containerRef: RefObject<HTMLDivElement | null>
  height: number
  importError: string | null
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
}

export function useBpmnViewer({
  bpmnXml,
  onImported,
  reimportKey,
  fitOnResize = false,
}: UseBpmnViewerOptions): UseBpmnViewerResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<NavigatedViewer | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  // Tagged with its XML so a new diagram never inherits the last one's bounds.
  const [drawn, setDrawn] = useState<{ xml: string; bounds: DiagramBounds | null } | null>(null)
  const [width, setWidth] = useState(0)
  // Synced in an effect so a discarded render can't leak into the ref.
  const onImportedRef = useRef(onImported)
  useEffect(() => {
    onImportedRef.current = onImported
  })

  // On every commit, since the ref may now point at a different element.
  useLayoutEffect(() => {
    if (containerRef.current) paintLightCanvas(containerRef.current)
  })

  const getCanvas = useCallback((): BpmnCanvas | null => {
    if (!viewerRef.current) return null
    return (viewerRef.current as unknown as BpmnViewerWithGet).get("canvas")
  }, [])

  const fit = useCallback(() => {
    const canvas = getCanvas()
    if (!canvas) return
    canvas.resized()
    canvas.zoom("fit-viewport", "auto")
    canvas.zoom(canvas.zoom() * 0.95)
  }, [getCanvas])

  const zoomIn = useCallback(() => {
    const canvas = getCanvas()
    if (canvas) canvas.zoom(Math.min(ZOOM_MAX, canvas.zoom() * 1.1))
  }, [getCanvas])

  const zoomOut = useCallback(() => {
    const canvas = getCanvas()
    if (canvas) canvas.zoom(Math.max(ZOOM_MIN, canvas.zoom() * 0.9))
  }, [getCanvas])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    setWidth(container.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => setWidth(container.clientWidth))
    observer.observe(container)
    return () => observer.disconnect()
  }, [bpmnXml])

  const xmlBounds = useMemo(() => diagramBoundsFromXml(bpmnXml), [bpmnXml])
  const bounds = xmlBounds ?? (drawn?.xml === bpmnXml ? drawn.bounds : null)
  const { diagramMaxHeight } = useInlineBudget()
  const height = Math.min(diagramHeight(bounds, width), diagramMaxHeight ?? Infinity)
  // A width change refits only a viewer that refits on resize: the heatmap keeps pan and zoom.
  const refitOn = fitOnResize ? height : bounds
  useLayoutEffect(() => {
    fit()
  }, [refitOn, fit])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !bpmnXml) return

    const viewer = new NavigatedViewer({ container })
    viewerRef.current = viewer
    let cancelled = false
    let importCleanup: (() => void) | null = null
    setImportError(null)

    void (async () => {
      try {
        await viewer.importXML(bpmnXml)
      } catch (err) {
        if (cancelled) return
        setImportError(err instanceof Error ? err.message : FALLBACK_IMPORT_ERROR)
        return
      }
      if (cancelled) return
      fit()
      const canvas = getCanvas()
      if (canvas) setDrawn({ xml: bpmnXml, bounds: drawnBounds(canvas) })
      // Outside this try a decoration failure would be a silent unhandled rejection.
      try {
        const cleanup = onImportedRef.current?.(viewer)
        importCleanup = typeof cleanup === "function" ? cleanup : null
      } catch (err) {
        setImportError(err instanceof Error ? err.message : FALLBACK_IMPORT_ERROR)
      }
    })()

    let rafId: number | null = null
    let observer: ResizeObserver | null = null
    if (fitOnResize) {
      observer = new ResizeObserver(() => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(() => {
          rafId = null
          fit()
        })
      })
      observer.observe(container)
    }

    return () => {
      cancelled = true
      if (rafId !== null) cancelAnimationFrame(rafId)
      observer?.disconnect()
      importCleanup?.()
      viewerRef.current = null
      viewer.destroy()
    }
  }, [bpmnXml, reimportKey, fitOnResize, fit, getCanvas])

  return { containerRef, height, importError, zoomIn, zoomOut, fit }
}
