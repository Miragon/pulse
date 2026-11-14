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
import { BPMN_LABEL_STYLE } from "@miragon/pulse-ui"
import { clearFitViewbox, keptClearOf, type FitRect } from "./bpmn-fit.js"
import { BPMN_TOKENS, cdVar } from "./bpmn-tokens.js"
import { useInlineBudget } from "./inline-budget.js"

/** bpmn-js ships no usable types on `Viewer#get`; the slice the widgets use. */
export interface BpmnCanvas {
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
    outer?: { width: number; height: number }
  }
  /** Shows `box` (diagram units) on the whole canvas, at the scale that fits it. */
  viewbox(box: FitRect): unknown
  /** diagram-js's container of the canvas, the box its size is read from. */
  getContainer(): HTMLElement
  /** Drops diagram-js's cached viewbox; a fit after a resize would scale against the old size. */
  resized(): void
}

export interface BpmnOverlays {
  add: (elementId: string, overlay: { position: object; html: string }) => void
}

interface BpmnBusinessObject {
  id?: string
  $type?: string
  sourceRef?: { id?: string }
  targetRef?: { id?: string }
}

interface BpmnWaypoint {
  x: number
  y: number
}

/** One element of the drawn diagram (`elementRegistry.getAll()`): the slice a widget reads. */
export interface BpmnElement {
  id: string
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
  waypoints?: BpmnWaypoint[]
  businessObject?: BpmnBusinessObject
  /** Set on label elements; points back at the shape they label. */
  labelTarget?: BpmnElement
}

interface BpmnElementRegistry {
  getAll: () => BpmnElement[]
}

interface BpmnEventBus {
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
const DIAGRAM_DEFAULT_HEIGHT = 360
/** The frame's height over the drawing's at full width: the fit's 5 % margin and air around it. */
const DIAGRAM_HEIGHT_PADDING = 48

export interface DiagramBounds {
  width: number
  height: number
}

/**
 * The frame for a diagram drawn across `width`: the clear fit (`clearFitViewbox`) shrinks a wide
 * diagram to the width but never zooms in past 1:1, so a small diagram gets a frame just as tall,
 * clamped to min/max. Where the zoom bar or bpmn.io's link would lie over the drawing, the fit
 * draws it smaller beside them in this same frame; the frame does not grow for it.
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
  /**
   * The diagram's name. The canvas alone (bpmn-js's SVG) becomes the image (`role="img"`) under
   * it, so what lies beside the canvas in the frame (the zoom controls, bpmn.io's link) stays
   * outside any image: an image's content is presentational, a control inside it would be lost to
   * assistive technology (axe's nested-interactive). Never put the role on the frame. An overlay a
   * caller draws over the canvas (a count badge) reads beside the image, so the caller hides it
   * (`aria-hidden`) and says its value in words elsewhere in the view.
   */
  ariaLabel?: string
}

export interface UseBpmnViewerResult {
  containerRef: RefObject<HTMLDivElement | null>
  height: number
  importError: string | null
  zoomIn: () => void
  zoomOut: () => void
  /**
   * Fits the whole diagram, never past 1:1, clear of what lies over its canvas: `BpmnZoomControls`
   * beside the container in its frame (the container's parent) and bpmn.io's link.
   */
  fit: () => void
}

export function useBpmnViewer({
  bpmnXml,
  onImported,
  reimportKey,
  fitOnResize = false,
  ariaLabel,
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

  // bpmn-js's fit (never past 1:1, centred, 95 % of the canvas), kept clear of what lies over the
  // canvas: where the zoom bar or bpmn.io's link would cover the drawing, it takes the room beside
  // them (`clearFitViewbox`).
  const fit = useCallback(() => {
    const canvas = getCanvas()
    const frame = containerRef.current
    if (!canvas || !frame) return
    // A hidden container (`display: none`: the origin view behind a drill) has no layout box, and
    // bpmn-js throws on the non-finite scale it would compute; showing it again resizes and refits.
    if (frame.getClientRects().length === 0) return
    canvas.resized()
    const { inner, outer } = canvas.viewbox()
    if (!inner || !outer) return
    const box = clearFitViewbox(inner, outer, keptClearOf(canvas.getContainer(), frame))
    if (box) canvas.viewbox(box)
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

    // The labels in bpmn-js's Arial, handed over explicitly: the same object as the webview's.
    const viewer = new NavigatedViewer({ container, textRenderer: BPMN_LABEL_STYLE })
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

  // After the viewer's effect, so a viewer created in this commit has its canvas named in it too.
  useEffect(() => {
    nameCanvas(containerRef.current, ariaLabel)
    hideBreadcrumbs(containerRef.current)
  })

  return { containerRef, height, importError, zoomIn, zoomOut, fit }
}

/** bpmn-js draws into `.bjs-container > .djs-container > svg` inside the frame it is handed. */
const CANVAS_SVG = ".djs-container > svg"
/** bpmn-js's drilldown trail, a list it appends under the canvas. */
const BREADCRUMBS = ".djs-container > .bjs-breadcrumbs"

/**
 * The trail (the planes above a drilled-into subprocess) lies under the canvas, clipped by the
 * frame and, without bpmn-js's stylesheet, never in sight: hidden, so it does not read beside the
 * image either, as a list of one item, the process's name.
 */
function hideBreadcrumbs(container: HTMLElement | null): void {
  container?.querySelector(BREADCRUMBS)?.setAttribute("hidden", "")
}

/** The canvas becomes the image under its name; without a name it stays as bpmn-js drew it. */
function nameCanvas(container: HTMLElement | null, label: string | undefined): void {
  const svg = container?.querySelector(CANVAS_SVG)
  if (!svg || label === undefined) return
  svg.setAttribute("role", "img")
  svg.setAttribute("aria-label", label)
}
