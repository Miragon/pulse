import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  cn,
  ErrorState,
  formatCompactCount,
  formatCount,
  useUiMessages,
  type BpmnMessages,
} from "../index.js"
import { readBpmnNames } from "./bpmn-names.js"
import { BADGE_ANCHOR } from "./bpmn-tokens.js"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { CanvasBadge } from "./canvas-badge.js"
import {
  centredIdsOf,
  countedElements,
  drawnKeyOf,
  MARKER_CLASS,
  outlinesOf,
  type CountedElement,
  type DiagramCount,
  type DiagramDecoration,
  type DiagramMarker,
} from "./diagram-marks.js"
import { useBpmnViewer, type BpmnViewerWithGet } from "./use-bpmn-viewer.js"

/**
 * Where an element's counts sit: over its top right corner, a zero-sized anchor the cluster grows
 * from to the left, as on the shared screens and in the editors' webview.
 */
const BADGE_POSITION = { top: -10, right: -6 }

/** An element of the drawing as a count names it: its id and its BPMN type (`bpmn:UserTask`). */
export interface DiagramElement {
  readonly id: string
  /** As bpmn-js reads it; empty where the drawing does not say. */
  readonly type: string
}

/** How a count was clicked: Ctrl or Cmd held asks for the target beside the page. */
export interface DiagramSelectHow {
  readonly toSide: boolean
}

/** What a surface's own counts of an element get (`renderCounts`). */
export interface DiagramCountsProps<C extends DiagramCount = DiagramCount> {
  readonly element: DiagramElement
  /** Its counts above 0, in the badges' order (root incidents first). */
  readonly counts: readonly C[]
  readonly elementName: string
  readonly stale: boolean
}

export interface BpmnDiagramProps<C extends DiagramCount = DiagramCount> {
  /** The BPMN 2.0 XML to draw. */
  readonly xml: string
  /** The diagram's name: the canvas becomes the image under it (the process and its version). */
  readonly ariaLabel: string
  /**
   * What each element shows: its counts (a badge each) and a root incident's outline. The shared
   * screens' decorations (`DiagramDecorations.of` of `@miragon/pulse-screens`) are this shape. An
   * element the drawing lacks is skipped.
   */
  readonly decorations?: readonly DiagramDecoration<C>[]
  /** Outlines without a count (an instance's wait, an open user task, an incident). */
  readonly markers?: readonly DiagramMarker[]
  /** An element's name for its counts' words; default the name the XML gives it, else its id. */
  readonly nameOf?: (elementId: string) => string
  /**
   * A count's click: each count a button (the page decides where it leads). Without it the counts
   * are a drawing (`aria-hidden`), and the page says them in words elsewhere.
   */
  readonly onSelect?: (element: DiagramElement, count: C, how: DiagramSelectHow) => void
  /**
   * Whether a count leads somewhere; one that leads nowhere is drawn without a button, its words
   * for a screen reader and as its tooltip. Default: every count does.
   */
  readonly selectable?: (element: DiagramElement, count: C) => boolean
  /** The counts are older than what the page shows beside them (a refresh runs): neutral. */
  readonly stale?: boolean
  /** A surface's own counts of an element, drawn in its anchor instead of the kit's cluster. */
  readonly renderCounts?: (props: DiagramCountsProps<C>) => ReactNode
  /**
   * After each drawing, with the viewer: a surface's own decoration (a marker it moves in place,
   * an overlay it portals into `children`). Its cleanup runs before the next drawing.
   */
  readonly onDrawn?: (viewer: BpmnViewerWithGet) => void | (() => void)
  /** A new value draws the diagram anew: what `onDrawn` decorates changed. */
  readonly redrawKey?: unknown
  /**
   * The frame's height: a number of pixels, `"fill"` for the height of the box it sits in, or the
   * diagram's own (240 to 560 px, by its drawing and the canvas's width).
   */
  readonly height?: number | "fill"
  /** The tallest the diagram's own height may grow: an inline chat card's budget. */
  readonly maxHeight?: number | null
  /** Fits the diagram again when the canvas resizes. Default true. */
  readonly fitOnResize?: boolean
  /** A border around the canvas. Default true; off where the box it sits in draws one. */
  readonly framed?: boolean
  /** What the canvas says when bpmn-js could not draw the XML; default the kit's words. */
  readonly drawFailed?: string
  readonly className?: string
  /** Laid in the frame over the canvas: a surface's own overlays (portals) and controls. */
  readonly children?: ReactNode
}

/** A host of an element's counts on the drawing. */
interface CountsHost {
  readonly key: string
  readonly element: DiagramElement
  readonly node: HTMLElement
}

const NO_DECORATIONS: readonly DiagramDecoration[] = []
const NO_MARKERS: readonly DiagramMarker[] = []

/** Runs `paint` on the drawing, where its element exists in it. */
function safely(paint: () => void): void {
  try {
    paint()
  } catch {
    // The element is not in the drawing (a count of another version's element): nothing to paint.
  }
}

/** An element's BPMN type as the drawing holds it; empty where it does not say. */
function typeOf(viewer: BpmnViewerWithGet, elementId: string): string {
  try {
    return (
      viewer
        .get("elementRegistry")
        .getAll()
        .find(({ id }) => id === elementId)?.type ?? ""
    )
  } catch {
    return ""
  }
}

/** The hosts of the counts: one on each counted element the drawing has, none it lacks. */
function hostsOf(viewer: BpmnViewerWithGet, counted: readonly CountedElement[]): CountsHost[] {
  if (counted.length === 0) return []
  const overlays = viewer.get("overlays") as unknown as {
    add: (id: string, overlay: { position: object; html: HTMLElement }) => void
  }
  return counted.flatMap(({ elementId }): CountsHost[] => {
    const node = document.createElement("div")
    node.className = BADGE_ANCHOR
    safely(() => {
      overlays.add(elementId, { position: BADGE_POSITION, html: node })
    })
    if (!node.isConnected) return []
    const element = { id: elementId, type: typeOf(viewer, elementId) }
    return [{ key: `counts:${elementId}`, element, node }]
  })
}

/** What a count says: "Approve order: 2 incidents". */
function describe(words: BpmnMessages, element: string, { kind, count }: DiagramCount): string {
  const params = { element, count: formatCount(count) }
  if (kind === "incidents") return words.countIncidents(params)
  if (kind === "incidentsInCalledInstances") return words.countIncidentsInCalledInstances(params)
  return words.countRunning(params)
}

/**
 * A count's accessible name: its words, led by the figure its badge shows where they lack it
 * ("1.2k, Approve order: 1,234 instances running"), so a voice command names what it sees.
 */
function nameOf(words: BpmnMessages, element: string, count: DiagramCount): string {
  const description = describe(words, element, count)
  const shown = formatCompactCount(count.count)
  return description.includes(shown) ? description : `${shown}, ${description}`
}

interface ElementCountsProps<C extends DiagramCount> extends DiagramCountsProps<C> {
  readonly onSelect: BpmnDiagramProps<C>["onSelect"]
  readonly selectable: BpmnDiagramProps<C>["selectable"]
}

/**
 * An element's counts in the one badge scheme: apart, root incidents first, the incidents in
 * called instances quiet, running instances last. With a click each count that leads somewhere is
 * a button and one that leads nowhere the same badge with its words; without one the cluster is a
 * drawing.
 */
function ElementCounts<C extends DiagramCount>(props: ElementCountsProps<C>) {
  const { element, counts, elementName, stale, onSelect, selectable } = props
  const words = useUiMessages().bpmn
  if (onSelect === undefined) {
    return (
      <span className="badge-cluster" aria-hidden="true" data-badge-for={element.id}>
        {counts.map(({ kind, count }) => (
          <CanvasBadge key={kind} kind={kind} count={count} stale={stale} />
        ))}
      </span>
    )
  }
  return (
    <span
      className="badge-cluster"
      role="group"
      aria-label={elementName}
      data-badge-for={element.id}
    >
      {counts.map((count) => {
        const description = describe(words, elementName, count)
        const badge = <CanvasBadge kind={count.kind} count={count.count} stale={stale} />
        if (selectable !== undefined && !selectable(element, count)) {
          return (
            <span
              key={count.kind}
              className="badge-cluster__count badge-cluster__count--plain"
              data-part="badge-plain"
              title={description}
            >
              {badge}
              <span className="sr-only">{description}</span>
            </span>
          )
        }
        return (
          <button
            key={count.kind}
            type="button"
            className="badge-cluster__count"
            data-part="badge-count"
            data-kind={count.kind}
            aria-label={nameOf(words, elementName, count)}
            title={description}
            onClick={(event) => {
              event.stopPropagation()
              onSelect(element, count, { toSide: event.ctrlKey || event.metaKey })
            }}
          >
            {badge}
          </button>
        )
      })}
    </span>
  )
}

/**
 * A BPMN diagram on the kit's themed canvas, for any React page, with no host: the drawing with
 * Pulse's markers and count badges in the one badge scheme (owner decision 2026-11-24, the shared
 * screens'), the zoom bar at its top right (bpmn.io's link takes the bottom right) and the fit.
 * Each element's counts sit apart over its top right corner: its open root incidents in the
 * incident's colour, the incidents in the instances it called quiet in a badge of their own, its
 * running instances on the info ramp; only an own root incident outlines the element. An element
 * the drawing lacks is skipped without an error. It draws again when the elements it decorates
 * change; a count that changes on an element that has counts changes in place, so a refresh keeps
 * the reader's zoom. The canvas follows the theme (light, dark, high contrast, forced colours)
 * from its own stylesheet (`BPMN_OVERLAY_CSS`), which it injects, so a page imports no CSS for it.
 */
export function BpmnDiagram<C extends DiagramCount = DiagramCount>(props: BpmnDiagramProps<C>) {
  const { xml, ariaLabel, nameOf: namedBy, onSelect, selectable, renderCounts } = props
  const { stale = false, redrawKey, height, maxHeight, fitOnResize = true, framed = true } = props
  const decorations = (props.decorations ?? NO_DECORATIONS) as readonly DiagramDecoration<C>[]
  const markers = props.markers ?? NO_MARKERS
  const words = useUiMessages().bpmn
  const [hosts, setHosts] = useState<readonly CountsHost[]>([])
  const counted = useMemo(() => countedElements(decorations), [decorations])
  const outlines = useMemo(() => outlinesOf(decorations, markers), [decorations, markers])
  const drawnKey = useMemo(() => drawnKeyOf(counted, outlines), [counted, outlines])
  const reimportKey = useMemo(() => ({ drawnKey, redrawKey }), [drawnKey, redrawKey])
  const centred = useMemo(() => centredIdsOf(outlines, counted), [outlines, counted])
  const names = useMemo(() => readBpmnNames(xml).elements, [xml])
  const onDrawn = useRef(props.onDrawn)
  useEffect(() => {
    onDrawn.current = props.onDrawn
  })
  const {
    containerRef,
    height: own,
    importError,
    zoomIn,
    zoomOut,
    fit,
  } = useBpmnViewer({
    bpmnXml: xml,
    reimportKey,
    fitOnResize,
    markedIds: centred,
    maxHeight,
    ariaLabel,
    onImported: (viewer) => {
      const canvas = viewer.get("canvas")
      for (const { elementId, kind } of outlines) {
        safely(() => {
          canvas.addMarker(elementId, MARKER_CLASS[kind])
        })
      }
      setHosts(hostsOf(viewer, counted))
      const cleanup = onDrawn.current?.(viewer)
      return () => {
        setHosts([])
        if (typeof cleanup === "function") cleanup()
      }
    },
  })
  const elementName = (id: string) =>
    namedBy?.(id) ?? (Object.hasOwn(names, id) ? names[id] : undefined) ?? id
  const style: CSSProperties | undefined =
    height === "fill" ? undefined : { height: `${String(height ?? own)}px` }
  return (
    <div
      className={cn("relative w-full", height === "fill" && "h-full min-h-0", props.className)}
      data-slot="bpmn-diagram"
      style={style}
    >
      <div
        ref={containerRef}
        className={cn("h-full w-full", framed && "border-border rounded-md border")}
      />
      {importError !== null && (
        <div className="p-gutter absolute inset-0 grid place-items-center">
          <ErrorState
            variant="inline"
            title={props.drawFailed ?? words.drawFailed}
            description={props.drawFailed === undefined ? words.drawFailedHint : undefined}
            details={importError}
          />
        </div>
      )}
      <BpmnZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} />
      {hosts.map(({ key, element, node }) => {
        const counts = counted.find(({ elementId }) => elementId === element.id)?.counts
        if (counts === undefined) return null
        const shown = { element, counts, elementName: elementName(element.id), stale }
        return createPortal(
          renderCounts === undefined ? (
            <ElementCounts {...shown} onSelect={onSelect} selectable={selectable} />
          ) : (
            renderCounts(shown)
          ),
          node,
          key,
        )
      })}
      {props.children}
    </div>
  )
}
